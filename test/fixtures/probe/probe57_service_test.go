package awconfig

import (
	"gopkg.in/yaml.v3"
	"os"
	"testing"
)

func TestProbe57NativeWorkspace(t *testing.T) {
	ws := WorktreeWorkspace{AwebURL: "https://app.aweb.ai/api", HumanName: "Probe fixture", AgentType: "agent", Memberships: []WorktreeMembership{{TeamID: "aweb:test.example", Alias: "worker-1", WorkspaceID: "workspace-fixture", CertPath: "team-certs/aweb__test.example.pem", JoinedAt: "2026-10-09T00:00:00Z"}}}
	data, err := yaml.Marshal(ws)
	if err != nil {
		t.Fatal(err)
	}
	var parsed WorktreeWorkspace
	if err = yaml.Unmarshal(data, &parsed); err != nil || parsed.AwebURL != ws.AwebURL {
		t.Fatal("round trip", err)
	}
	if err = os.WriteFile(os.Getenv("PROBE57_NATIVE_WORKSPACE"), data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Log("native WorktreeWorkspace YAML generation and readback passed")
}
func TestProbe57ServiceSelection(t *testing.T) {
	root, ambient := t.TempDir(), t.TempDir()
	ws := &WorktreeWorkspace{AwebURL: "https://app.aweb.ai/api", Memberships: []WorktreeMembership{{TeamID: "aweb:test.example", Alias: "root", WorkspaceID: "workspace-fixture", CertPath: "missing-fixture.pem"}}}
	if err := SaveWorktreeWorkspaceTo(root+"/workspace.yaml", ws); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/teams.yaml", []byte("active_team: aweb:test.example\nmemberships:\n  - team_id: aweb:test.example\n    alias: root\n    cert_path: missing-fixture.pem\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AWEB_URL", "")
	opts := ResolveOptions{WorkingDir: ambient, IdentityHome: root, ExternalIdentityHome: true, TeamIDOverride: "aweb:test.example", AllowEnvOverrides: true}
	sel, err := ResolveWorkspace(opts)
	if err != nil {
		t.Fatal(err)
	}
	if sel.BaseURL != ws.AwebURL || sel.WorkspacePath != root+"/workspace.yaml" || sel.TeamID != "aweb:test.example" {
		t.Fatalf("wrong selected service: %+v", sel)
	}
	t.Setenv("AWEB_URL", "https://ambient.invalid/api")
	sel, err = ResolveWorkspace(opts)
	if err != nil || sel.BaseURL != "https://ambient.invalid/api" {
		t.Fatal("environment override precedence changed", err)
	}
	t.Setenv("AWEB_URL", "")
	if err = os.Remove(root + "/workspace.yaml"); err != nil {
		t.Fatal(err)
	}
	if _, err = ResolveWorkspace(opts); err == nil {
		t.Fatal("missing explicit-root config silently defaulted")
	}
	t.Log("explicit-root service/team selection, ambient override precedence, and missing-root refusal passed")
}
