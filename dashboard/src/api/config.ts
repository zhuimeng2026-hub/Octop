import { BASE_PATH, rootPath } from "../utils/basePath";

/**
 * Get the full API URL with /api prefix
 * @param path - API path (e.g., "/models", "/skills")
 * @returns Full API URL (e.g., "http://localhost:8088/api/models" or "/api/models")
 */
export function getApiUrl(path: string): string {
  const apiPrefix = "/api";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${apiPrefix}${normalizedPath}`;
}

/**
 * Get a WebSocket URL derived from the same origin as the API.
 * Converts http:// → ws:// and https:// → wss://.
 * If BASE_URL is empty (same-origin), uses the current page location.
 * @param path - API path (e.g., "/browser-stream/ws")
 * @returns Full WebSocket URL
 */
export function getWsUrl(path: string): string {
  const apiPrefix = "/api";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const httpUrl = `${BASE_PATH}${apiPrefix}${normalizedPath}`;

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

/**
 * Convert a dashboard URL into a path accepted by the request helpers.
 *
 * The request helpers prepend the deployment sub-path and "/api" themselves,
 * so both are removed here. Absolute URLs lose their origin (the API is
 * always same-origin) but keep their query string.
 *
 *   "/videogen/api/agents/x/avatar?v=1" → "/agents/x/avatar?v=1"
 */
export function toApiRequestPath(url: string): string {
  const path = rootPath(url);
  let search = "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      search = new URL(url).search;
    } catch {
      /* not a parseable URL — fall through */
    }
  } else {
    const query = url.indexOf("?");
    if (query >= 0) search = url.slice(query);
  }
  return `${path.replace(/^\/api/, "")}${search}`;
}
