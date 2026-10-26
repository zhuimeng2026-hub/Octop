/* Octop desktop navigation probe.
 *
 * Injected by navlog.go into every document the shell loads. It reports what
 * the webview is actually looking at — document URL, content type, page text
 * for non-HTML (i.e. proxy/API error) documents, SPA route changes, failed
 * requests and uncaught script errors — to a loopback log endpoint owned by
 * the shell.
 *
 * Rules that keep this safe to inject into a foreign page:
 *   - never throw: logging must not break the app it observes;
 *   - idempotent: a second injection only re-reports the snapshot;
 *   - no dependency on the Wails runtime.
 *
 * __OCTOP_NAVLOG_ENDPOINT__ is replaced with the loopback URL at inject time.
 */
(function () {
  "use strict";

  var EP = __OCTOP_NAVLOG_ENDPOINT__;
  var existing = window.__octopNavProbe;
  if (existing && existing.ep === EP) {
    try {
      existing.snap("reinject");
    } catch (e) {
      /* ignore */
    }
    return;
  }

  var seq = 0;

  function text(value, max) {
    if (value === null || value === undefined) return "";
    var s = String(value).replace(/\s+/g, " ").trim();
    if (max && s.length > max) return s.slice(0, max) + "...";
    return s;
  }

  function beacon(body) {
    try {
      var url = EP + "?d=" + encodeURIComponent(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
        return;
      }
      var img = new Image();
      img.src = url;
    } catch (e) {
      /* ignore */
    }
  }

  function post(payload) {
    var body;
    try {
      body = JSON.stringify(payload);
    } catch (e) {
      return;
    }
    try {
      var p = fetch(EP, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      });
      if (p && typeof p.catch === "function") {
        p.catch(function () {
          beacon(body);
        });
      }
    } catch (e) {
      beacon(body);
    }
  }

  function contentType() {
    try {
      if (document.contentType) return String(document.contentType);
    } catch (e) {
      /* ignore */
    }
    return "";
  }

  function bodySample() {
    try {
      return text(document.body ? document.body.innerText : "", 400);
    } catch (e) {
      return "";
    }
  }

  function send(kind, extra) {
    seq += 1;
    var payload = {
      kind: kind,
      seq: seq,
      href: String(location.href),
      title: text(document.title, 120),
      ctype: contentType(),
      ready: String(document.readyState || ""),
      ts: Date.now(),
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    post(payload);
  }

  /* A document whose content type is not HTML is almost always an error page
   * produced by nginx or by the API, so capture its text: that is what makes a
   * 404 distinguishable from a real page. */
  function snap(kind) {
    var ct = contentType().toLowerCase();
    var nonHTML = ct !== "" && ct.indexOf("html") === -1;
    send(kind || "nav", {
      referrer: String(document.referrer || ""),
      body: nonHTML ? bodySample() : "",
    });
  }

  window.__octopNavProbe = { ep: EP, snap: snap, send: send };

  snap("nav");
  /* Titles are set by SPA render, after the injection point. */
  setTimeout(function () {
    snap("settled");
  }, 900);

  /* SPA route changes: the 404 reported by the app itself lands here. */
  try {
    var push = history.pushState;
    var replace = history.replaceState;
    if (typeof push === "function") {
      history.pushState = function () {
        var r = push.apply(this, arguments);
        send("pushState");
        return r;
      };
    }
    if (typeof replace === "function") {
      history.replaceState = function () {
        var r = replace.apply(this, arguments);
        send("replaceState");
        return r;
      };
    }
  } catch (e) {
    /* ignore */
  }
  window.addEventListener("popstate", function () {
    send("popstate");
  });
  window.addEventListener("hashchange", function () {
    send("hashchange");
  });

  /* Leaving the document: the redirect chain after an OAuth login shows up
   * here even when the next document never finishes loading. */
  window.addEventListener("beforeunload", function () {
    try {
      beacon(
        JSON.stringify({
          kind: "unload",
          href: String(location.href),
          title: text(document.title, 120),
          ctype: contentType(),
          ts: Date.now(),
        })
      );
    } catch (e) {
      /* ignore */
    }
  });

  window.addEventListener("error", function (event) {
    send("js-error", {
      error: text(event && event.message ? event.message : "error", 200),
      source: text(event && event.filename ? event.filename : "", 200),
      line: event && event.lineno ? event.lineno : 0,
    });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event ? event.reason : null;
    send("unhandled-rejection", {
      error: text(reason && reason.message ? reason.message : reason, 200),
    });
  });

  function interesting(url, status) {
    if (!url || url.indexOf(EP) === 0) return false;
    if (status >= 400 || status === 0) return true;
    return url.indexOf("/api/") !== -1 || url.indexOf("/ws/") !== -1;
  }

  try {
    var nativeFetch = window.fetch;
    if (typeof nativeFetch === "function") {
      window.fetch = function (input, init) {
        var url = "";
        var method = "GET";
        try {
          url =
            typeof input === "string"
              ? input
              : input && input.url
                ? String(input.url)
                : String(input);
          method = (init && init.method) || (input && input.method) || "GET";
        } catch (e) {
          /* ignore */
        }
        method = String(method).toUpperCase();
        return nativeFetch.apply(this, arguments).then(
          function (res) {
            try {
              if (interesting(url, res.status)) {
                send("fetch", { url: url, method: method, status: res.status });
              }
            } catch (e) {
              /* ignore */
            }
            return res;
          },
          function (err) {
            try {
              if (interesting(url, 0)) {
                send("fetch-error", {
                  url: url,
                  method: method,
                  error: text(err && err.message ? err.message : err, 200),
                });
              }
            } catch (e) {
              /* ignore */
            }
            throw err;
          }
        );
      };
    }
  } catch (e) {
    /* ignore */
  }

  try {
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      var xhrOpen = XHR.prototype.open;
      var xhrSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try {
          this.__octopMeta = {
            method: String(method || "GET").toUpperCase(),
            url: String(url || ""),
          };
        } catch (e) {
          /* ignore */
        }
        return xhrOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        var xhr = this;
        try {
          xhr.addEventListener("loadend", function () {
            try {
              var meta = xhr.__octopMeta || {};
              if (interesting(meta.url || "", xhr.status)) {
                send("xhr", {
                  url: meta.url || "",
                  method: meta.method || "GET",
                  status: xhr.status,
                });
              }
            } catch (e) {
              /* ignore */
            }
          });
        } catch (e) {
          /* ignore */
        }
        return xhrSend.apply(this, arguments);
      };
    }
  } catch (e) {
    /* ignore */
  }

  /* SSO opens a popup; if the webview blocks or replaces the main document the
   * target URL here is the first thing to look at. */
  try {
    var nativeOpen = window.open;
    if (typeof nativeOpen === "function") {
      window.open = function (target, name, features) {
        var targetText = text(target, 500);
        send("window.open", { target: targetText, winName: text(name, 60) });
        var win = nativeOpen.apply(this, arguments);
        if (!win) send("window.open-blocked", { target: targetText });
        return win;
      };
    }
  } catch (e) {
    /* ignore */
  }
})();
