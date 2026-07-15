const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config.json");

// All routes and tunables live in config.json (project root). Local file
// paths still get bundled correctly on Vercel because vercel.json tells
// the build to include the scripts folder explicitly — see vercel.json.
const ROUTES = config.routes || {};
const ALLOWED_HOSTS = new Set(config.allowedHosts || []);
const MAX_PATH_LEN = config.maxPathLen || 8192;
const CACHE_CONTROL = config.cacheControl || "public, max-age=300, stale-while-revalidate=86400";

// Local files can only be read from inside this folder. process.cwd() is
// used (not __dirname) since that's what serverless bundlers preserve.
const PROJECT_ROOT = process.cwd();
const PROJECT_PREFIX = PROJECT_ROOT + path.sep;

const fileCache = new Map(); // local file contents, filled on first read

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
};

const isRemoteUrl = (target) =>
  target.startsWith("http://") || target.startsWith("https://");

function isAllowedHost(targetUrl) {
  try {
    return ALLOWED_HOSTS.has(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
}

function cleanPath(reqPath) {
  let p = reqPath.split("?")[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    // malformed percent-encoding: fall through with the raw value
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

// Looks up a route without ever touching inherited/prototype properties,
// so a request path can't coincidentally resolve to something like
// Object.prototype.constructor — important now that ROUTES comes from a
// user-editable JSON file.
function getRoute(key) {
  if (!Object.prototype.hasOwnProperty.call(ROUTES, key)) return undefined;
  const value = ROUTES[key];
  return typeof value === "string" ? value : undefined;
}

// Reads a local file listed in config.json's routes and returns it as
// plain text. A file is only ever exposed if its exact path appears as a
// value there, and any path resolving outside PROJECT_ROOT is rejected.
async function readLocalFile(target) {
  const cached = fileCache.get(target);
  if (cached) return cached;

  const resolvedPath = path.resolve(PROJECT_ROOT, target);
  if (
    resolvedPath !== PROJECT_ROOT &&
    !resolvedPath.startsWith(PROJECT_PREFIX)
  ) {
    return {
      status: 403,
      headers: TEXT_HEADERS,
      body: "Path is outside the allowed folder.",
    };
  }

  let content;
  try {
    // path.resolve() alone doesn't follow symlinks, so a symlink placed
    // under a served folder (e.g. scripts/) could point outside the
    // project root and still pass the check above. Resolve real paths for
    // both sides and re-check containment before reading.
    const [realProjectRoot, realPath] = await Promise.all([
      fs.realpath(PROJECT_ROOT),
      fs.realpath(resolvedPath),
    ]);
    const realPrefix = realProjectRoot + path.sep;
    if (realPath !== realProjectRoot && !realPath.startsWith(realPrefix)) {
      return {
        status: 403,
        headers: TEXT_HEADERS,
        body: "Path is outside the allowed folder.",
      };
    }
    content = await fs.readFile(realPath, "utf8");
  } catch {
    return {
      status: 404,
      headers: TEXT_HEADERS,
      body: "Local file not found.",
    };
  }

  const result = {
    status: 200,
    headers: { ...TEXT_HEADERS, "cache-control": CACHE_CONTROL },
    body: content,
  };
  fileCache.set(target, result);
  return result;
}

// Resolves a request path into a plain response object. Stays independent
// from any specific host/framework so it works the same on Vercel, a VPS,
// or any other Node-compatible runtime.
async function resolve(reqPath) {
  if (
    typeof reqPath !== "string" ||
    reqPath.length === 0 ||
    reqPath.length > MAX_PATH_LEN
  ) {
    return { status: 400, headers: TEXT_HEADERS, body: "Bad request." };
  }

  const cleanedPath = cleanPath(reqPath);

  if (cleanedPath === "" || cleanedPath === "/") {
    return {
      status: 403, // 200,
      headers: TEXT_HEADERS,
      body: "Not allowed." // "Script redirector is running.",
    };
  }

  const target = getRoute(cleanedPath);
  if (!target) {
    return { status: 404, headers: TEXT_HEADERS, body: "Not found." };
  }

  if (isRemoteUrl(target)) {
    if (!isAllowedHost(target)) {
      return {
        status: 403,
        headers: TEXT_HEADERS,
        body: "Target host is not allowed.",
      };
    }
    return {
      status: 302,
      headers: { location: target, "cache-control": CACHE_CONTROL },
      body: "",
    };
  }

  return readLocalFile(target);
}

module.exports = { resolve, cleanPath, isAllowedHost, isRemoteUrl };
