function runDevSso(origin, base, nonce, id, kind) {
  if (window.top !== window || location.origin !== origin) return;

  function finish(result) {
    const event = encodeURIComponent(JSON.stringify({ id, kind, ...result }));
    const deadline = Date.now() + 10000;
    function send() {
      // Wails makes the native event bridge available after document start.
      if (typeof window._wails?.invoke === "function") {
        window._wails.invoke(`wails:event:emit:desktop:dev-sso:${nonce}:${event}`);
      } else if (Date.now() < deadline) {
        setTimeout(send, 25);
      }
    }
    send();
  }

  if (location.pathname === base + "/login/oidc/complete") {
    const params = new URLSearchParams(location.hash.slice(1));
    const code = params.get("code");
    // Reserve the one-time code for the local dashboard ahead of the remote SPA.
    history.replaceState(null, "", location.pathname);
    finish(code && params.get("bind") !== "1" ? { code } : { error: "exchange" });
    return;
  }

  if (location.pathname !== base + "/login") return;

  const params = new URLSearchParams(location.search);
  const error = params.get("oidc_error");
  if (error) {
    finish({ error });
    return;
  }
  if (params.get("desktop") !== "1") return;

  fetch(base + "/api/auth/oauth/start", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, redirect_after: "/chat" }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("SSO start failed");
      const { authorization_url } = await response.json();
      const target = new URL(authorization_url);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
      if (target.protocol !== "https:" && !(loopback && target.protocol === "http:")) {
        throw new Error("Invalid authorization URL");
      }
      location.replace(target.href);
    })
    .catch(() => finish({ error: "start" }));
}
