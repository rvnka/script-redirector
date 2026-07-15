# Script Redirector

Serve scripts under clean URLs for `irm | iex` and `curl | bash`. Zero dependencies, runs identically on Vercel, a VPS, or in Docker.

## Requirements

Node.js 24+ (LTS).

## Quick start

```bash
npm start # http://localhost:3000
docker build -t script-redirector . && docker run -p 3000:3000 script-redirector
```

## Configuration

Everything lives in `config.json`:

```json
{
  "port": 3000,
  "rateLimit": 120,
  "maxPathLen": 8192,
  "cacheControl": "public, max-age=300, stale-while-revalidate=86400",
  "allowedHosts": ["raw.githubusercontent.com"],
  "routes": {
    "/win/helloworld": "./scripts/win/helloworld.ps1",
    "/win/test": "https://raw.githubusercontent.com/user/repo/main/test.ps1",
    "/linux/helloworld": "./scripts/win/helloworld.sh",
    "/linux/test": "https://raw.githubusercontent.com/user/repo/main/test.sh"
  }
}
```

| Key | Meaning |
|---|---|
| `routes` | path → local file (must be inside the project) or remote URL (host must be in `allowedHosts`) |
| `allowedHosts` | domains allowed as redirect targets to prevents open-redirect abuse |
| `rateLimit` | max requests/minute per IP, overridable with the `RATE_LIMIT` env var, `0` disables |
| `trustProxy` | whether to trust the `x-forwarded-for` header for rate limiting, overridable with `TRUST_PROXY=1`. **Off by default.** Only enable this if the deployment sits behind something that sets/overwrites this header itself (Vercel's edge, or your own nginx/Caddy reverse proxy) — otherwise any client can forge it to dodge the rate limit or get another client wrongly limited |
| `port` | overridable with the `PORT` env var |

## Structure

```
server.js          entrypoint everywhere — Vercel auto-detects a root server.js
                    that calls .listen() and captures it as the single Function
                    routing all requests, so it also just works on a VPS/Docker
src/handler.js      shared HTTP handling + rate limiting
src/router.js       route resolution + local file/redirect logic
config.json         routes and settings
scripts/            files served by local routes
vercel.json         tells Vercel to bundle scripts/** into the server.js
                    Function (config.json is auto-bundled since it's
                    require()'d, but scripts/ files are only read dynamically
                    at runtime, so they need to be listed explicitly)
```

## Security

- Local files are only served if their exact path is listed in `config.json`; the resolved path (with symlinks followed) is verified to stay inside the project folder.
- Redirects only go to hosts in `allowedHosts`, matched against the exact parsed hostname.
- Route lookups can't hit inherited/prototype properties.
- Rate limiting keys off the real socket address by default; `x-forwarded-for` is only trusted when `trustProxy` is explicitly enabled for deployments that actually sit behind a proxy. The per-IP hit map is capped so it can't grow without bound.
- Only `GET`/`HEAD` are accepted; request paths are length-capped.
- Responses carry `x-content-type-options: nosniff`, `x-frame-options: DENY`, and `referrer-policy: no-referrer`.
- Successful responses are CDN-cacheable, so repeat requests don't reinvoke the function to keeps compute usage minimal on free-tier hosting.
