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
