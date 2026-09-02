package timelinewire

import (
	"fmt"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/wow-look-at-my/go-containers/set"
)

// Rows: encode and decode a slice of TAGGED STRUCTS, so a producer declares
// its columns once on the type it already has and writes no mapping code.
//
// Page/Schema stay exported for a producer whose rows are not structs (columns
// straight out of a database, say). Every producer that DOES have a row type
// should use these instead: the map-building, the name switch, and their
// inverse for reading a payload back are identical in every consumer, and
// hand-writing them is how a column silently goes missing from one of the two
// directions.
//
//	type Event struct {
//	    ID    uint64    `wire:"id,deltau"`
//	    Start time.Time `wire:"start,deltaz"`
//	    DurMs int64     `wire:"dur,plain"`
//	    Lane  string    `wire:"lane,string"`
//	    Final bool      `wire:"final,bits"`
//	}
//
//	b, err := timelinewire.EncodeRows(events, hdr, "TLC1")
//
// WIRE ORDER is struct field order within each kind, so the layout is a
// property of the declaration and cannot drift from it. Reordering fields of
// one kind reorders the wire — that is a format change, so it needs a new
// magic like any other.
//
// Untagged fields are ignored, which is what lets a row type carry things the
// wire has no use for.

// Header is a page's preamble — everything in a payload that is not a column.
type Header struct {
	// MaxID is the newest row id, the consumer's next cursor.
	MaxID uint64
	// RetentionStartMs / NowMs are epoch milliseconds.
	RetentionStartMs int64
	NowMs            int64
}

// Column kinds, as written in the second half of a `wire:"name,kind"` tag.
const (
	KindDeltaU = "deltau" // ascending unsigned, delta-encoded (ids)
	KindDeltaZ = "deltaz" // signed, zigzag delta-encoded (epoch ms / time.Time)
	KindPlain  = "plain"  // unsigned, one uvarint per row
	KindBits   = "bits"   // one bit per row
	KindString = "string" // dictionary-encoded
)

// EncodeRows renders a slice of tagged structs. rows must be a slice (or
// array) of a struct type or of pointers to one.
func EncodeRows(rows any, h Header, magic string) ([]byte, error) {
	rv := reflect.ValueOf(rows)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil, fmt.Errorf("timelinewire: EncodeRows wants a slice of structs, got %T", rows)
	}
	p, err := planOf(rv.Type().Elem())
	if err != nil {
		return nil, err
	}

	// Column storage is allocated ONCE and addressed through local slices in
	// the row loop. Indexing page.U[c.name] per row would be a string-keyed
	// map lookup per column per row -- ~2M of them on a full page, which is
	// most of what this path could cost over a hand-written mapping.
	n := rv.Len()
	us := make([][]uint64, len(p.deltaU))
	zs := make([][]int64, len(p.deltaZ))
	ps := make([][]uint64, len(p.plain))
	bs := make([][]bool, len(p.bits))
	ss := make([][]string, len(p.strings))
	page := Page{
		N: n, MaxID: h.MaxID, RetentionStartMs: h.RetentionStartMs, NowMs: h.NowMs,
		U: make(map[string][]uint64, len(p.deltaU)),
		Z: make(map[string][]int64, len(p.deltaZ)),
		P: make(map[string][]uint64, len(p.plain)),
		B: make(map[string][]bool, len(p.bits)),
		S: make(map[string][]string, len(p.strings)),
	}
	for i, c := range p.deltaU {
		us[i] = make([]uint64, n)
		page.U[c.name] = us[i]
	}
	for i, c := range p.deltaZ {
		zs[i] = make([]int64, n)
		page.Z[c.name] = zs[i]
	}
	for i, c := range p.plain {
		ps[i] = make([]uint64, n)
		page.P[c.name] = ps[i]
	}
	for i, c := range p.bits {
		bs[i] = make([]bool, n)
		page.B[c.name] = bs[i]
	}
	for i, c := range p.strings {
		ss[i] = make([]string, n)
		page.S[c.name] = ss[i]
	}

	// One pass per ROW rather than per column: the row is what is in cache.
	for i := 0; i < n; i++ {
		row := deref(rv.Index(i))
		for j, c := range p.deltaU {
			us[j][i] = row.FieldByIndex(c.index).Uint()
		}
		for j, c := range p.deltaZ {
			zs[j][i] = c.readMs(row.FieldByIndex(c.index))
		}
		for j, c := range p.plain {
			ps[j][i] = c.readUint(row.FieldByIndex(c.index))
		}
		for j, c := range p.bits {
			bs[j][i] = row.FieldByIndex(c.index).Bool()
		}
		for j, c := range p.strings {
			ss[j][i] = row.FieldByIndex(c.index).String()
		}
	}
	return Encode(page, p.schema(magic))
}

// DecodeRows reads a payload back into rows, the inverse of EncodeRows. out
// must be a pointer to a slice of the same struct type; it is replaced with a
// slice of exactly the payload's length.
func DecodeRows(b []byte, out any, magic string) (Header, error) {
	pv := reflect.ValueOf(out)
	if pv.Kind() != reflect.Ptr || pv.IsNil() || pv.Elem().Kind() != reflect.Slice {
		return Header{}, fmt.Errorf("timelinewire: DecodeRows wants *[]Struct, got %T", out)
	}
	sliceType := pv.Elem().Type()
	p, err := planOf(sliceType.Elem())
	if err != nil {
		return Header{}, err
	}

	page, err := Decode(b, p.schema(magic))
	if err != nil {
		return Header{}, err
	}

	rows := reflect.MakeSlice(sliceType, page.N, page.N)
	for i := 0; i < page.N; i++ {
		row := deref(rows.Index(i))
		for _, c := range p.deltaU {
			row.FieldByIndex(c.index).SetUint(page.U[c.name][i])
		}
		for _, c := range p.deltaZ {
			c.writeMs(row.FieldByIndex(c.index), page.Z[c.name][i])
		}
		for _, c := range p.plain {
			c.writeUint(row.FieldByIndex(c.index), page.P[c.name][i])
		}
		for _, c := range p.bits {
			row.FieldByIndex(c.index).SetBool(page.B[c.name][i])
		}
		for _, c := range p.strings {
			row.FieldByIndex(c.index).SetString(page.S[c.name][i])
		}
	}
	pv.Elem().Set(rows)
	return Header{MaxID: page.MaxID, RetentionStartMs: page.RetentionStartMs, NowMs: page.NowMs}, nil
}

// SchemaOf derives the Schema a row type declares. A producer needs it to
// state its column names somewhere a test can compare them against the
// consumer's — the library never sees the names as anything but strings, so
// nothing else can catch the two disagreeing.
func SchemaOf(rowType any, magic string) (Schema, error) {
	t := reflect.TypeOf(rowType)
	if t == nil {
		return Schema{}, fmt.Errorf("timelinewire: SchemaOf needs a value of the row type")
	}
	p, err := planOf(t)
	if err != nil {
		return Schema{}, err
	}
	return p.schema(magic), nil
}

// deref addresses through a pointer element so a []*Row works like a []Row.
// An encode reads through a nil pointer's zero value; a decode allocates.
func deref(v reflect.Value) reflect.Value {
	if v.Kind() != reflect.Ptr {
		return v
	}
	if v.IsNil() {
		if !v.CanSet() {
			return reflect.New(v.Type().Elem()).Elem()
		}
		v.Set(reflect.New(v.Type().Elem()))
	}
	return v.Elem()
}

// --- the per-type plan -------------------------------------------------------

type column struct {
	name  string
	index []int
	// isTime marks a deltaZ column backed by time.Time rather than an integer.
	isTime bool
	// signed marks a plain column read from a signed field.
	signed bool
}

func (c column) readMs(v reflect.Value) int64 {
	if c.isTime {
		// Through the ADDRESS: a time.Time is three words, so boxing the value
		// into an interface heap-allocates once per row. A *time.Time is one
		// word and boxes for free. Slice elements are addressable; a value
		// that somehow is not falls back to the copy.
		if v.CanAddr() {
			return v.Addr().Interface().(*time.Time).UnixMilli()
		}
		return v.Interface().(time.Time).UnixMilli()
	}
	return v.Int()
}

func (c column) writeMs(v reflect.Value, ms int64) {
	if c.isTime {
		v.Set(reflect.ValueOf(time.UnixMilli(ms).UTC()))
		return
	}
	v.SetInt(ms)
}

func (c column) readUint(v reflect.Value) uint64 {
	if c.signed {
		return uint64(v.Int())
	}
	return v.Uint()
}

func (c column) writeUint(v reflect.Value, u uint64) {
	if c.signed {
		v.SetInt(int64(u))
		return
	}
	v.SetUint(u)
}

type plan struct {
	deltaU, deltaZ, plain, bits, strings []column
}

func (p *plan) schema(magic string) Schema {
	names := func(cs []column) []string {
		out := make([]string, len(cs))
		for i, c := range cs {
			out[i] = c.name
		}
		return out
	}
	return Schema{
		Magic:   magic,
		DeltaU:  names(p.deltaU),
		DeltaZ:  names(p.deltaZ),
		Plain:   names(p.plain),
		Bits:    names(p.bits),
		Strings: names(p.strings),
	}
}

// Plans are derived once per type: reflecting over the struct on every row of
// a 100k-row page is the one place this could cost more than the hand-written
// mapping it replaces.
var plans sync.Map // reflect.Type -> *plan (or error)

type planErr struct{ err error }

func planOf(t reflect.Type) (*plan, error) {
	for t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	if cached, ok := plans.Load(t); ok {
		if e, bad := cached.(planErr); bad {
			return nil, e.err
		}
		return cached.(*plan), nil
	}
	p, err := buildPlan(t)
	if err != nil {
		plans.Store(t, planErr{err})
		return nil, err
	}
	plans.Store(t, p)
	return p, nil
}

var timeType = reflect.TypeOf(time.Time{})

func buildPlan(t reflect.Type) (*plan, error) {
	if t.Kind() != reflect.Struct {
		return nil, fmt.Errorf("timelinewire: row type must be a struct, got %s", t.Kind())
	}
	p := &plan{}
	seen := set.New[string](t.NumField())
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		tag, ok := f.Tag.Lookup("wire")
		if !ok || tag == "-" {
			continue
		}
		if f.PkgPath != "" {
			return nil, fmt.Errorf("timelinewire: %s.%s is unexported and cannot be a column", t.Name(), f.Name)
		}
		name, kind, found := strings.Cut(tag, ",")
		if !found || name == "" || kind == "" {
			return nil, fmt.Errorf(`timelinewire: %s.%s has tag %q, want "name,kind"`, t.Name(), f.Name, tag)
		}
		// Add reports whether the name was new, so the duplicate check and the
		// insert are one hash rather than two.
		if !seen.Add(name) {
			// Two fields under one name would encode twice and decode into
			// whichever won, silently dropping the other.
			return nil, fmt.Errorf("timelinewire: %s declares column %q twice", t.Name(), name)
		}

		c := column{name: name, index: f.Index}
		switch kind {
		case KindDeltaU:
			if f.Type.Kind() != reflect.Uint64 && f.Type.Kind() != reflect.Uint32 && f.Type.Kind() != reflect.Uint {
				return nil, colKindErr(t, f, kind, "an unsigned integer")
			}
			p.deltaU = append(p.deltaU, c)
		case KindDeltaZ:
			switch {
			case f.Type == timeType:
				c.isTime = true
			case f.Type.Kind() == reflect.Int64 || f.Type.Kind() == reflect.Int:
			default:
				return nil, colKindErr(t, f, kind, "time.Time or a signed integer")
			}
			p.deltaZ = append(p.deltaZ, c)
		case KindPlain:
			switch f.Type.Kind() {
			case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
				c.signed = true
			case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
			default:
				return nil, colKindErr(t, f, kind, "an integer")
			}
			p.plain = append(p.plain, c)
		case KindBits:
			if f.Type.Kind() != reflect.Bool {
				return nil, colKindErr(t, f, kind, "a bool")
			}
			p.bits = append(p.bits, c)
		case KindString:
			if f.Type.Kind() != reflect.String {
				return nil, colKindErr(t, f, kind, "a string")
			}
			p.strings = append(p.strings, c)
		default:
			return nil, fmt.Errorf("timelinewire: %s.%s has unknown column kind %q (want %s, %s, %s, %s or %s)",
				t.Name(), f.Name, kind, KindDeltaU, KindDeltaZ, KindPlain, KindBits, KindString)
		}
	}
	if len(p.deltaU)+len(p.deltaZ)+len(p.plain)+len(p.bits)+len(p.strings) == 0 {
		return nil, fmt.Errorf("timelinewire: %s has no `wire` tags — nothing to encode", t.Name())
	}
	return p, nil
}

func colKindErr(t reflect.Type, f reflect.StructField, kind, want string) error {
	return fmt.Errorf("timelinewire: %s.%s is %s, but column kind %q needs %s",
		t.Name(), f.Name, f.Type, kind, want)
}
