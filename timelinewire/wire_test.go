package timelinewire

import (
	"encoding/base64"
	"flag"
	"github.com/stretchr/testify/require"
	"os"
	"strings"
	"testing"
	"time"
)

// ONE FIXTURE, BOTH LANGUAGES. testdata/golden-v1.b64 is the single artifact
// holding the encoder and the decoder together: this test asserts Encode emits
// exactly those bytes, and ../src/ui/timeline-wire.test.ts decodes exactly
// those bytes and checks the values back out. Neither half can drift without
// one of them going red, and there is no second implementation of the layout
// anywhere to keep in step.
//
// Regenerate deliberately, never reflexively: `go test ./... -update` rewrites
// it, and a diff there means the WIRE CHANGED. If that was intended it is a
// NEW VERSION (new magic, new fixture), not an edit to this one.
const goldenPath = "testdata/golden-v1.b64"

var update = flag.Bool("update", false,
	"rewrite testdata/golden-v1.b64 — only when the wire deliberately changed")

// goldenSchema/goldenPage are a deliberately awkward page: two "kinds" so the
// dictionaries hold more than one entry, a non-ASCII string, a value present
// on only one row, and columns NO row uses — which must encode as a one-entry
// dictionary with no index run, the compression that keeps sparse windows
// small.
func goldenSchema() Schema {
	return Schema{
		Magic:   "TLC1",
		DeltaU:  []string{"id"},
		DeltaZ:  []string{"start"},
		Plain:   []string{"dur", "status", "attempt"},
		Bits:    []string{"final"},
		Strings: []string{"kind", "lane", "delivery_id", "actor_name", "detail"},
	}
}

func goldenPage() Page {
	base := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC).UnixMilli()
	return Page{
		N:                3,
		MaxID:            3,
		RetentionStartMs: base - 24*60*60*1000,
		NowMs:            base + 10_000,
		U:                map[string][]uint64{"id": {1, 2, 3}},
		Z:                map[string][]int64{"start": {base, base + 1500, base + 4000}},
		P: map[string][]uint64{
			"dur":     {3, 12, 250},
			"status":  {0, 200, 502},
			"attempt": {0, 0, 0}, // no row uses it
		},
		B: map[string][]bool{"final": {false, false, false}},
		S: map[string][]string{
			"kind":        {"webhook", "request", "request"},
			"lane":        {"⇐ push", "GET /repos/{owner}/{repo}/pulls", "POST /graphql"},
			"delivery_id": {"d-Ünicode-1", "", ""},
			"actor_name":  {"", "PazerOP", ""},
			"detail":      {"", "", ""}, // no row uses it
		},
	}
}

func TestEncodeMatchesGolden(t *testing.T) {
	b, err := Encode(goldenPage(), goldenSchema())
	require.Nil(t, err)

	got := base64.StdEncoding.EncodeToString(b)

	if *update {
		require.NoError(t, os.WriteFile(goldenPath, []byte(got+"\n"), 0o644))

		t.Logf("wrote %s (%d bytes)", goldenPath, len(b))
		return
	}

	raw, err := os.ReadFile(goldenPath)
	require.Nil(t, err)

	want := strings.TrimSpace(string(raw))
	require.Equal(t, want, got)

}

func TestEncodeRejectsPageSchemaMismatch(t *testing.T) {
	// A short column would encode a payload the decoder can only diagnose much
	// later as "trailing bytes", so it fails here instead.
	p := goldenPage()
	p.P["dur"] = []uint64{1}
	_, err := Encode(p, goldenSchema())
	require.NotNil(t, err)

	p = goldenPage()
	delete(p.S, "detail")
	_, err = Encode(p, goldenSchema())
	require.NotNil(t, err)

	_, err = Encode(goldenPage(), Schema{Magic: "TL1"})
	require.NotNil(t, err)

}
