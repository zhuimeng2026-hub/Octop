function installDevSso(origin, loginPath, nonce) {
  if (
    location.origin !== origin ||
    typeof window._wails?.invoke !== "function" ||
    window.octopDevSso
  ) {
    return;
  }

  const pending = new Map();
  window.addEventListener("octop:dev-sso-response", ({ detail }) => {
    const request = pending.get(detail?.id);
    if (!request) return;
    pending.delete(detail.id);
    if (detail.code) request.resolve(detail.code);
    else request.reject(new Error(detail.error || "generic"));
  });

  window.octopDevSso = {
    request(kind) {
      if (location.pathname !== loginPath) {
        return Promise.reject(new Error("unavailable"));
      }
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pending.set(id, { resolve, reject });
        try {
          const event = encodeURIComponent(JSON.stringify({ id, kind }));
          window._wails.invoke(`wails:event:emit:desktop:dev-sso:${nonce}:${event}`);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
}
