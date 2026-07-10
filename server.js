const http = require("node:http");
const { handleHttp } = require("./src/handler");
const config = require("./config.json");

const port = process.env.PORT || config.port || 3000;
const server = http.createServer(handleHttp);

server.listen(port, () => {
  console.log("Listening on port " + port);
});

// Graceful shutdown for VPS/Docker/systemd deployments.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
