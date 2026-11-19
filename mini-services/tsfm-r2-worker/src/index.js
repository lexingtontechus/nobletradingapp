/**
 * nt-tsfm-data — read-only R2 bridge for the TSFM Lab.
 *
 * Why this exists: the app runs on Vercel (no Workers binding), so it cannot read the
 * private R2 bucket directly, and the bucket's Public Development URL is not enabled
 * (dashboard-only). This Worker holds the R2 binding and serves the same keys over
 * plain HTTPS with no credentials, so the app reads:
 *
 *     ${TSFM_R2_URL}/tsfm/BTCUSD.csv
 *
 * Deploy:  npx wrangler deploy   (needs CF_API_TOKEN + CF_ACCOUNTID)
 */

/** Browser/edge cache. Matches the lab's server-side read cache. */
const MAX_AGE = 300;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "nt-tsfm-data",
        bucket: "nt-tsfm-prices",
        prefix: "tsfm",
      });
    }

    // "/tsfm/BTCUSD.csv" -> "tsfm/BTCUSD.csv"
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, "")).replace(/\/+$/, "");

    if (!key || key.includes("..")) {
      return new Response("not found", { status: 404 });
    }

    // Authenticated write path (2026-11-18): the trading backend's
    // tsfm-r2-publish job PUTs the lab CSVs + manifest here (scope:
    // noble-trader-fastapi-backend/docs/scopes/20261118_TSFM_R2_BACKEND_PUBLISH_SCOPE.md).
    // Secret-gated, prefix-allowlisted, size-capped. Public GET reads unchanged.
    if (request.method === "PUT") {
      const secret = request.headers.get("x-write-secret");
      if (!env.WRITE_SECRET || secret !== env.WRITE_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const okKey =
        /^tsfm\/[A-Za-z0-9]+\.csv$/.test(key) || key === "tsfm/manifest.json";
      if (!okKey) {
        return new Response("key not allowed", { status: 403 });
      }
      const body = await request.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > 1048576) {
        return new Response("body must be 1 byte..1 MB", { status: 413 });
      }
      const contentType = key.endsWith(".json") ? "application/json" : "text/csv";
      await env.BUCKET.put(key, body, { httpMetadata: { contentType } });
      return Response.json({ ok: true, key, bytes: body.byteLength });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    const obj = await env.BUCKET.get(key);
    if (!obj) {
      return new Response("not found", { status: 404 });
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", `public, max-age=${MAX_AGE}`);

    return new Response(obj.body, { headers });
  },
};
