// Package timelinewire encodes the columnar payload that ui/timeline-wire.js
// decodes — the wire format for feeding <timeline-view> a large event feed.
//
// ONE IMPLEMENTATION, ONE REPO. The encoder and the decoder are the two halves
// of a single format, so they live and version together, and testdata/ holds
// ONE golden payload that both read: wire_test.go asserts this encoder emits
// exactly those bytes, and timeline-wire.test.ts decodes exactly those bytes.
// Nothing restates the layout anywhere else — a producer imports this package
// rather than reimplementing it, which is how the format used to drift.
//
// Like the decoder, this knows a LAYOUT and not a vocabulary: the caller names
// its own columns in a Schema. The names never reach the wire, so two
// producers with different fields still speak the same format.
//
// THE LAYOUT (v1, magic "TLC1"), in order:
//
//	magic          4 bytes
//	maxId          uvarint   — newest row id; the consumer's next cursor
//	retentionStart varint    — epoch ms; the feed's window floor
//	now            varint    — epoch ms; the producer's clock
//	n              uvarint   — row count
//	<DeltaU columns>  running deltas, unsigned
//	<DeltaZ columns>  running deltas, zigzag-signed
//	<Plain columns>   one uvarint per row
//	<Bits columns>    ceil(n/8) bytes each
//	<Strings columns> dictionary, then one index per row
//
// A change to this layout is a NEW VERSION — new magic, new media type — never
// an edit to this one.
package timelinewire

import (
	"encoding/binary"
	"fmt"
)

// Schema names a payload's columns and says how each is encoded. Order within
// each group is WIRE ORDER and must match the decoder's schema exactly.
type Schema struct {
	// Magic is the 4-byte prefix identifying the layout version.
	Magic string
	// DeltaU: ascending unsigned values, delta-encoded (row ids).
	DeltaU []string
	// DeltaZ: signed values, zigzag delta-encoded (epoch-ms timestamps).
	DeltaZ []string
	// Plain: unsigned values, one uvarint per row (durations, codes).
	Plain []string
	// Bits: booleans, one bit per row.
	Bits []string
	// Strings: dictionary-encoded, one index per row.
	Strings []string
}

// Page is one encodable page: the preamble plus a column per schema entry.
// Every named column must be present and hold exactly N values.
type Page struct {
	// N is the row count; every column must have this length.
	N int
	// MaxID is the newest row id — the consumer's next cursor.
	MaxID uint64
	// RetentionStartMs / NowMs are epoch milliseconds.
	RetentionStartMs int64
	NowMs            int64

	U map[string][]uint64
	Z map[string][]int64
	P map[string][]uint64
	B map[string][]bool
	S map[string][]string
}

// Encode renders a page. It returns an error rather than a short payload when
// the page and the schema disagree: a decoder can only report "trailing bytes"
// long after the fact, so the mismatch is caught where it is still legible.
func Encode(p Page, s Schema) ([]byte, error) {
	if len(s.Magic) != 4 {
		return nil, fmt.Errorf("timelinewire: magic must be 4 bytes, got %q", s.Magic)
	}
	if err := checkLens(p, s); err != nil {
		return nil, err
	}

	// Sized for the measured ~24 B/row so the common case never regrows.
	buf := make([]byte, 0, 512+p.N*24)
	buf = append(buf, s.Magic...)
	buf = binary.AppendUvarint(buf, p.MaxID)
	buf = binary.AppendVarint(buf, p.RetentionStartMs)
	buf = binary.AppendVarint(buf, p.NowMs)
	buf = binary.AppendUvarint(buf, uint64(p.N))

	// Ids are consecutive and timestamps monotonic in practice, so both delta
	// to one byte. The SIGNED delta on timestamps keeps the format correct
	// even when they are not — events recorded at completion can finish out of
	// start order.
	for _, name := range s.DeltaU {
		var prev uint64
		for _, v := range p.U[name] {
			buf = binary.AppendUvarint(buf, v-prev)
			prev = v
		}
	}
	for _, name := range s.DeltaZ {
		var prev int64
		for _, v := range p.Z[name] {
			buf = binary.AppendVarint(buf, v-prev)
			prev = v
		}
	}
	for _, name := range s.Plain {
		for _, v := range p.P[name] {
			buf = binary.AppendUvarint(buf, v)
		}
	}
	for _, name := range s.Bits {
		bits := make([]byte, (p.N+7)/8)
		for i, v := range p.B[name] {
			if v {
				bits[i/8] |= 1 << (i % 8)
			}
		}
		buf = append(buf, bits...)
	}

	// Dictionary, then one index per row. Index 0 is the reserved empty
	// string, so an absent value needs no presence bit — and a column NO row
	// used is written as a dictionary of one with NO index run at all, which
	// the decoder infers from the dictionary size. That is most of why a
	// sparse window stays small.
	idxs := make([]uint64, p.N)
	for _, name := range s.Strings {
		d := newDict()
		for i, v := range p.S[name] {
			idxs[i] = uint64(d.index(v))
		}
		buf = d.appendTo(buf)
		if len(d.strs) == 1 {
			continue
		}
		for _, ix := range idxs {
			buf = binary.AppendUvarint(buf, ix)
		}
	}
	return buf, nil
}

func checkLens(p Page, s Schema) error {
	for _, name := range s.DeltaU {
		if c, ok := p.U[name]; !ok || len(c) != p.N {
			return colErr("U", name, len(p.U[name]), p.N, ok)
		}
	}
	for _, name := range s.DeltaZ {
		if c, ok := p.Z[name]; !ok || len(c) != p.N {
			return colErr("Z", name, len(p.Z[name]), p.N, ok)
		}
	}
	for _, name := range s.Plain {
		if c, ok := p.P[name]; !ok || len(c) != p.N {
			return colErr("P", name, len(p.P[name]), p.N, ok)
		}
	}
	for _, name := range s.Bits {
		if c, ok := p.B[name]; !ok || len(c) != p.N {
			return colErr("B", name, len(p.B[name]), p.N, ok)
		}
	}
	for _, name := range s.Strings {
		if c, ok := p.S[name]; !ok || len(c) != p.N {
			return colErr("S", name, len(p.S[name]), p.N, ok)
		}
	}
	return nil
}

func colErr(group, name string, got, want int, present bool) error {
	if !present {
		return fmt.Errorf("timelinewire: schema names %s column %q but the page has none", group, name)
	}
	return fmt.Errorf("timelinewire: %s column %q has %d values, want %d", group, name, got, want)
}

// dict interns one column's distinct strings, entry 0 always "".
type dict struct {
	byStr map[string]int
	strs  []string
}

func newDict() *dict {
	return &dict{byStr: map[string]int{"": 0}, strs: []string{""}}
}

func (d *dict) index(s string) int {
	if i, ok := d.byStr[s]; ok {
		return i
	}
	i := len(d.strs)
	d.byStr[s] = i
	d.strs = append(d.strs, s)
	return i
}

func (d *dict) appendTo(b []byte) []byte {
	b = binary.AppendUvarint(b, uint64(len(d.strs)))
	for _, s := range d.strs {
		b = binary.AppendUvarint(b, uint64(len(s)))
		b = append(b, s...)
	}
	return b
}
