package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestProbe57PathRebasePreservesSignedRequest(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	signed := `{"type":"mail","message_id":"fixture-message","conversation_id":"fixture-conversation","body":"fixture-nonce"}`
	payload := map[string]any{"new_conversation": true, "conversation_id": "fixture-conversation", "signed_payload": signed, "signature": base64.RawStdEncoding.EncodeToString(ed25519.Sign(priv, []byte(signed)))}
	wire, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, "https://app.aweb.ai/api/v1/messages", bytes.NewReader(wire))
	if err != nil {
		t.Fatal(err)
	}
	transport := baseURLFallbackTransport{state: &baseURLFallbackState{configuredBaseURL: "https://app.aweb.ai/api"}}
	rebased, err := transport.requestForBase(req, "https://app.aweb.ai")
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(rebased.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, wire) || rebased.URL.String() != "https://app.aweb.ai/v1/messages" || rebased.Method != http.MethodPost {
		t.Fatal("request body/method/origin changed")
	}
	var result map[string]any
	if err = json.Unmarshal(got, &result); err != nil {
		t.Fatal(err)
	}
	sig, err := base64.RawStdEncoding.DecodeString(result["signature"].(string))
	if err != nil || !ed25519.Verify(pub, []byte(result["signed_payload"].(string)), sig) {
		t.Fatal("signature changed")
	}
	t.Log("same-origin path rebase preserved exact serialized body, fresh flag, IDs and Ed25519 signature; no HTTP request")
}
