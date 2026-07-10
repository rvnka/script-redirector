// Thin Vercel entrypoint — all real logic lives in src/handler.js so it
// stays identical across every hosting target (Vercel, VPS, Docker, ...).
module.exports = require("../src/handler").handleHttp;
