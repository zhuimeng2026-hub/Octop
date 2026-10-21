/**
 * Deployment sub-path helpers.
 *
 * The dashboard can be served from a sub-path (e.g. `https://host/videogen`).
 * The build injects that prefix through vite's `define` as `BASE_URL`
 * (leading slash, no trailing slash). When `BASE_URL` is empty the app is
 * served from the server root and every helper below is a no-op — that keeps
 * the root deployment byte-for-byte identical to the pre-sub-path build.
 *
 * `BASE_URL` is a build-time global, so it does not exist under vitest.
 * The `typeof` guard keeps unit tests on the root-deployment behaviour.
 */

declare const BASE_URL: string;

/** Deployment sub-path, e.g. "/videogen". Empty string = root deployment. */
export const BASE_PATH: string =
  typeof BASE_URL === "string" ? BASE_URL.replace(/\/+$/, "") : "";

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Prefix a root-absolute path with the deployment sub-path.
 *
 *   "/api/x" → "/videogen/api/x"
 *
 * No-op when the app is served from the root. Absolute URLs and paths that
 * already carry the prefix are returned unchanged, so the helper is safe to
 * apply more than once.
 */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  if (!path) return BASE_PATH;
  if (ABSOLUTE_URL_RE.test(path)) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === BASE_PATH || clean.startsWith(`${BASE_PATH}/`)) return clean;
  return `${BASE_PATH}${clean}`;
}

/**
 * Remove the deployment sub-path from a path.
 *
 *   "/videogen/api/x" → "/api/x"
 *
 * No-op when the app is served from the root. Absolute URLs keep their origin
 * ("http://h/videogen/api/x" → "http://h/api/x").
 */
export function stripBase(path: string): string {
  if (!BASE_PATH) return path;
  if (!path) return path;
  const absolute = path.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i);
  if (absolute) return `${absolute[1]}${stripBase(absolute[2])}`;
  if (path === BASE_PATH) return "/";
  if (path.startsWith(`${BASE_PATH}/`)) return path.slice(BASE_PATH.length);
  return path;
}

/**
 * Root-relative path of a URL or path, with the deployment sub-path removed.
 *
 *   "http://h/videogen/api/x?y=1" → "/api/x"
 *   "/videogen/api/x"              → "/api/x"
 */
export function rootPath(url: string): string {
  if (ABSOLUTE_URL_RE.test(url)) {
    try {
      return stripBase(new URL(url).pathname);
    } catch {
      return "";
    }
  }
  let end = url.length;
  const query = url.indexOf("?");
  if (query >= 0) end = Math.min(end, query);
  const hash = url.indexOf("#");
  if (hash >= 0) end = Math.min(end, hash);
  return stripBase(url.slice(0, end));
}
