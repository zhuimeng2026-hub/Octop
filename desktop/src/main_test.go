package main

import "testing"

func TestResolveDashboardURLPrefersEnvironment(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_URL", "https://env.example/videogen")
	previous := defaultServerURL
	defaultServerURL = "https://build.example/videogen"
	t.Cleanup(func() { defaultServerURL = previous })

	if got := resolveRemoteDashboardURL(); got != "https://env.example/videogen" {
		t.Fatalf("environment variable should win, got %q", got)
	}
}

func TestResolveDashboardURLFallsBackToBuildDefault(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_URL", "")
	previous := defaultServerURL
	defaultServerURL = "https://build.example/videogen"
	t.Cleanup(func() { defaultServerURL = previous })

	if got := resolveRemoteDashboardURL(); got != "https://build.example/videogen" {
		t.Fatalf("build-time default should be used, got %q", got)
	}
}

func TestResolveDashboardURLEmptyMeansLocalRuntime(t *testing.T) {
	t.Setenv("OCTOP_DESKTOP_URL", "")
	previous := defaultServerURL
	defaultServerURL = ""
	t.Cleanup(func() { defaultServerURL = previous })

	if got := resolveRemoteDashboardURL(); got != "" {
		t.Fatalf("empty result should mean local portable runtime, got %q", got)
	}
}
