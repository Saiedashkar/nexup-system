import { createBridgeApp } from "./api/app";
import { NonceStore } from "./auth/nonce-store";
import {
  DEFAULT_AUTH_FAILURE_AUDIT_MAX,
  DEFAULT_AUTH_FAILURE_AUDIT_WINDOW_MS,
  PreAuthGuard,
} from "./auth/pre-auth-guard";
import { RateLimiter } from "./auth/rate-limit";
import { readBridgeSecrets, resolveBridgeConfig } from "./config";
import { createBridgeTransportFactory } from "./hermes/client";
import { RunManager } from "./hermes/run-manager";
import { AuditLog } from "./observability/audit";
import { Logger } from "./observability/logger";
import { Metrics } from "./observability/metrics";
import { createRedactor } from "./redaction";
import { createBridgeServer } from "./server";

/**
 * Bridge entrypoint.
 *
 * Resolves config (fail closed), builds the dependency graph, and starts an
 * HTTP server bound to the loopback interface. It NEVER starts, stops or
 * reconfigures Hermes — it only connects to a Hermes the operator already runs.
 */

export function startBridge(): { close: () => Promise<void> } {
  const resolution = resolveBridgeConfig();
  if (!resolution.enabled) {
    // A disabled bridge is a configuration fact, not a crash: report and exit.
    process.stderr.write(`[nexup-bridge] disabled: ${resolution.reason}\n`);
    process.exit(1);
  }
  const config = resolution.config;

  const secrets = readBridgeSecrets();
  if (!secrets) {
    process.stderr.write("[nexup-bridge] disabled: bridge secrets are unavailable\n");
    process.exit(1);
  }

  const redactor = createRedactor([secrets.hmacSecret, secrets.hermesSessionToken]);
  const logger = new Logger({ redactor, level: "info", base: { service: "nexup-bridge" } });
  const metrics = new Metrics();
  const audit = new AuditLog({ redactor, sink: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`) });

  const transportFactory = createBridgeTransportFactory({
    rpcUrl: config.hermes.rpcUrl,
    sessionToken: secrets.hermesSessionToken,
    profile: config.hermes.profile,
    origin: config.hermes.origin,
  });

  const runManager = new RunManager({
    profile: config.hermes.profile,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    maxConcurrency: config.maxConcurrency,
    transportFactory,
    logger,
    metrics,
    audit,
  });

  const app = createBridgeApp({
    config,
    hmacSecret: secrets.hmacSecret,
    runManager,
    audit,
    logger,
    metrics,
    redactor,
    nonceStore: new NonceStore({ ttlMs: config.clockSkewSeconds * 1000 }),
    rateLimiter: new RateLimiter({ limitPerMinute: config.rateLimitPerMinute }),
    preAuthGuard: new PreAuthGuard({
      perRemoteLimitPerMinute: config.preAuthPerRemotePerMinute,
      globalLimitPerMinute: config.preAuthGlobalPerMinute,
      ttlMs: config.clockSkewSeconds * 1000,
      failureAuditMax: DEFAULT_AUTH_FAILURE_AUDIT_MAX,
      failureAuditWindowMs: DEFAULT_AUTH_FAILURE_AUDIT_WINDOW_MS,
    }),
  });

  const server = createBridgeServer(app, { maxBodyBytes: config.maxBodyBytes });
  metrics.setGauge("bridge_up", 1);

  server.listen(config.port, config.host, () => {
    logger.info("bridge listening", {
      host: config.host,
      port: config.port,
      profile: config.hermes.profile,
      reason: resolution.reason,
    });
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      metrics.setGauge("bridge_up", 0);
      server.close(() => resolve());
    });

  return { close };
}

/* Only auto-start when executed directly (`node dist/main.js`). */
if (typeof require !== "undefined" && require.main === module) {
  const bridge = startBridge();
  const shutdown = () => {
    void bridge.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
