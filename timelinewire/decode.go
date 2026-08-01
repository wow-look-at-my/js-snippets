package timelinewire

import (
	"encoding/binary"
	"fmt"
)

// Decode is the inverse of Encode, so a Go producer can read its own payload —
// in a test, in a dump tool — without writing a second reader of the format.
//
// A payload that does not decode EXACTLY is an error, trailing bytes included:
// leftovers mean the caller's schema names different columns than the producer
// wrote, which would otherwise surface as silently shifted values.
func Decode(b []byte, s Schema) (Page, error) {
	if len(s.Magic) != 4 {
		return Page{}, fmt.Errorf("timelinewire: magic must be 4 bytes, got %q", s.Magic)
	}
	if len(b) < 4 || string(b[:4]) != s.Magic {
		return Page{}, fmt.Errorf("timelinewire: bad magic, want %q", s.Magic)
	}

	r := &reader{b: b, p: 4}
	p := Page{
		U: map[string][]uint64{}, Z: map[string][]int64{}, P: map[string][]uint64{},
		B: map[string][]bool{}, S: map[string][]string{},
	}
	p.MaxID = r.uvarint()
	p.RetentionStartMs = r.varint()
	p.NowMs = r.varint()
	p.N = int(r.uvarint())
	if r.err != nil {
		return Page{}, r.err
	}
	if p.N < 0 || p.N > len(b) {
		return Page{}, fmt.Errorf("timelinewire: implausible row count %d in %d bytes", p.N, len(b))
	}

	for _, name := range s.DeltaU {
		col := make([]uint64, p.N)
		var prev uint64
		for i := range col {
			prev += r.uvarint()
			col[i] = prev
		}
		p.U[name] = col
	}
	for _, name := range s.DeltaZ {
		col := make([]int64, p.N)
		var prev int64
		for i := range col {
			prev += r.varint()
			col[i] = prev
		}
		p.Z[name] = col
	}
	for _, name := range s.Plain {
		col := make([]uint64, p.N)
		for i := range col {
			col[i] = r.uvarint()
		}
		p.P[name] = col
	}
	for _, name := range s.Bits {
		bits := r.take((p.N + 7) / 8)
		col := make([]bool, p.N)
		for i := range col {
			if r.err == nil {
				col[i] = bits[i/8]&(1<<(i%8)) != 0
			}
		}
		p.B[name] = col
	}
	for _, name := range s.Strings {
		d := r.dict()
		col := make([]string, p.N)
		if len(d) > 1 {
			for i := range col {
				ix := r.uvarint()
				if r.err != nil {
					break
				}
				if ix >= uint64(len(d)) {
					r.fail(fmt.Errorf("timelinewire: column %q index %d past a %d-entry dictionary",
						name, ix, len(d)))
					break
				}
				col[i] = d[ix]
			}
		} else if len(d) == 1 {
			// A column no row used: one dictionary entry, no index run.
			for i := range col {
				col[i] = d[0]
			}
		}
		p.S[name] = col
	}

	if r.err != nil {
		return Page{}, r.err
	}
	if r.p != len(b) {
		return Page{}, fmt.Errorf("timelinewire: %d trailing bytes — the schema disagrees with the payload",
			len(b)-r.p)
	}
	return p, nil
}

// reader walks the payload, latching the first error so every read after it is
// a no-op and the caller checks once.
type reader struct {
	b   []byte
	p   int
	err error
}

func (r *reader) fail(err error) {
	if r.err == nil {
		r.err = err
	}
}

func (r *reader) uvarint() uint64 {
	if r.err != nil {
		return 0
	}
	v, n := binary.Uvarint(r.b[r.p:])
	if n <= 0 {
		r.fail(fmt.Errorf("timelinewire: truncated uvarint at offset %d", r.p))
		return 0
	}
	r.p += n
	return v
}

func (r *reader) varint() int64 {
	if r.err != nil {
		return 0
	}
	v, n := binary.Varint(r.b[r.p:])
	if n <= 0 {
		r.fail(fmt.Errorf("timelinewire: truncated varint at offset %d", r.p))
		return 0
	}
	r.p += n
	return v
}

func (r *reader) take(n int) []byte {
	if r.err != nil {
		return nil
	}
	if r.p+n > len(r.b) {
		r.fail(fmt.Errorf("timelinewire: truncated payload: want %d bytes at offset %d", n, r.p))
		return nil
	}
	out := r.b[r.p : r.p+n]
	r.p += n
	return out
}

func (r *reader) dict() []string {
	n := int(r.uvarint())
	if r.err != nil || n < 0 {
		return nil
	}
	out := make([]string, n)
	for i := range out {
		s := r.take(int(r.uvarint()))
		if r.err != nil {
			return nil
		}
		out[i] = string(s)
	}
	return out
}
