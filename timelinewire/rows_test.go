package timelinewire

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// goldenRow declares, as tags, exactly the columns goldenSchema() names by
// hand — so the two paths must agree byte for byte on the shared fixture.
// That is what makes the tagged path a refactor of the manual one rather than
// a second format.
type goldenRow struct {
	ID         uint64    `wire:"id,deltau"`
	Kind       string    `wire:"kind,string"`
	Lane       string    `wire:"lane,string"`
	Start      time.Time `wire:"start,deltaz"`
	DurMs      int64     `wire:"dur,plain"`
	DeliveryID string    `wire:"delivery_id,string"`
	Status     int       `wire:"status,plain"`
	ActorName  string    `wire:"actor_name,string"`
	Detail     string    `wire:"detail,string"`
	Attempt    int       `wire:"attempt,plain"`
	Final      bool      `wire:"final,bits"`

	// No tag: a row type may carry fields the wire has no use for.
	internalNote string //nolint:unused // presence is the point
}

func goldenRows() ([]goldenRow, Header) {
	p := goldenPage()
	rows := make([]goldenRow, p.N)
	for i := range rows {
		rows[i] = goldenRow{
			ID:         p.U["id"][i],
			Kind:       p.S["kind"][i],
			Lane:       p.S["lane"][i],
			Start:      time.UnixMilli(p.Z["start"][i]).UTC(),
			DurMs:      int64(p.P["dur"][i]),
			DeliveryID: p.S["delivery_id"][i],
			Status:     int(p.P["status"][i]),
			ActorName:  p.S["actor_name"][i],
			Detail:     p.S["detail"][i],
			Attempt:    int(p.P["attempt"][i]),
			Final:      p.B["final"][i],
		}
	}
	return rows, Header{MaxID: p.MaxID, RetentionStartMs: p.RetentionStartMs, NowMs: p.NowMs}
}

// The tagged path must emit the SAME BYTES as the hand-built page, against the
// same fixture the browser decodes. Anything else and tagging a struct would
// quietly be a different format.
func TestEncodeRowsMatchesGolden(t *testing.T) {
	rows, h := goldenRows()
	got, err := EncodeRows(rows, h, "TLC1")
	require.NoError(t, err)

	raw, err := os.ReadFile(goldenPath)
	require.NoError(t, err)
	assert.Equal(t, strings.TrimSpace(string(raw)), base64.StdEncoding.EncodeToString(got))
}

// The derived schema must equal the hand-written one — including ORDER, which
// is what the wire actually depends on.
func TestSchemaOfMatchesHandWritten(t *testing.T) {
	got, err := SchemaOf(goldenRow{}, "TLC1")
	require.NoError(t, err)
	assert.Equal(t, goldenSchema(), got)
}

func TestDecodeRowsRoundTrip(t *testing.T) {
	rows, h := goldenRows()
	b, err := EncodeRows(rows, h, "TLC1")
	require.NoError(t, err)

	var back []goldenRow
	gotH, err := DecodeRows(b, &back, "TLC1")
	require.NoError(t, err)
	assert.Equal(t, h, gotH)
	assert.Equal(t, rows, back)
}

// A pointer slice is the other shape a producer's rows arrive in.
func TestEncodeRowsAcceptsPointers(t *testing.T) {
	rows, h := goldenRows()
	ptrs := make([]*goldenRow, len(rows))
	for i := range rows {
		ptrs[i] = &rows[i]
	}
	want, err := EncodeRows(rows, h, "TLC1")
	require.NoError(t, err)
	got, err := EncodeRows(ptrs, h, "TLC1")
	require.NoError(t, err)
	assert.Equal(t, want, got)

	var back []*goldenRow
	_, err = DecodeRows(got, &back, "TLC1")
	require.NoError(t, err)
	require.Len(t, back, len(rows))
	assert.Equal(t, rows[1], *back[1])
}

func TestEncodeRowsEmpty(t *testing.T) {
	b, err := EncodeRows([]goldenRow{}, Header{}, "TLC1")
	require.NoError(t, err)
	var back []goldenRow
	_, err = DecodeRows(b, &back, "TLC1")
	require.NoError(t, err)
	assert.Empty(t, back)
}

// A bad tag is a programming error, and it must surface when the plan is
// built — naming the field — rather than as a short payload much later.
func TestRowPlanRejectsBadDeclarations(t *testing.T) {
	type noTags struct{ ID uint64 }
	type badKind struct {
		ID uint64 `wire:"id,uvarint"`
	}
	type badShape struct {
		ID uint64 `wire:"id"`
	}
	type wrongType struct {
		Lane int `wire:"lane,string"`
	}
	type dupeName struct {
		A string `wire:"lane,string"`
		B string `wire:"lane,string"`
	}
	type signedID struct {
		ID int64 `wire:"id,deltau"`
	}

	for _, tc := range []struct {
		row  any
		want string
	}{
		{noTags{}, "no `wire` tags"},
		{badKind{}, "unknown column kind"},
		{badShape{}, `want "name,kind"`},
		{wrongType{}, "needs a string"},
		{dupeName{}, `declares column "lane" twice`},
		{signedID{}, "needs an unsigned integer"},
	} {
		_, err := SchemaOf(tc.row, "TLC1")
		require.ErrorContains(t, err, tc.want)
		_, err = EncodeRows([]any{}, Header{}, "TLC1")
		require.Error(t, err, "a non-struct element type must also be refused")
	}
}

func TestEncodeRowsRejectsNonSlice(t *testing.T) {
	_, err := EncodeRows(goldenRow{}, Header{}, "TLC1")
	require.ErrorContains(t, err, "wants a slice")

	var notAPointer []goldenRow
	_, err = DecodeRows([]byte("TLC1"), notAPointer, "TLC1")
	require.ErrorContains(t, err, "wants *[]Struct")
}

// time.Time columns land back as UTC epoch-ms — the wire carries no zone, so
// a decode must not invent one from the local clock.
func TestTimeColumnsRoundTripAsUTCMillis(t *testing.T) {
	type row struct {
		ID uint64    `wire:"id,deltau"`
		At time.Time `wire:"at,deltaz"`
	}
	in := []row{{ID: 1, At: time.Date(2026, 3, 4, 5, 6, 7, 891_000_000, time.FixedZone("x", 3600))}}
	b, err := EncodeRows(in, Header{}, "TLC1")
	require.NoError(t, err)

	var back []row
	_, err = DecodeRows(b, &back, "TLC1")
	require.NoError(t, err)
	require.Len(t, back, 1)
	assert.True(t, back[0].At.Equal(in[0].At), "same instant")
	assert.Equal(t, time.UTC, back[0].At.Location())
	assert.Equal(t, in[0].At.UnixMilli(), back[0].At.UnixMilli())
}

func TestWants(t *testing.T) {
	const mt = "application/vnd.example.v1"
	assert.True(t, Wants(mt, mt))
	assert.True(t, Wants("application/json, "+mt+";q=0.9", mt))
	assert.True(t, Wants(" APPLICATION/VND.EXAMPLE.V1 ", mt), "media types are case-insensitive")

	// The whole reason the match is exact: a wildcard must keep meaning the
	// readable encoding, or the endpoint stops being inspectable by hand.
	assert.False(t, Wants("*/*", mt))
	assert.False(t, Wants("application/*", mt))
	assert.False(t, Wants("", mt))
	assert.False(t, Wants(mt+"x", mt))
	assert.False(t, Wants("application/vnd.example.v2", mt))
	assert.False(t, Wants(mt, ""))
}

// What tagging COSTS, kept measurable rather than asserted. The pair runs the
// same 100k rows through EncodeRows and through the hand-written mapping it
// replaces, so the price of reflection stays a number anyone can re-read:
//
//	go test -bench BenchmarkEncode -benchmem ./...
//
// Reflection is ~1.8x the mapping step and allocates no more (per-type plans,
// column slices addressed directly rather than through the page's maps, and
// time.Time read through its address so a three-word value never boxes). In
// absolute terms that is 18 ms against 10 for a FULL 100k ring, once, on the
// server; the hour-long window a chart actually first-paints is ~4k rows,
// well under a millisecond either way.
func benchRows() ([]goldenRow, Header) {
	rows := make([]goldenRow, 100_000)
	base := time.UnixMilli(1_780_000_000_000).UTC()
	for i := range rows {
		rows[i] = goldenRow{
			ID: uint64(i + 1), Kind: "request", Lane: "GET /repos/{owner}/{repo}/pulls",
			Start: base.Add(time.Duration(i) * time.Millisecond),
			DurMs: int64(i % 400), Status: 200, ActorName: "installation-account",
		}
	}
	return rows, Header{MaxID: uint64(len(rows)), NowMs: base.UnixMilli()}
}

func BenchmarkEncodeRows(b *testing.B) {
	rows, h := benchRows()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := EncodeRows(rows, h, "TLC1")
		require.Nil(b, err)

	}
}

// The mapping EncodeRows replaces, written out by hand — what every producer
// would otherwise carry.
func BenchmarkEncodeManualMapping(b *testing.B) {
	rows, h := benchRows()
	n := len(rows)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		id := make([]uint64, n)
		start := make([]int64, n)
		dur := make([]uint64, n)
		status := make([]uint64, n)
		attempt := make([]uint64, n)
		final := make([]bool, n)
		kind := make([]string, n)
		lane := make([]string, n)
		delivery := make([]string, n)
		actorName := make([]string, n)
		detail := make([]string, n)
		for j := range rows {
			id[j] = rows[j].ID
			start[j] = rows[j].Start.UnixMilli()
			dur[j] = uint64(rows[j].DurMs)
			status[j] = uint64(rows[j].Status)
			attempt[j] = uint64(rows[j].Attempt)
			final[j] = rows[j].Final
			kind[j] = rows[j].Kind
			lane[j] = rows[j].Lane
			delivery[j] = rows[j].DeliveryID
			actorName[j] = rows[j].ActorName
			detail[j] = rows[j].Detail
		}
		page := Page{
			N: n, MaxID: h.MaxID, RetentionStartMs: h.RetentionStartMs, NowMs: h.NowMs,
			U: map[string][]uint64{"id": id},
			Z: map[string][]int64{"start": start},
			P: map[string][]uint64{"dur": dur, "status": status, "attempt": attempt},
			B: map[string][]bool{"final": final},
			S: map[string][]string{"kind": kind, "lane": lane, "delivery_id": delivery,
				"actor_name": actorName, "detail": detail},
		}
		_, err := Encode(page, goldenSchema())
		require.Nil(b, err)

	}
}
