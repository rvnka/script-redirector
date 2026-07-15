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
const rawRateLimit = process.env.RATE_LIMIT ?? config.rateLimit;
const parsedRateLimit = Number(rawRateLimit);
if (rawRateLimit !== undefined && !Number.isFinite(parsedRateLimit)) {
  console.warn(
    `Invalid rate limit value ${JSON.stringify(rawRateLimit)}; rate limiting is disabled.`
  );
}
const RATE_LIMIT = Number.isFinite(parsedRateLimit) && parsedRateLimit > 0 ? parsedRateLimit : 0;

// Only trust the x-forwarded-for header when the deployment actually sits
// behind a proxy that sets/overwrites it (Vercel's edge, or a reverse
// proxy like nginx/Caddy in front of a VPS). Without this, any client can
// forge the header to dodge the limit entirely, or repeatedly forge
// *another* client's IP to get them wrongly rate-limited. Off by default;
// enable with config.trustProxy or the TRUST_PROXY=1 env var once the
// deployment is actually fronted by something that sanitizes the header.
const TRUST_PROXY =
  process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true" || config.trustProxy === true;

// Caps memory use if an attacker (or, with TRUST_PROXY on, a burst of
// spoofed x-forwarded-for values) tries to grow the map with many distinct
// keys inside a single 60s window. Once full, unseen IPs are simply not
// tracked (fail open on the limiter, not on the rest of the app) rather
// than letting the map grow without bound.
const MAX_TRACKED_IPS = 50_000;

let hits = new Map();
if (RATE_LIMIT > 0) {
  setInterval(() => (hits = new Map()), 60_000).unref();
}

function isRateLimited(ip) {
  if (RATE_LIMIT <= 0) return false;
  let count = hits.get(ip);
  if (count === undefined) {
    if (hits.size >= MAX_TRACKED_IPS) return false;
    count = 0;
  }
  count += 1;
  hits.set(ip, count);
  return count > RATE_LIMIT;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
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

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    res.statusCode = 429;
    res.setHeader("retry-after", "60");
    res.end("Too many requests");
    return;
  }

  const result = await resolve(req.url);
  res.statusCode = result.status;
  // Baseline hardening headers on every response, in addition to whatever
  // route-specific headers resolve() returns (e.g. content-type, location).
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  for (const key of Object.keys(result.headers)) res.setHeader(key, result.headers[key]);
  res.end(req.method === "HEAD" ? undefined : result.body);
}

module.exports = { handleHttp };
