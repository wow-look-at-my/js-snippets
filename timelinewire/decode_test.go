package timelinewire

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func goldenBytes(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(goldenPath)
	require.NoError(t, err)
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	require.NoError(t, err)
	return b
}

// The Go reader and the Go writer must agree on the fixture the BROWSER reads.
// Decoding the golden payload rather than something freshly encoded is what
// makes this a check on the FORMAT and not just on two functions in this file.
func TestDecodeGolden(t *testing.T) {
	got, err := Decode(goldenBytes(t), goldenSchema())
	require.NoError(t, err)

	want := goldenPage()
	assert.Equal(t, want.N, got.N)
	assert.Equal(t, want.MaxID, got.MaxID)
	assert.Equal(t, want.RetentionStartMs, got.RetentionStartMs)
	assert.Equal(t, want.NowMs, got.NowMs)
	assert.Equal(t, want.U, got.U)
	assert.Equal(t, want.Z, got.Z)
	assert.Equal(t, want.P, got.P)
	assert.Equal(t, want.B, got.B)
	// Includes "detail", which no row used: it rides as a one-entry dictionary
	// with no index run and must still read back as "" for every row.
	assert.Equal(t, want.S, got.S)
}

// A payload that does not decode exactly did not decode.
func TestDecodeRejectsCorruptPayloads(t *testing.T) {
	good := goldenBytes(t)

	_, err := Decode(good[:len(good)-4], goldenSchema())
	require.Error(t, err, "a truncated payload must not decode")

	bad := append([]byte(nil), good...)
	bad[0] = 'X'
	_, err = Decode(bad, goldenSchema())
	require.ErrorContains(t, err, "bad magic")

	_, err = Decode(append(append([]byte(nil), good...), 0), goldenSchema())
	require.ErrorContains(t, err, "trailing bytes")

	// A schema naming fewer columns than the producer wrote is the realistic
	// version of the same disagreement.
	short := goldenSchema()
	short.Strings = short.Strings[:len(short.Strings)-1]
	_, err = Decode(good, short)
	require.ErrorContains(t, err, "trailing bytes")
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	b, err := Encode(goldenPage(), goldenSchema())
	require.NoError(t, err)
	got, err := Decode(b, goldenSchema())
	require.NoError(t, err)
	assert.Equal(t, goldenPage(), got)
}
