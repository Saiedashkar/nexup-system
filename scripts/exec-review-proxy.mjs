import fs from "node:fs";
import http from "node:http";

const host = process.env.EXEC_REVIEW_HOST ?? "127.0.0.1";
const port = Number(process.env.EXEC_REVIEW_PORT ?? "3397");
const upstream = new URL(process.env.EXEC_REVIEW_UPSTREAM ?? "http://127.0.0.1:3211");
const cookieJar = process.env.EXEC_REVIEW_COOKIE_JAR;

if (host !== "127.0.0.1") throw new Error("EXEC review proxy must bind to 127.0.0.1.");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid EXEC review proxy port.");
if (!cookieJar) throw new Error("EXEC_REVIEW_COOKIE_JAR is required.");

function reviewCookie() {
  const now = Math.floor(Date.now() / 1000);
  const pairs = [];

  for (let line of fs.readFileSync(cookieJar, "utf8").split(/\r?\n/)) {
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    else if (!line || line.startsWith("#")) continue;

    const fields = line.split("\t");
    if (fields.length !== 7) continue;
    const expires = Number(fields[4]);
    if (Number.isFinite(expires) && expires > 0 && expires <= now) continue;
    pairs.push(`${fields[5]}=${fields[6]}`);
  }

  if (pairs.length === 0) throw new Error("The EXEC review session is missing or expired.");
  return pairs.join("; ");
}

const server = http.createServer((request, response) => {
  let cookie;
  try {
    cookie = reviewCookie();
  } catch (error) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Review session unavailable.");
    return;
  }

  const headers = { ...request.headers, host: upstream.host, cookie };
  delete headers.connection;

  const proxyRequest = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers,
    },
    (proxyResponse) => {
      const responseHeaders = { ...proxyResponse.headers };
      const location = responseHeaders.location;
      if (typeof location === "string" && location.startsWith(upstream.origin)) {
        responseHeaders.location = location.replace(upstream.origin, `http://${host}:${port}`);
      }
      response.writeHead(proxyResponse.statusCode ?? 502, responseHeaders);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("EXEC preview upstream is unavailable.");
  });
  request.pipe(proxyRequest);
});

server.listen(port, host, () => {
  console.log(`EXEC review proxy listening on http://${host}:${port} -> ${upstream.origin}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
