import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  getApiUrl: (path: string) => `/api${path}`,
}));

vi.mock("../i18n", () => ({
  default: { language: "zh" },
}));

/**
 * Every authenticated request must survive an expired desktop session.
 *
 * `request()` already does: it renews the device credential and retries once.
 * The blob, stream and probe paths re-implement the auth preamble by hand and
 * skip the renewal, so a download that starts after the JWT expires lands on
 * a login screen the desktop user cannot fill in.
 *
 * These tests pin the shared contract: one renewal, one retry, and the retry
 * carries the NEW token.
 */

function tokenExpiredResponse(): Response {
  return new Response(
    JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "expired" } }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}

function okBlobResponse(): Response {
  // A string body, not a Blob: jsdom's `Response` does not carry a Blob
  // through (`new Response(new Blob([...]))` stringifies it to
  // "[object Blob]"), and `instanceof Blob` is false across the jsdom realm
  // boundary. Assert on the content instead.
  return new Response("payload", {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

function tokenFor(uname: string): string {
  const payload = btoa(JSON.stringify({ sub: "1", uname }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `h.${payload}.s`;
}

interface Bridge {
  register: ReturnType<typeof vi.fn>;
  renew: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
}

function installBridge(renewedToken: string | null): Bridge {
  const session = {
    register: vi.fn().mockResolvedValue(true),
    renew: vi
      .fn()
      .mockResolvedValue(
        renewedToken ? { access_token: renewedToken, expires_in: 86400 } : null,
      ),
    revoke: vi.fn().mockResolvedValue(true),
  };
  (globalThis as unknown as { octopDesktop: unknown }).octopDesktop = {
    session,
  };
  return session;
}

describe("authenticated request paths renew an expired desktop session", () => {
  const replace = vi.fn();
  let fetchMock: ReturnType<typeof vi.fn>;
  let mod: typeof import("./request");

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    replace.mockClear();
    delete (globalThis as unknown as { octopDesktop?: unknown }).octopDesktop;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/chat", replace },
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mod = await import("./request");
  });

  // Known gap, documented rather than fixed here: `requestBlob` re-implements
  // the auth preamble by hand and never renews the device credential, so a
  // download that starts after the JWT expires lands on a login screen the
  // desktop user cannot fill in.
  //
  // `it.fails` marks this as a known defect: CI stays green while the bug
  // stands, and the moment the fix lands the test flips, which fails the
  // suite and forces the marker to be removed.
  it.fails(
    "renews the device credential and retries a blob download",
    async () => {
      const renewed = tokenFor("local");
      const session = installBridge(renewed);
      mod.setAuthToken(tokenFor("local"));
      fetchMock
        .mockResolvedValueOnce(tokenExpiredResponse())
        .mockResolvedValueOnce(okBlobResponse());

      const blob = await mod.requestBlob("/files/report.pdf");
      expect(await blob.text()).toBe("payload");
      expect(blob.type).toBe("application/octet-stream");

      expect(session.renew).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mod.getAuthToken()).toBe(renewed);
      expect(replace).not.toHaveBeenCalled();
      // The retry must carry the new token, not the stale one.
      const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
      expect((retryInit.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${renewed}`,
      );
    },
  );

  it.fails(
    "renews the device credential and retries a streamed response",
    async () => {
      const renewed = tokenFor("local");
      const session = installBridge(renewed);
      mod.setAuthToken(tokenFor("local"));
      fetchMock
        .mockResolvedValueOnce(tokenExpiredResponse())
        .mockResolvedValueOnce(okBlobResponse());

      await expect(mod.requestStream("/voice/tts")).resolves.toMatchObject({
        contentType: "application/octet-stream",
      });

      expect(session.renew).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mod.getAuthToken()).toBe(renewed);
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it.fails(
    "renews the device credential and retries an existence probe",
    async () => {
      const renewed = tokenFor("local");
      const session = installBridge(renewed);
      mod.setAuthToken(tokenFor("local"));
      fetchMock
        .mockResolvedValueOnce(tokenExpiredResponse())
        .mockResolvedValueOnce(okBlobResponse());

      await expect(
        mod.probeAuthResource("/workspace/big.bin"),
      ).resolves.toBeUndefined();

      expect(session.renew).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mod.getAuthToken()).toBe(renewed);
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("does not renew a password account into the desktop session", async () => {
    const session = installBridge(tokenFor("local"));
    mod.setAuthToken(tokenFor("admin"));
    fetchMock.mockResolvedValue(tokenExpiredResponse());

    await expect(mod.requestBlob("/files/report.pdf")).rejects.toThrow();

    expect(session.renew).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("does not renew when there is no bridge", async () => {
    mod.setAuthToken("stale-token");
    fetchMock.mockResolvedValue(tokenExpiredResponse());

    await expect(mod.requestBlob("/files/report.pdf")).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mod.getAuthToken()).toBe("");
    expect(replace).toHaveBeenCalledWith("/login");
  });
});
