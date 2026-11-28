import { withBase } from "../utils/basePath";

/** Only reachable from the Vite serve-only debug build. */
export async function devLogin(): Promise<string> {
  const response = await fetch(withBase("/__octop_dev_login"), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error("debug login rejected");
  }
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("debug login rejected");
  }
  return body.access_token;
}
