/**
 * Serves the ETL output in the private stormx-data R2 bucket to the StormX site. Read-only: GET,
 * HEAD and CORS preflight. Byte ranges pass through so the browser can read PMTiles archives.
 */

export interface Env {
  BUCKET: Bucket;
  /** Comma-separated origins allowed to read data from a browser. */
  ALLOWED_ORIGINS: string;
}

export interface StoredObject {
  httpEtag: string;
  size: number;
  range?: { offset?: number; length?: number } | { suffix: number };
  httpMetadata?: { contentType?: string };
  body?: ReadableStream | null;
}

/** The slice of the R2 binding this Worker uses, so tests can pass an in-memory stand-in. */
export interface Bucket {
  get(key: string, options?: { range?: Headers; onlyIf?: Headers }): Promise<StoredObject | null>;
  head(key: string): Promise<StoredObject | null>;
}

// Lowercase keys under the folders the ETL publishes; nothing else (such as raw downloads kept for
// reprocessing) is readable. No "..", no leading dot, no empty segments.
const PUBLIC_PATH = /^\/((?:live|grid|history|risk|static|tiles|sim)(?:\/[a-z0-9_-][a-z0-9_.-]{0,80})+|healthz\.json)$/;

const TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8",
  geojson: "application/geo+json; charset=utf-8",
  pmtiles: "application/vnd.pmtiles",
  parquet: "application/vnd.apache.parquet",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
};

/** Live feeds change every 15 minutes; everything else changes at most once per ETL run. */
function cacheControl(key: string): string {
  if (key.startsWith("live/") || key === "healthz.json") return "public, max-age=60";
  return "public, max-age=3600, stale-while-revalidate=86400";
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Range, If-None-Match");
    headers.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, ETag, Accept-Ranges");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function status(code: number, headers: Headers, message: string): Response {
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", code === 404 ? "public, max-age=60" : "no-store");
  return new Response(message, { status: code, headers });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET" && request.method !== "HEAD") return status(405, headers, "method not allowed");

  const match = PUBLIC_PATH.exec(new URL(request.url).pathname);
  if (!match || match[1].includes("..")) return status(404, headers, "not found");
  const key = match[1];

  const ranged = request.headers.has("Range");
  const obj =
    request.method === "HEAD"
      ? await env.BUCKET.head(key)
      : await env.BUCKET.get(key, { range: ranged ? request.headers : undefined, onlyIf: request.headers });
  if (!obj) return status(404, headers, "not found");

  const ext = key.split(".").pop() ?? "";
  headers.set("Content-Type", obj.httpMetadata?.contentType || TYPES[ext] || "application/octet-stream");
  headers.set("Cache-Control", cacheControl(key));
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");

  // R2 returns the object without a body when an If-None-Match condition holds.
  if (request.method === "GET" && !obj.body) return new Response(null, { status: 304, headers });

  if (ranged && obj.range) {
    const { offset, length } = resolveRange(obj.range, obj.size);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body ?? null, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(request.method === "HEAD" ? null : (obj.body ?? null), { status: 200, headers });
}

export function resolveRange(range: { offset?: number; length?: number } | { suffix: number }, size: number): { offset: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return { offset, length: Math.min(range.length ?? size - offset, size - offset) };
}
