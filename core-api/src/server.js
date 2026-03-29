require("./env").loadEnvFiles();

const http = require("node:http");
const { error, json, matchPath, noContent } = require("./http");
const { buildRoutes } = require("./routes");
const { SqliteStore } = require("./sqlite-store");

async function dispatch(req, res, url, routes, store) {
  for (const route of routes) {
    if (route.method !== req.method) continue;

    const params = matchPath(url.pathname, route.path);
    if (!params) continue;

    try {
      const result = await route.handler({ req, res, url, params, store });

      if (res.writableEnded) return true;
      if (result === undefined) {
        return true;
      }
      if (result && result.error) {
        const { statusCode, code, message } = result.error;
        error(res, statusCode, code, message);
        return true;
      }

      json(res, route.statusCode || 200, result);
      return true;
    } catch (caughtError) {
      if (caughtError?.statusCode && caughtError?.code) {
        error(res, caughtError.statusCode, caughtError.code, caughtError.message);
        return true;
      }

      console.error("core-api request failed", {
        method: req.method,
        path: url.pathname,
        error: caughtError
      });
      error(res, 500, "INTERNAL_ERROR", "unexpected server error");
      return true;
    }
  }

  return false;
}

function createServer() {
  const store = new SqliteStore();
  const routes = buildRoutes(store);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "OPTIONS") {
      noContent(res);
      return;
    }

    const handled = await dispatch(req, res, url, routes, store);
    if (!handled) {
      error(res, 404, "NOT_FOUND", "route not found");
    }
  });

  server.on("close", () => {
    if (typeof store.close === "function") {
      store.close();
    }
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || "4100");
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`core-api mock server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = {
  createServer
};
