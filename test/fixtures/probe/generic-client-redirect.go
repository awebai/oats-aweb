// Generic http.Client behavior only. This bypasses the native mail no-redirect wrapper.
package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type transport struct{ calls int }

func (t *transport) RoundTrip(r *http.Request) (*http.Response, error) {
	t.calls++
	body, _ := io.ReadAll(r.Body)
	fmt.Printf("hop=%d method=%s origin=%s://%s body=%s\n", t.calls, r.Method, r.URL.Scheme, r.URL.Host, body)
	if t.calls == 1 {
		return &http.Response{StatusCode: 307, Header: http.Header{"Location": []string{"https://unqualified.example/v1/messages"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	}
	if r.URL.Host != "unqualified.example" || string(body) != "synthetic-signed-request" {
		panic("unexpected redirected request")
	}
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("{}")), Request: r}, nil
}
func main() {
	t := &transport{}
	c := &http.Client{Transport: t}
	r, _ := http.NewRequest("POST", "https://app.aweb.ai/api/v1/messages", bytes.NewReader([]byte("synthetic-signed-request")))
	res, err := c.Do(r)
	if err != nil {
		panic(err)
	}
	res.Body.Close()
	if t.calls != 2 {
		panic("redirect was not followed")
	}
	fmt.Println("PASS: default client followed cross-origin 307 with unchanged POST bytes; custom RoundTripper made zero network calls")
}
