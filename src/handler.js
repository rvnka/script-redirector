const { resolve } = require("./router");
const config = require("../config.json");

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

// Per-IP rate limit, on by default (config.rateLimit, overridable via the
// RATE_LIMIT env var for per-deployment tuning without editing files).
// Set to 0 to disable. Most effective on standalone deployments (VPS,
// Docker) where the process is long-lived; on serverless platforms like
// Vercel each instance is stateless/short-lived, so treat this as a light
// extra layer and lean on the platform's own edge protections too, or add
// a reverse proxy (nginx/Caddy) rate limit in front of a VPS deployment.
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? config.rateLimit) || 0;
let hits = new Map();
if (RATE_LIMIT > 0) {
  setInterval(() => (hits = new Map()), 60_000).unref();
}

function isRateLimited(ip) {
  if (RATE_LIMIT <= 0) return false;
  const count = (hits.get(ip) || 0) + 1;
  hits.set(ip, count);
  return count > RATE_LIMIT;
}

// Works with any (req, res) pair shaped like Node's http.IncomingMessage /
// http.ServerResponse. Both the standalone server and the Vercel Node
// runtime provide that shape, so this one function serves both.
async function handleHttp(req, res) {
  if (!ALLOWED_METHODS.has(req.method)) {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end("Method not allowed");
    return;
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (isRateLimited(ip)) {
    res.statusCode = 429;
    res.setHeader("retry-after", "60");
    res.end("Too many requests");
    return;
  }

  const result = await resolve(req.url);
  res.statusCode = result.status;
  for (const key in result.headers) res.setHeader(key, result.headers[key]);
  res.end(req.method === "HEAD" ? undefined : result.body);
}

module.exports = { handleHttp };
