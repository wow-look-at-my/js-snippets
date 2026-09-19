package timelinewire

import "strings"

// Wants reports whether an Accept header names mediaType EXACTLY.
//
// A producer serving this format alongside a readable a single needs this,
// and the exactness is the whole point: a wildcard (`*/*`, what curl and
// browsers send) must NOT select a binary payload, or the endpoint stops
// being inspectable by hand.
//
// A consumer of this format should send this media type ALONE and refuse any
// other content type in the answer. That refusal is what makes serving
// another encoding safe: without it, an Accept that drifts is a silent
// downgrade to a far slower path with nothing failing and nothing logged.
func Wants(accept, mediaType string) bool {
	want := strings.ToLower(strings.TrimSpace(mediaType))
	if want == "" {
		return false
	}
	for _, part := range strings.Split(accept, ",") {
		got, _, _ := strings.Cut(part, ";")
		if strings.EqualFold(strings.TrimSpace(got), want) {
			return true
		}
	}
	return false
}
