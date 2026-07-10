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
    "/win/test": "https://raw.githubusercontent.com/user/repo/main/test.ps1"
  }
}
```

| Key | Meaning |
|---|---|
| `routes` | path → local file (must be inside the project) or remote URL (host must be in `allowedHosts`) |
| `allowedHosts` | domains allowed as redirect targets to prevents open-redirect abuse |
| `rateLimit` | max requests/minute per IP, overridable with the `RATE_LIMIT` env var, `0` disables |
| `port` | overridable with the `PORT` env var |

## Structure

```
api/[...path].js   Vercel entrypoint
server.js          standalone entrypoint (VPS/Docker)
src/handler.js     shared HTTP handling + rate limiting
src/router.js      route resolution + local file/redirect logic
config.json        routes and settings
scripts/           files served by local routes
vercel.json        tells Vercel to bundle scripts/** (routes are loaded at runtime, so this is required)
```

## Security

- Local files are only served if their exact path is listed in `config.json`, and the resolved path is verified to stay inside the project folder.
- Redirects only go to hosts in `allowedHosts`.
- Route lookups can't hit inherited/prototype properties.
- Successful responses are CDN-cacheable, so repeat requests don't reinvoke the function to keeps compute usage minimal on free-tier hosting.
