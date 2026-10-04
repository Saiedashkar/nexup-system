/**
 * Shared CLI spawn + output guards.
 *
 * Both CLI transports (the provisional subcommand transport and the verified
 * one-shot transport) use these helpers so the security controls exist in ONE
 * place and cannot drift apart:
 *
 *   - spawn with an ARGUMENT ARRAY and `shell: false` (never a shell string);
 *   - an executable-basename allowlist;
 *   - a hard timeout that SIGKILLs the process;
 *   - stdout/stderr captured SEPARATELY and bounded;
 *   - secret redaction applied to anything captured.
 *
 * Nothing here interpolates caller data into a command string — callers pass
 * arguments as array elements.
 */

/* ═══════════════════════════════════════════════════════
   Text guards
   ═══════════════════════════════════════════════════════ */

/** Truncate raw output to `maxBytes` (byte-accurate enough for text). */
export function boundText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0 || text.length <= maxBytes) return { text, truncated: false };
  return { text: text.slice(0, maxBytes), truncated: true };
}

/** Remove any occurrence of the provided secret values from a string. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      output = output.split(secret).join("[REDACTED]");
    }
  }
  return output;
}

/* ═══════════════════════════════════════════════════════
   Executable allowlist
   ═══════════════════════════════════════════════════════ */

export const DEFAULT_HERMES_EXECUTABLE_ALLOWLIST: readonly string[] = [
  "hermes",
  "hermes.exe",
  "hermes-cli",
  "hermes-cli.exe",
];

/** True when the executable's basename is on the allowlist. */
export function isAllowlistedExecutable(
  executablePath: string,
  allowlist: readonly string[] = DEFAULT_HERMES_EXECUTABLE_ALLOWLIST,
): boolean {
  const basename = executablePath.replace(/\\/g, "/").split("/").pop() ?? "";
  return allowlist.includes(basename);
}

/* ═══════════════════════════════════════════════════════
   Spawn port + default implementation
   ═══════════════════════════════════════════════════════ */

export type HermesSpawnResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  timedOut: boolean;
};

export type HermesSpawnInput = {
  executablePath: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  /** Optional stdin payload (data, never a shell command). */
  stdin?: string;
};

export type HermesSpawnLike = (input: HermesSpawnInput) => Promise<HermesSpawnResult>;

/** Default spawn helper — dynamic import keeps `node:child_process` out of any client bundle. */
export const defaultHermesSpawn: HermesSpawnLike = async ({ executablePath, args, timeoutMs, maxOutputBytes, stdin }) => {
  const { spawn } = await import("node:child_process");
  return new Promise<HermesSpawnResult>((resolve) => {
    const child = spawn(executablePath, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const collect = (chunk: Buffer, target: "out" | "err") => {
      const text = chunk.toString("utf8");
      if (target === "out") {
        if (stdout.length < maxOutputBytes) stdout += text.slice(0, maxOutputBytes - stdout.length);
      } else if (stderr.length < maxOutputBytes) {
        stderr += text.slice(0, maxOutputBytes - stderr.length);
      }
    };

    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "err"));

    const finish = (code: number | null, killed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, killed, timedOut });
    };

    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
};
