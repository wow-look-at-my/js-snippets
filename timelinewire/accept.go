package timelinewire

import "strings"

// Wants reports whether an Accept header names mediaType EXACTLY.
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
