//go:build windows

package main

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// onWebviewReady runs fn once win has finished its initial navigation.
//
// boot() runs in a goroutine started before app.Run(), so when the Octop health
// check answers immediately — a remote deployment is typically far quicker
// than spawning a local server — showDashboard can reach window.SetURL() before
// the WebView2 controller exists. beta.13 dereferences it unguarded and the
// shell dies with "invalid memory address or nil pointer dereference" inside
// edge.(*ICoreWebView2).Navigate.
//
// NavigationCompleted fires for *every* load, and fn navigates, so it has to
// stay one-shot: without the guard fn re-navigates on each completion and the
// window reloads forever.
func onWebviewReady(_ *application.App, win *application.WebviewWindow, fn func()) {
	var once sync.Once
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(_ *application.WindowEvent) {
		once.Do(fn)
	})
}
