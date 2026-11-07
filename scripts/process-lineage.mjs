#!/usr/bin/env node
/**
 * Process LINEAGE, for ownership decisions that must not be made by port number.
 *
 * A proof runner allocates a free loopback port and then starts its own server. Two
 * things can go wrong with "the listener on that port is mine":
 *
 *   * between the allocation and the bind, ANOTHER process can win the port — so
 *     the listener a naive cleanup finds is a stranger's server, and killing it
 *     would be killing someone else's work;
 *   * the wrapper the runner started may hand the listener to a child that is
 *     re-parented away, so the recorded PID is not the listener either.
 *
 * Ownership is therefore a property of LINEAGE: a PID is ours when it IS the
 * process this run started, or a DESCENDANT of it. Anything else is foreign, and a
 * runner must leave it alone and say so.
 *
 * Usage:
 *   node scripts/process-lineage.mjs descendants <pid>   # descendants, one per line
 *   node scripts/process-lineage.mjs owns <root> <pid>   # exit 0 = root or descendant
 *   node scripts/process-lineage.mjs alive <pid>         # exit 0 = the PID exists
 *
 * Exit codes: 0 = the answer is YES / the command succeeded, 1 = NO, 2 = bad usage.
 * `descendants` prints the root itself FIRST when it is alive, so a caller that
 * iterates its output never forgets the process it started.
 */

import { spawnSync } from "node:child_process";

/**
 * Every `(pid, ppid)` pair the platform will give us.
 *
 * Windows: `wmic` where available (fast, one process), then PowerShell's CIM view —
 * `wmic` is absent on recent Windows builds, and a cleanup path may not simply give
 * up because a deprecated tool was removed. POSIX: `ps`, which is always there.
 * Either way this returns data, never a throw: an empty map means "no lineage
 * information", and the callers treat that as NOT owning anything.
 */
function parentPairs() {
  const pairs = [];
  const push = (pid, ppid) => {
    if (Number.isInteger(pid) && Number.isInteger(ppid) && pid > 0) pairs.push([pid, ppid]);
  };

  if (process.platform === "win32") {
    const wmic = spawnSync("wmic", ["process", "get", "ProcessId,ParentProcessId", "/format:csv"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (wmic.status === 0 && wmic.stdout) {
      for (const line of wmic.stdout.split(/\r?\n/)) {
        const cells = line.split(",").map((cell) => cell.trim());
        if (cells.length < 3) continue;
        // CSV columns are `Node,ParentProcessId,ProcessId`.
        push(Number(cells[cells.length - 1]), Number(cells[cells.length - 2]));
      }
      if (pairs.length > 0) return pairs;
    }
    // `-EncodedCommand` (UTF-16LE, base64) is used deliberately: a `-Command`
    // argument containing its own quotes is re-parsed by PowerShell and the inner
    // quoting silently produces no output, which would read as "no lineage" and
    // make every process look foreign. Encoding removes the parsing layer entirely.
    const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';
    const powershell = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { encoding: "utf8", timeout: 60_000 },
    );
    for (const line of (powershell.stdout ?? "").split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      push(pid, ppid);
    }
    return pairs;
  }

  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 30_000 });
  for (const line of (ps.stdout ?? "").split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    push(pid, ppid);
  }
  return pairs;
}

/** Is this PID present at all? `EPERM` means it exists and is not ours — still alive. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** Transitive closure of `parent -> children`, starting at `root`. */
function descendants(root) {
  const pairs = parentPairs();
  const found = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of pairs) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid);
        grew = true;
      }
    }
  }
  return [...found];
}

const [command, ...args] = process.argv.slice(2);

if (command === "descendants") {
  const root = Number(args[0]);
  if (!Number.isInteger(root)) {
    console.error("usage: node scripts/process-lineage.mjs descendants <pid>");
    process.exit(2);
  }
  // The root leads the list so a caller can iterate it without a special case.
  for (const pid of descendants(root)) console.log(pid);
  process.exit(0);
}

if (command === "owns") {
  const root = Number(args[0]);
  const candidate = Number(args[1]);
  if (!Number.isInteger(root) || !Number.isInteger(candidate)) {
    console.error("usage: node scripts/process-lineage.mjs owns <root-pid> <pid>");
    process.exit(2);
  }
  process.exit(descendants(root).includes(candidate) ? 0 : 1);
}

if (command === "alive") {
  const pid = Number(args[0]);
  if (!Number.isInteger(pid)) {
    console.error("usage: node scripts/process-lineage.mjs alive <pid>");
    process.exit(2);
  }
  process.exit(alive(pid) ? 0 : 1);
}

console.error("usage: node scripts/process-lineage.mjs descendants|owns|alive …");
process.exit(2);
