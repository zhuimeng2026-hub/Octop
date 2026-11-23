package main

import (
	"strings"
	"testing"
)

func withDefaultDevMode(t *testing.T, value string) {
	t.Helper()
	previous := defaultDevMode
	defaultDevMode = value
	t.Cleanup(func() { defaultDevMode = previous })
}

func TestDevModeEnabled(t *testing.T) {
	cases := []struct {
		name    string
		env     string
		builtIn string
		want    bool
	}{
		{name: "off by default", env: "", builtIn: "", want: false},
		{name: "build-time default on", env: "", builtIn: "1", want: true},
		{name: "environment turns it on", env: "1", builtIn: "", want: true},
		{name: "environment turns it off", env: "0", builtIn: "1", want: false},
		{name: "environment false wins", env: "false", builtIn: "1", want: false},
		{name: "environment true wins", env: "true", builtIn: "", want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("OCTOP_DESKTOP_DEV", tc.env)
			withDefaultDevMode(t, tc.builtIn)

			if got := devModeEnabled(); got != tc.want {
				t.Fatalf("devModeEnabled() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestDevInspectorOnStartupFollowsDevMode(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_DEVTOOLS", "")
	t.Setenv("OCTOP_DESKTOP_DEV", "1")
	withDefaultDevMode(t, "")

	if !devInspectorOnStartup() {
		t.Fatal("developer mode should open the inspector on startup by default")
	}
}

func TestDevInspectorOnStartupCanBeDisabled(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_DEVTOOLS", "0")
	t.Setenv("OCTOP_DESKTOP_DEV", "1")
	withDefaultDevMode(t, "")

	if devInspectorOnStartup() {
		t.Fatal("OCTOP_DESKTOP_DEVTOOLS=0 should keep the inspector closed")
	}
}

func TestDevKeyBindingsOnlyInDevMode(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_DEV", "")
	withDefaultDevMode(t, "")

	if devKeyBindings() != nil {
		t.Fatal("no key bindings outside developer mode")
	}

	t.Setenv("OCTOP_DESKTOP_DEV", "1")
	bindings := devKeyBindings()
	if len(bindings) == 0 {
		t.Fatal("developer mode should register the inspector shortcut")
	}
}

func TestDevBrowserArgsOnlyInDevMode(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_DEV", "")
	withDefaultDevMode(t, "")

	if args := devBrowserArgs(); len(args) != 0 {
		t.Fatalf("no browser args outside developer mode, got %v", args)
	}

	t.Setenv("OCTOP_DESKTOP_DEV", "1")
	args := devBrowserArgs()
	if len(args) == 0 {
		t.Fatal("developer mode should relax the local network restrictions")
	}
	joined := strings.Join(args, " ")
	// A fake-IP proxy resolves localhost.weixin.qq.com to a 198.18.x address,
	// so the WeChat quick-login probe never reaches the local bridge.
	if !strings.Contains(joined, "MAP localhost.weixin.qq.com 127.0.0.1") {
		t.Fatalf("browser args should pin the WeChat bridge host to loopback, got %v", args)
	}
}

func TestDevModeNeedsRemoteTarget(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_URL", "")
	previous := defaultServerURL
	defaultServerURL = ""
	t.Cleanup(func() { defaultServerURL = previous })

	t.Setenv("OCTOP_DESKTOP_DEV", "1")
	if !devModeNeedsRemoteTarget() {
		t.Fatal("developer mode without a remote target must not start the local runtime")
	}

	t.Setenv("OCTOP_DESKTOP_DEV", "")
	if devModeNeedsRemoteTarget() {
		t.Fatal("outside developer mode the local runtime stays available")
	}

	t.Setenv("OCTOP_DESKTOP_DEV", "1")
	t.Setenv("OCTOP_DESKTOP_URL", "https://ocbot.aixifs.com/videogen")
	if devModeNeedsRemoteTarget() {
		t.Fatal("a configured remote target satisfies developer mode")
	}
}
