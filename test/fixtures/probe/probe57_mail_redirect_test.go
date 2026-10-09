package awid

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type probe57RedirectTransport struct {
	t     *testing.T
	calls int
	pub   ed25519.PublicKey
}

func (r *probe57RedirectTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	r.calls++
	if r.calls != 1 || req.Method != "POST" || req.URL.String() != "https://app.aweb.ai/api/v1/messages" {
		r.t.Fatalf("unexpected request %s %s", req.Method, req.URL)
	}
	if req.Header.Get("Authorization") == "" {
		r.t.Fatal("missing authenticated request")
	}
	var body SendMessageRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		r.t.Fatal(err)
	}
	sig, err := base64.RawStdEncoding.DecodeString(body.Signature)
	if err != nil || !ed25519.Verify(r.pub, []byte(body.SignedPayload), sig) || !body.NewConversation || body.ConversationID != "11111111-1111-4111-8111-111111111111" || body.MessageID == "" {
		r.t.Fatal("missing signed fresh request")
	}
	return &http.Response{StatusCode: 307, Header: http.Header{"Location": []string{"https://unqualified.example/v1/messages"}}, Body: io.NopCloser(strings.NewReader("redirect fixture")), Request: req}, nil
}
func TestProbe57ActualMailRejectsRedirect(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	client, err := NewWithIdentity("https://app.aweb.ai/api", key, ComputeDIDKey(pub))
	if err != nil {
		t.Fatal(err)
	}
	transport := &probe57RedirectTransport{t: t, pub: pub}
	redirectChecks := 0
	client.SetHTTPClient(&http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { redirectChecks++; return nil }})
	_, err = client.SendMessage(context.Background(), &SendMessageRequest{ToAlias: "peer", Body: "fixture-nonce", NewConversation: true, ConversationID: "11111111-1111-4111-8111-111111111111"})
	if err == nil || transport.calls != 1 || redirectChecks != 0 {
		t.Fatalf("expected redirect refusal: err=%v calls=%d injected-policy=%d", err, transport.calls, redirectChecks)
	}
	t.Log("actual SendMessage -> Post refuses307, one authenticated signed request, injected redirect policy overridden; zero network calls")
}
