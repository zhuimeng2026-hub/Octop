//go:build windows

package main

import (
	"encoding/json"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const devSsoPrefix = "desktop:dev-sso:"

type devSsoRequest struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Code  string `json:"code,omitempty"`
	Error string `json:"error,omitempty"`
}

type devSsoBridge struct {
	app          *App
	localOrigin  string
	basePath     string
	remoteOrigin string
	nonce        string
	mu           sync.Mutex
	attempt      *devSsoAttempt
}

type devSsoAttempt struct {
	id    string
	nonce string
	win   *application.WebviewWindow
	timer *time.Timer
}

func attachDevSsoListener(app *application.App, api *App) {
	if !devModeEnabled() {
		return
	}
	local := parseDevSsoURL(resolveRemoteDashboardURL())
	remote := parseDevSsoURL(os.Getenv("OCTOP_DESKTOP_AUTH_URL"))
	if local == nil || local.Scheme != "http" || local.Hostname() != "127.0.0.1" || remote == nil {
		return
	}
	localOrigin, remoteOrigin := devSsoOrigin(local), devSsoOrigin(remote)
	base := strings.TrimRight(local.EscapedPath(), "/")
	if localOrigin == remoteOrigin || base != strings.TrimRight(remote.EscapedPath(), "/") {
		return
	}
	nonce, err := randomToken()
	if err != nil {
		return
	}
	bridge := &devSsoBridge{app: api, localOrigin: localOrigin, basePath: base, remoteOrigin: remoteOrigin, nonce: nonce}
	api.devSso = bridge
	appendWailsEventListener(app, bridge)
}

func parseDevSsoURL(raw string) *url.URL {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	loopback := host == "localhost"
	if ip := net.ParseIP(host); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme == "https" || (u.Scheme == "http" && loopback) {
		return u
	}
	return nil
}

func devSsoOrigin(u *url.URL) string {
	host := strings.ToLower(u.Host)
	if u.Scheme == "https" && u.Port() == "443" {
		host = strings.TrimSuffix(host, ":443")
	}
	if u.Scheme == "http" && u.Port() == "80" {
		host = strings.TrimSuffix(host, ":80")
	}
	return u.Scheme + "://" + host
}

func (a *App) installDevSsoBridge() {
	if a.devSso != nil && a.window != nil {
		a.window.ExecJS(devSsoLocalJS(a.devSso.localOrigin, a.devSso.basePath, a.devSso.nonce))
	}
}

func (b *devSsoBridge) DispatchWailsEvent(event *application.CustomEvent) {
	if event == nil || !strings.HasPrefix(event.Name, devSsoPrefix) || len(event.Name) > 4096 {
		return
	}
	nonce, data, ok := strings.Cut(strings.TrimPrefix(event.Name, devSsoPrefix), ":")
	if !ok || nonce == "" {
		return
	}
	raw, err := url.QueryUnescape(data)
	if err != nil {
		return
	}
	var request devSsoRequest
	if json.Unmarshal([]byte(raw), &request) != nil || request.ID == "" || len(request.ID) > 128 {
		return
	}
	if nonce == b.nonce && request.Kind != "" && request.Code == "" && request.Error == "" {
		application.InvokeAsync(func() { b.open(request) })
	} else if (request.Code != "") != (request.Error != "") {
		application.InvokeAsync(func() { b.complete(nonce, request) })
	}
}

func (b *devSsoBridge) open(request devSsoRequest) {
	b.mu.Lock()
	if b.attempt != nil {
		b.mu.Unlock()
		b.respond(request.ID, "", "busy")
		return
	}
	nonce, err := randomToken()
	if err != nil {
		b.mu.Unlock()
		b.respond(request.ID, "", "unavailable")
		return
	}
	attempt := &devSsoAttempt{id: request.ID, nonce: nonce}
	// On Windows Wails installs JS at document start when the initial
	// document comes from HTML. The script can capture the remote callback
	// before that dashboard tries to exchange the same code.
	win := application.NewWindow(application.WebviewWindowOptions{
		Title:                "Octop 登录",
		Width:                520,
		Height:               720,
		HTML:                 "<!doctype html><title>Octop</title>",
		JS:                   devSsoAuthJS(b.remoteOrigin, b.basePath, nonce, request.ID, request.Kind),
		AllowSimpleEventEmit: true,
	})
	attempt.win = win
	attempt.timer = time.AfterFunc(10*time.Minute, func() {
		application.InvokeAsync(func() { b.finish(attempt, "", "timeout", true) })
	})
	b.attempt = attempt
	b.mu.Unlock()
	var firstNavigation sync.Once
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(_ *application.WindowEvent) {
		firstNavigation.Do(func() {
			win.SetURL(b.remoteOrigin + b.basePath + "/login?desktop=1")
		})
	})
	win.RegisterHook(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		b.finish(attempt, "", "cancelled", false)
	})
	b.app.app.Window.Add(win)
	win.Run()
}

func (b *devSsoBridge) complete(nonce string, request devSsoRequest) {
	b.mu.Lock()
	attempt := b.attempt
	b.mu.Unlock()
	if attempt != nil && nonce == attempt.nonce && request.ID == attempt.id {
		b.finish(attempt, request.Code, request.Error, true)
	}
}

func (b *devSsoBridge) finish(attempt *devSsoAttempt, code, failure string, closeWindow bool) {
	b.mu.Lock()
	if b.attempt != attempt {
		b.mu.Unlock()
		return
	}
	b.attempt = nil
	attempt.timer.Stop()
	b.mu.Unlock()
	if closeWindow {
		attempt.win.Close()
	}
	b.respond(attempt.id, code, failure)
}

func (b *devSsoBridge) respond(id, code, failure string) {
	if b.app.window != nil {
		b.app.window.ExecJS(devSsoResultJS(b.localOrigin, b.basePath, id, code, failure))
	}
}
