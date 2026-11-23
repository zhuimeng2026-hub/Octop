package main

import (
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// 开发模式（developer mode）—— PC 端外壳的调试形态。
//
// 开发模式做三件事：
//
//  1. 直连远程后台。外壳不解包/下载本地 portable 运行时，也不启动本地
//     Python 进程，而是把 WebView 直接导航到已在运行的 Octop 后台地址。
//     没有配置远程地址时，开发模式直接报错，不会退回本地运行时——
//     “悄悄跑起一个本地 Octop”正是开发时最常见的困惑来源。
//  2. 打开开发者工具。主窗口启用 WebView 开发者工具，Ctrl+Shift+D 随时
//     唤起；WebView2 默认右键菜单里的“检查”条目也保留。
//  3. 详细日志。导航日志同时打到 stderr，wails3 dev 的控制台能实时看到
//     页面到底加载了哪个地址、哪些请求失败。
//
// 开启方式：
//
//	OCTOP_DESKTOP_DEV=1        环境变量，运行时生效
//	-X main.defaultDevMode=1   编译期写入，发行包默认关闭
//
// 与 minimal mode 一致：OCTOP_DESKTOP_DEV=0 关掉编译期打开的默认值。
//
// 注意：开发者工具本身由 Wails 的构建标签决定——带 production 标签的构建
// 不带调试器（见 Wails 的 application_debug.go / application_production.go）。
// 开发模式因此只在非 production 构建里有意义，也就是 wails3 dev 与
// wails3 task build 的默认产物。
var defaultDevMode string

// devModeEnabled reports whether the shell runs in developer mode.
func devModeEnabled() bool {
	if v := strings.TrimSpace(os.Getenv("OCTOP_DESKTOP_DEV")); v != "" {
		return !strings.EqualFold(v, "false") && v != "0"
	}
	v := strings.TrimSpace(defaultDevMode)
	return v != "" && v != "0" && !strings.EqualFold(v, "false")
}

// devInspectorOnStartup reports whether the developer tools open together
// with the main window.
//
// 默认跟随开发模式；OCTOP_DESKTOP_DEVTOOLS=0 只关闭自动打开，随时仍可用
// Ctrl+Shift+D 手动唤起。
func devInspectorOnStartup() bool {
	if v := strings.TrimSpace(os.Getenv("OCTOP_DESKTOP_DEVTOOLS")); v != "" {
		return !strings.EqualFold(v, "false") && v != "0"
	}
	return devModeEnabled()
}

// devModeNeedsRemoteTarget reports whether the shell must refuse to start the
// local portable runtime.
//
// 开发模式只对接远程后台。没有远程目标时宁可报错，也不退回本地运行时——
// 那样会让人以为在调远程，实际调的是本机。
func devModeNeedsRemoteTarget() bool {
	return devModeEnabled() && resolveRemoteDashboardURL() == ""
}

// devModeLogf 写一条仅在开发模式下才有意义的日志。
func devModeLogf(format string, args ...any) {
	if !devModeEnabled() {
		return
	}
	navLogf("dev: "+format, args...)
}

// devBrowserArgs returns the extra Chromium flags developer mode needs.
//
// 微信开放平台的网站应用登录页同时提供「扫一扫」和「快捷登录」两条路：快捷登录
// 靠页面探测本机微信客户端监听的 https://localhost.weixin.qq.com:<port>，端口从
// 14013/14014/14015/13013/13014/13015 里试，证书是公信的 CN=localhost.weixin.qq.com。
//
// 页面只要解析不到 127.0.0.1（fake-IP 代理把该名字答成 198.18.x.x 假 IP 段），
// 探测就会全部失败，登录页只剩二维码。这里把解析钉回本地，桌面壳不依赖系统
// hosts 里那条记录是否还在。
//
// 只在开发模式生效：WebView2 的浏览器参数是全局的（所有窗口共用一个浏览器
// 环境），发行包不该因此改变本机解析行为。
func devBrowserArgs() []string {
	if !devModeEnabled() {
		return nil
	}
	// 引号是必需的：规则值里有空格，Chromium 的命令行解析要求整体带引号。
	return []string{
		`--host-resolver-rules="MAP localhost.weixin.qq.com 127.0.0.1"`,
	}
}

// devKeyBindings 返回开发模式下的窗口快捷键。
//
// 用 Ctrl+Shift+D 而不是 Ctrl+Shift+I：后者由 WebView2 自己消费（打开
// 开发者工具），按键事件到不了宿主，绑定不会触发。右键菜单里的“检查”
// 同样可用——开发模式下 WebView2 的默认右键菜单是开着的。
func devKeyBindings() map[string]func(application.Window) {
	if !devModeEnabled() {
		return nil
	}
	return map[string]func(application.Window){
		"Ctrl+Shift+D": func(w application.Window) { w.OpenDevTools() },
	}
}
