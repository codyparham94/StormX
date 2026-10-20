import { describe, expect, it } from "vitest";
import { type Bucket, type Env, type StoredObject, handle, resolveRange } from "../src/handler";

/** In-memory stand-in for the R2 binding: ranges and If-None-Match like R2's. */
function memoryBucket(objects: Record<string, string>, etag = '"v1"'): Bucket {
  const meta = (key: string): StoredObject | null =>
    key in objects ? { httpEtag: etag, size: new TextEncoder().encode(objects[key]).length } : null;
  return {
    async head(key) {
      return meta(key);
    },
    async get(key, options) {
      const base = meta(key);
      if (!base) return null;
      if (options?.onlyIf?.get("If-None-Match") === etag) return base;
      const bytes = new TextEncoder().encode(objects[key]);
      const header = options?.range?.get("Range");
      let slice = bytes;
      let range: StoredObject["range"];
      const m = header && /^bytes=(\d+)-(\d*)$/.exec(header);
      if (m) {
        const offset = Number(m[1]);
        const end = m[2] ? Number(m[2]) : bytes.length - 1;
        range = { offset, length: end - offset + 1 };
        slice = bytes.slice(offset, end + 1);
      }
      return { ...base, range, body: new Response(slice).body };
    },
  };
}

const ORIGIN = "https://stormx.codyparham.com";
const env: Env = {
  BUCKET: memoryBucket({ "healthz.json": '{"ok":true}', "live/odin/county.geojson": '{"type":"FeatureCollection"}', "raw/eaglei/2024.csv": "secret-ish" }),
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
};

function get(path: string, init: RequestInit & { origin?: string } = {}): Request {
  const { origin = ORIGIN, ...rest } = init;
  return new Request(`https://stormx-data.example.workers.dev${path}`, { ...rest, headers: { Origin: origin, ...(rest.headers ?? {}) } });
}

describe("data worker", () => {
  it("serves published files with CORS for the site", async () => {
    const res = await handle(get("/live/odin/county.geojson"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Content-Type")).toBe("application/geo+json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await res.text()).toBe('{"type":"FeatureCollection"}');
  });

  it("gives other origins no CORS grant", async () => {
    const res = await handle(get("/healthz.json", { origin: "https://evil.example" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers preflight and refuses writes", async () => {
    expect((await handle(get("/healthz.json", { method: "OPTIONS" }), env)).status).toBe(204);
    expect((await handle(get("/healthz.json", { method: "PUT", body: "x" }), env)).status).toBe(405);
    expect((await handle(get("/healthz.json", { method: "DELETE" }), env)).status).toBe(405);
  });

  it("hides everything outside the published folders", async () => {
    for (const path of ["/raw/eaglei/2024.csv", "/", "/live", "/live/../raw/eaglei/2024.csv", "/live/.hidden", "/LIVE/x.json", "/live//x.json"]) {
      expect((await handle(get(path), env)).status, path).toBe(404);
    }
  });

  it("passes byte ranges through for PMTiles readers", async () => {
    const res = await handle(get("/live/odin/county.geojson", { headers: { Range: "bytes=2-5" } }), env);
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/28");
    expect(await res.text()).toBe("type");
  });

  it("returns 304 when the ETag matches", async () => {
    const res = await handle(get("/healthz.json", { headers: { "If-None-Match": '"v1"' } }), env);
    expect(res.status).toBe(304);
  });

  it("answers HEAD without a body", async () => {
    const res = await handle(get("/healthz.json", { method: "HEAD" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("11");
    expect(await res.text()).toBe("");
  });
});

describe("resolveRange", () => {
  it("handles offset, open-ended and suffix ranges", () => {
    expect(resolveRange({ offset: 10, length: 5 }, 100)).toEqual({ offset: 10, length: 5 });
    expect(resolveRange({ offset: 90 }, 100)).toEqual({ offset: 90, length: 10 });
    expect(resolveRange({ suffix: 20 }, 100)).toEqual({ offset: 80, length: 20 });
    expect(resolveRange({ suffix: 500 }, 100)).toEqual({ offset: 0, length: 100 });
  });
});
