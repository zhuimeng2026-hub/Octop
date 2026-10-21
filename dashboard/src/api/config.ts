declare const BASE_URL: string;

/**
 * Build-time API base.
 *
 * `typeof` guards the lookup: Vite's `define` injects the constant at build
 * time, but test runners that do not apply `define` (vitest) would otherwise
 * throw a ReferenceError on the bare identifier.
 */
const RAW_BASE_URL: string = typeof BASE_URL === "string" ? BASE_URL : "";

/**
 * Mount prefix of the dashboard, e.g. "/videogen".
 *
 * Empty when the app is served at the origin root, or when BASE_URL points at
 * a separate API origin (absolute URL) — in that case the SPA keeps its own
 * path and only the API base is redirected.
 */
export function getBasePath(): string {
  const base = RAW_BASE_URL;
  if (!base || /^[a-z][a-z0-9+.-]*:\/\//i.test(base)) return "";
  return base.replace(/\/+$/, "");
}

/**
 * Get the full API URL with /api prefix
 * @param path - API path (e.g., "/models", "/skills")
 * @returns Full API URL (e.g., "http://localhost:8088/api/models" or "/api/models")
 */
export function getApiUrl(path: string): string {
  const base = RAW_BASE_URL;
  const apiPrefix = "/api";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${apiPrefix}${normalizedPath}`;
}

/**
 * Get a WebSocket URL derived from the same origin as the API.
 * Converts http:// → ws:// and https:// → wss://.
 * If BASE_URL is empty (same-origin), uses the current page location.
 * @param path - API path (e.g., "/browser-stream/ws")
 * @returns Full WebSocket URL
 */
export function getWsUrl(path: string): string {
  const base = RAW_BASE_URL;
  const apiPrefix = "/api";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const httpUrl = `${base}${apiPrefix}${normalizedPath}`;

  if (httpUrl.startsWith("http://")) {
    return httpUrl.replace("http://", "ws://");
  }
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace("https://", "wss://");
  }

  // Relative URL — derive from current page location
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${httpUrl}`;
}
