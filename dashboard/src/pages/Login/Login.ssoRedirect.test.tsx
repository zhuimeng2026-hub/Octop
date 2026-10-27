import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ isDark: false }),
}));

const replaceSpy = vi.fn();

// A sub-path deployment: `withBase` is the only thing that can add the prefix,
// because a hard navigation bypasses the router's basename.
vi.mock("../../utils/basePath", () => ({
  BASE_PATH: "",
  withBase: (path: string) =>
    `/videogen${path.startsWith("/") ? path : `/${path}`}`,
  stripBase: (path: string) => path,
  rootPath: (path: string) => path,
}));

const oauthStatus = vi.fn();

vi.mock("../../api/modules/auth", () => ({
  authApi: {
    getAuthStatus: () => Promise.resolve({ setup_required: false }),
    getOauthStatus: () => oauthStatus(),
    getLdapStatus: () => Promise.resolve({ enabled: false, display_name: "" }),
    startOauth: () => Promise.resolve({ authorization_url: "about:blank" }),
  },
}));

vi.mock("../../utils/locale", () => ({
  applyGuestLocale: () => Promise.resolve(),
  applyUserLocale: () => Promise.resolve(),
}));

vi.mock("../../utils/ssoPopup", () => ({
  isSsoPopup: () => true,
  isSsoPopupMessage: () => true,
  notifySsoOpener: () => true,
  openSsoPopup: () => null,
}));

import LoginPage from "./index";

const ORIGIN = "https://example.test";

function dispatchPopupMessage(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN }));
  });
}

describe("Login page SSO popup redirect", () => {
  beforeEach(() => {
    replaceSpy.mockClear();
    oauthStatus.mockResolvedValue({
      providers: [{ kind: "wechat_open", display_name: "微信", enabled: true }],
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: ORIGIN, replace: replaceSpy },
    });
  });

  it("applies the deployment sub-path to the redirect target", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await act(async () => {});

    dispatchPopupMessage({
      type: "octop-sso",
      ok: true,
      access_token: "token",
      remember: true,
      redirect: "/chat",
    });

    expect(replaceSpy).toHaveBeenCalledWith("/videogen/chat");
  });

  it("falls back to the chat page under the sub-path", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await act(async () => {});

    dispatchPopupMessage({
      type: "octop-sso",
      ok: true,
      access_token: "token",
      remember: true,
    });

    expect(replaceSpy).toHaveBeenCalledWith("/videogen/chat");
  });
});
