#!/usr/bin/env node
/**
 * THE EIGHTH REVIEW'S OWNERSHIP REPRODUCTIONS, ON REAL CLUSTERS.
 *
 * The unit regressions in `tests/dev-db-ownership.test.ts` supply the evidence directly.
 * This probe does not: it starts disposable PostgreSQL clusters and lets the harness read
 * their actual processes, so the reviewer's two destructive false positives are reproduced
 * the way they were found.
 *
 *   case 1  APOSTROPHE PATHS. Cluster A at `…/owners data` is stopped; its lock file is the
 *           one a crash leaves (it records A's own directory) except that it names B's real
 *           pid, B's real start time and B's port. B is a LIVE postmaster at
 *           `…/owner's data`. `down` and `destroy` on A must refuse, B must still answer,
 *           and A's lock file must be byte-identical.
 *
 *   case 2  SIMULTANEOUS STARTS. C and D are started CONCURRENTLY, so their recorded start
 *           seconds collide — the condition under which the old start-time tie cannot tell
 *           them apart. C's lock file then names D's pid and D's real start time. `down` on
 *           C must refuse, C and D must both still answer, and the lock must be unchanged.
 *
 *   case 3  POSITIVE CONTROL. A cluster whose data directory contains an APOSTROPHE is
 *           still ours: `down` succeeds. The correction must not make such a directory
 *           unmanageable.
 *
 *   case 4  THE FORCE PATH, WITH VERIFICATION. A running cluster is presented to `start`
 *           on a DIFFERENT port, so the harness concludes it is not serving and takes the
 *           stale-postmaster path. The force signal is checked and the PID is verified gone
 *           before the lock file is removed; the replacement postmaster answers on the new
 *           port.
 *
 * What is NOT here: a real FAILED force signal. An ordinary machine will not hand you an
 * unkillable postmaster, and faking one with a PATH shim would address the wrong `taskkill`.
 * That regression lives in the unit suite, where the signal's result is injected — including
 * "exit 0 but still alive".
 *
 * SAFETY. Every cluster is created by THIS run under a fresh scratch directory, signalled
 * only through `pg_ctl -D <dir>` or the harness's own verified force path, and stopped by
 * directory, never by image name. Cleanup verifies each pid is gone; if a shutdown cannot be
 * verified the scratch directory is PRESERVED and the probe FAILS (the eighth review's sixth
 * finding). No database outside the scratch directory is named.
 *
 * TENTH REVIEW, P1/P3 — WHAT THIS PROBE NOW PROVES, AND WHAT IT NO LONGER CLAIMS.
 *
 *   * A SHUTDOWN IS THE WHOLE CLUSTER, not the one pid in the lock file. Before `pg_ctl` is
 *     asked to stop anything, the probe snapshots the postmaster's DESCENDANT processes; after
 *     it, both the postmaster and every snapshotted worker must be gone, and nothing may still
 *     hold the data directory, before the entry is retired from the cleanup inventory. A
 *     leftover worker (the reviewer reproduced parent gone / child alive / no SQL answer) is
 *     reported as UNVERIFIED and the directory is PRESERVED.
 *   * A LOCK FILE THIS PROBE DID NOT WRITE IS NEVER OVERWRITTEN. The previous version restored
 *     the saved lock when the file it found named a live postmaster of the same directory,
 *     then recursed — found the OLD pid gone and reported `stopped: true` while the replacement
 *     was still running. The probe now refuses, writes nothing, and leaves the file byte-for-
 *     byte as it found it; a case that plants a tampered file puts its own file back.
 *   * THE INVENTORY ONLY SHRINKS ON A VERIFIED STOP. A refusal leaves the resource in the list,
 *     so the cleanup report carries `refusals` and `inventoryRetained` next to `preserved`.
 *
 * ABORTS ARE NOT A PASS (ninth review, P2). A setup step that throws — `initdb` refusing, a
 * missing tool, a cluster that will not start — used to reach the `finally` block with zero
 * assertions recorded, so the artifact and the printed state said `ok` while the exit code
 * said 1 (the uncaught exception). An exit code alone is not evidence when the evidence file
 * next to it disagrees. The `finally` block now knows whether an exception is in flight:
 * the summary carries `aborted` plus the ORIGINAL error (name, message, stack), cleanup is
 * reported as its own outcome, `state` is `failed`, and the exit status is 1 — regardless of
 * how many assertions had run, and regardless of whether cleanup succeeded.
 *
 * Usage:  node scripts/dev-db-ownership-proof.mjs
 *         PROOF_KEEP=1 …   leave the scratch directory for inspection
 *         PROOF_OUT=…      write the evidence artifact somewhere else (the abort regression
 *                          does this so a deliberate failure cannot overwrite the recorded
 *                          evidence)
 * Env:    PG_BIN (default C:/Program Files/PostgreSQL/18/bin)
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createOwnershipInspector } from "./dev-db-ownership.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const PG_BIN = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const WIN = process.platform === "win32";
const exe = (name) => path.join(PG_BIN, `${name}${WIN ? ".exe" : ""}`);
const INITDB = exe("initdb");
const PG_CTL = exe("pg_ctl");
const PSQL = exe("psql");

const results = [];

/**
 * what the run ADDS UP TO: an abort is a failure, whatever the assertion count says.
 *
 * Exported so the rule can be regressed directly, and used by `main` so the artifact, the
 * printed state and the exit status are derived from one place and cannot disagree.
 */
export function proofOutcome(summary) {
  const substantiated = summary !== null && typeof summary === "object";
  const aborted = summary?.aborted === true;
  const checksFailed = Number(summary?.checksFailed ?? 0) || 0;
  const preserved = Array.isArray(summary?.cleanup?.preserved) ? summary.cleanup.preserved : [];
  const reasons = [];
  if (!substantiated) reasons.push("no summary was produced, so nothing was substantiated");
  if (aborted) reasons.push("the run aborted before completing its assertions");
  if (checksFailed > 0) reasons.push(`${checksFailed} assertion(s) failed`);
  if (preserved.length > 0) reasons.push(`shutdown could not be verified for ${preserved.length} cluster(s)`);
  const failed = reasons.length > 0;
  return { state: failed ? "failed" : "ok", exitCode: failed ? 1 : 0, reasons };
}

/** Serialise an exception without losing what it was: name, message and stack. */
function describeError(error) {
  if (error === null || error === undefined) return null;
  const source = error instanceof Error ? error : new Error(String(error));
  return {
    name: source.name,
    message: source.message,
    stack: source.stack ?? null,
  };
}
const T0 = Date.now();
// Wall-clock marks: this probe spawns PowerShell (and initdb) many times, and a step that
// takes minutes is a finding, not noise.
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
const log = (message) => console.log(`[${stamp()}] ${message}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status ?? (result.error ? -1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ""),
  };
}

function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`[${stamp()}] ${ok ? "ok  " : "FAIL"} : ${label}${detail ? ` — ${detail}` : ""}`);
  return Boolean(ok);
}

function alive(pid) {
  if (!(Number.isInteger(pid) && pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const lockFile = (dir) => path.join(dir, "postmaster.pid");
const lockText = (dir) => (fs.existsSync(lockFile(dir)) ? fs.readFileSync(lockFile(dir), "utf8") : null);
const lockPid = (dir) => {
  const text = lockText(dir);
  return text ? Number(text.split(/\r?\n/)[0]) : 0;
};
const lockStart = (dir) => {
  const text = lockText(dir);
  if (!text) return null;
  const value = Number(text.split(/\r?\n/)[2]);
  return Number.isFinite(value) && value > 1_000_000_000 ? Math.floor(value) : null;
};
const sha256 = (text) => createHash("sha256").update(text ?? "").digest("hex");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function initdb(dir) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const result = run(INITDB, ["-D", dir, "-U", "postgres", "-A", "trust", "--encoding=UTF8"]);
  if (result.status !== 0) throw new Error(`initdb ${dir} failed:\n${result.stderr}`);
}

function startArgs(dir, port) {
  return [
    "-D", dir,
    "-l", `${dir}.log`,
    "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c autovacuum=off -c shared_buffers=32MB`,
    "-w", "start",
  ];
}

function startAsync(dir, port) {
  return new Promise((resolve) => {
    const child = spawn(PG_CTL, startArgs(dir, port), { stdio: "ignore" });
    child.on("exit", (code) => resolve(code ?? -1));
    child.on("error", () => resolve(-1));
  });
}

/**
 * Remember a cluster THIS probe started, with the lock file it wrote.
 *
 * The ORIGINAL lock file is the only thing cleanup may ever hand to `pg_ctl`: the probe
 * tampers with it on purpose, and a tampered file names somebody else's pid.
 */
function remember(dir, port) {
  const entry = { dir, port, pid: lockPid(dir), originalLock: lockText(dir) };
  inventory.remember(entry);
  log(`started ${dir} on ${port} (pid ${entry.pid})`);
  return entry;
}

/** A real sleep, so `awaitTermination` actually waits in this probe. */
function sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* the wait is best-effort; the deadline below still bounds the loop */
  }
}

function start(dir, port) {
  const result = run(PG_CTL, startArgs(dir, port));
  if (result.status !== 0) throw new Error(`starting ${dir} failed:\n${result.stdout}\n${result.stderr}`);
  return remember(dir, port).pid;
}

/**
 * Stop a cluster this probe started, and forget it once its shutdown is verified.
 *
 * The entry is removed from `started` ONLY AFTER shutdown is verified. A failed mid-proof
 * stop leaves the entry in the inventory so the finally-cleanup loop can still see it,
 * retry it, and report it accurately as preserved/unverified (ninth review, P3). Splicing
 * before verification would remove the resource from the cleanup inventory before we knew
 * whether it had actually stopped.
 *
 * Exported so `tests/dev-db-ownership-proof.test.ts` can exercise the same
 * decide-before-you-splice discipline without a real cluster.
 */
/**
 * THE CLEANUP INVENTORY — a resource leaves it only on a VERIFIED stop.
 *
 * Exported (with the stop function injectable) so the decide-before-you-splice discipline and
 * the tenth review's "a refusal retains the resource" rule can be regressed without a cluster.
 */
export function createCleanupInventory(options = {}) {
  const stopCluster = typeof options.stopCluster === "function" ? options.stopCluster : stopOwnedCluster;
  const entries = [];
  return {
    entries,
    remember(entry) {
      entries.push(entry);
      return entry;
    },
    /**
     * Replace what the inventory knows about a directory with the process that now owns it.
     *
     * Used only when THIS probe deliberately replaced a cluster it started (`immediate` stop,
     * then a new postmaster on the same directory). It never adopts a process the probe did
     * not start, which is what makes the cleaner's refusal to overwrite a lock meaningful.
     */
    adopt(entry) {
      const index = entries.findIndex((candidate) => candidate.dir === entry.dir);
      if (index < 0) entries.push(entry);
      else entries[index] = entry;
      return entry;
    },
    stopStarted(dir) {
      const index = entries.findIndex((entry) => entry.dir === dir);
      if (index < 0) return { stopped: true, why: "not started by this probe" };
      const entry = entries[index];
      const outcome = stopCluster(entry);
      if (outcome.stopped) entries.splice(index, 1);
      return outcome;
    },
    /** What is STILL held by this probe's inventory — the cleanup report quotes this. */
    retained() {
      return entries.map((entry) => entry.dir);
    },
  };
}

const inventory = createCleanupInventory();
const started = inventory.entries;

/** Stop a cluster this probe started, through the shared inventory. */
export function stopStarted(dir) {
  return inventory.stopStarted(dir);
}

function answers(port) {
  const result = run(PSQL, ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-w", "-tAc", "select 1", "postgres"], {
    timeout: 30_000,
  });
  return result.status === 0 && result.stdout.trim() === "1";
}

/** Run a dev-db command against ONE directory and port. */
function devDb(command, dir, port) {
  return run(process.execPath, ["scripts/dev-db.mjs", command], {
    env: { DEV_DB_DIR: dir, DEV_DB_PORT: String(port) },
    timeout: 180_000,
  });
}

/**
 * Stop ONE cluster this probe started, by DIRECTORY, and verify the pid is gone.
 *
 * A tampered lock file (cases 1 and 2 plant a FOREIGN pid in it) must never reach `pg_ctl`,
 * which reads that file itself. The probe therefore restores the lock file it saved at start
 * — its OWN evidence — before asking for a stop, and only when the pid it names is still
 * alive. No image-name kill, no /IM, nothing global.
 *
 * The NINTH REVIEW's P2 sharpens this: PID LIVENESS ALONE must never authorize a signal.
 * Restoring a saved lock file and handing it to `pg_ctl` blindly authorizes the pid currently
 * named by that file, which is exactly what a reused PID looks like. Before handing ANY lock
 * file to `pg_ctl`, this function re-establishes the cluster's IDENTITY through the ownership
 * inspector (image + recorded data directory + argv + start-time consistency) and refuses to
 * signal when identity cannot be re-established, when the lock file names a live pid that is
 * NOT this cluster's, or when the lock file was tampered with and the original pid is gone but
 * a different live pid now occupies that slot.
 *
 * When identity is uncertain, the cluster is PRESERVED and reported as unverified, so the
 * finally-cleanup report cannot lie about a resource that was signalled by mistake.
 */
/**
 * WHAT MAY HAPPEN WHEN THE LOCK FILE IS NOT THE ONE THIS PROBE SAVED.
 *
 * The tenth review's P3 found the previous "restore the saved lock after re-verifying
 * identity" branch writing the OLD lock over a VALID lock naming a live replacement
 * postmaster of the same directory, then recursing, finding the old pid gone and reporting
 * `stopped: true` — a false success that left the replacement running and moved the lock back
 * to a dead pid.
 *
 * There is no case in which writing the saved lock is right: this probe is not the authority
 * on a file another process wrote. Every branch therefore refuses, writes nothing, and says
 * which situation it is. Exported so all three can be regressed without a cluster.
 */
export function decideTamperedLock({ recordedPid, currentPid, targetAlive, identity }) {
  if (!targetAlive) {
    return {
      action: "refuse",
      reason:
        `the lock file changed since this probe started: it now names pid ${currentPid}, which is gone, ` +
        `and this probe started pid ${recordedPid}. Nothing is signalled and the saved lock is NOT written ` +
        "back over a file this probe does not own — the cluster is PRESERVED",
    };
  }
  if (identity === "OURS") {
    return {
      action: "refuse",
      reason:
        `the lock file changed since this probe started: it names pid ${currentPid}, a LIVE postmaster of this ` +
        `data directory that this probe did NOT start (it started pid ${recordedPid}). Restoring the saved lock ` +
        "would overwrite a valid replacement's evidence, and reporting a stop because the OLD pid is gone is " +
        "exactly the false success the tenth review found — the replacement is PRESERVED and the file is untouched",
    };
  }
  return {
    action: "refuse",
    reason:
      `the lock file changed since this probe started and now names pid ${currentPid}, which is ` +
      `${identity === "UNCERTAIN" ? "not identifiable as this cluster's" : identity.toLowerCase()} — restoring the saved ` +
      "lock would authorize a pid this probe never proved, so the cluster is PRESERVED and the file is untouched",
  };
}

function stopOwnedCluster(entry) {
  const { dir, pid, originalLock } = entry;
  if (!fs.existsSync(path.join(dir, "PG_VERSION"))) return { stopped: true, why: "no cluster" };

  const current = lockText(dir);
  if (current === null) {
    if (pid > 0 && alive(pid)) return { stopped: false, why: `no lock file, but pid ${pid} is still alive` };
    // A removed lock file is not a stopped cluster either (tenth review, P1): a worker that
    // outlived its postmaster holds the directory without answering a query.
    const occupation = inspectorFor(dir).directoryOccupation(pid);
    if (!occupation.known || occupation.pids.length > 0) {
      return {
        stopped: false,
        why: occupation.known
          ? `there is no lock file, but process(es) ${occupation.pids.join(", ")} still hold ${dir} — PRESERVED`
          : `${occupation.why} — PRESERVED`,
      };
    }
    return { stopped: true, why: "no lock file" };
  }

  // A LOCK THIS PROBE DID NOT WRITE IS NEVER OVERWRITTEN (tenth review, P3).
  if (originalLock !== null && current !== originalLock) {
    const target = lockPid(dir);
    const targetAlive = target > 0 && alive(target);
    const decision = decideTamperedLock({
      recordedPid: pid,
      currentPid: target,
      targetAlive,
      identity: targetAlive ? clusterIdentityFor(dir) : "ABSENT",
    });
    return { stopped: false, why: decision.reason };
  }

  const target = lockPid(dir);
  if (target <= 0) return { stopped: false, why: "the lock file names no pid" };

  if (!alive(target)) {
    // "The named pid is gone" is NOT a shutdown (tenth review, P1): its workers can be alive,
    // holding the directory while answering nothing at all.
    const occupation = inspectorFor(dir).directoryOccupation(target);
    if (!occupation.known || occupation.pids.length > 0) {
      return {
        stopped: false,
        why: occupation.known
          ? `pid ${target} is gone, but process(es) ${occupation.pids.join(", ")} still hold ${dir} — PRESERVED`
          : `${occupation.why} — PRESERVED`,
      };
    }
    return { stopped: true, why: `pid ${target} already gone and nothing of this cluster still holds the directory` };
  }

  // RE-ESTABLISH IDENTITY IMMEDIATELY BEFORE THE SIGNAL (ninth review, P2). A live pid is
  // not enough: the pid may have been reused. `pg_ctl -D <dir> stop` signals the pid in the
  // lock file, so the lock file must name THIS cluster's own postmaster at the moment of the
  // signal — established through the process's own image, recorded data directory, argv and
  // start-time consistency, not through liveness alone.
  const id = clusterIdentityFor(dir);
  if (id !== "OURS") {
    return {
      stopped: false,
      why: `pid ${target} is alive but ${id === "UNCERTAIN" ? "cannot be identified as this cluster's own (image/argv/start-time mismatch or platform would not report argv)" : id.toLowerCase()}, so it will not be signalled — the cluster is PRESERVED`,
    };
  }

  // THE WORKERS ARE SNAPSHOTTED BEFORE THE SIGNAL, and both they and the directory's
  // occupation must be clear afterwards (tenth review, P1). `pg_ctl -w` waits for the
  // postmaster it started; it cannot report a backend that outlived it.
  const probe = inspectorFor(dir);
  const workersBefore = probe.snapshotClusterProcesses(target);
  if (!workersBefore.known) {
    return {
      stopped: false,
      why: `the worker processes of pid ${target} could not be enumerated (${workersBefore.why}), so its shutdown cannot be verified — the cluster is PRESERVED`,
    };
  }

  run(PG_CTL, ["-D", dir, "stop", "-m", "fast", "-w", "-t", "30"]);
  const termination = probe.awaitTermination(target, workersBefore);
  if (!termination.ok) {
    return { stopped: false, why: `${termination.why} — the cluster is PRESERVED` };
  }
  const occupation = probe.directoryOccupation(target);
  if (!occupation.known || occupation.pids.length > 0) {
    return {
      stopped: false,
      why: occupation.known
        ? `pid ${target} and its workers are gone, but process(es) ${occupation.pids.join(", ")} still hold ${dir} — PRESERVED`
        : `${occupation.why} — PRESERVED`,
    };
  }
  return { stopped: true, why: `pid ${target} and its ${workersBefore.pids.length} worker process(es) are gone` };
}

/**
 * The ownership inspector, wired to THIS machine and to `dir`.
 *
 * Everything the proof decides about a process goes through the same inspector the harness
 * uses, so identity, the SERVING test and the new worker/occupation tests are one
 * implementation rather than two opinions.
 */
function inspectorFor(dir) {
  return createOwnershipInspector({
    dataDir: dir,
    platform: process.platform,
    pidFile: path.join(dir, "postmaster.pid"),
    exec: (command, args, options) => run(command, args, options),
    isAlive: alive,
    fileExists: (target) => fs.existsSync(target),
    readTextFile: (target) => fs.readFileSync(target, "utf8"),
    removeFile: () => {},
    sleep,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  });
}

/**
 * What DOES the lock file's named pid belong to — asked through the ownership inspector?
 * Returns `"OURS" | "UNCERTAIN" | "ABSENT"`.
 */
function clusterIdentityFor(dir) {
  return inspectorFor(dir).inspect().state;
}

async function main() {
  // NULL until the scratch directory exists, because the FIRST thing that can throw is the
  // tool check — and cleanup must be able to say "nothing was created" about that case.
  let scratch = null;
  // The ORIGINAL exception, kept so the artifact can quote it after cleanup has run.
  let abort = null;

  /**
   * The reproductions. It runs only once setup succeeded, which is why an exception here or
   * in setup is caught by ONE handler below: both mean "the proof did not complete", and
   * the artifact must say so rather than count zero failures as a pass.
   */
  const cases = async () => {
    const base = path.join(scratch, "space owner");
    const A = path.join(base, "owners data");
    const B = path.join(base, "owner's data");
    const C = path.join(base, "cluster c");
    const D = path.join(base, "cluster d");
    const E = path.join(base, "owner's lifecycle");
    const F = path.join(base, "force dir");
    const G = path.join(base, "replacement dir");

    const [portB, portC, portD, portE, portF1, portF2, portG] = await Promise.all([
      freePort(), freePort(), freePort(), freePort(), freePort(), freePort(), freePort(),
    ]);

    /* ── case 1: apostrophe paths ─────────────────────────────────── */
    console.log("── case 1: `…/owners data` naming the live postmaster of `…/owner's data`");
    initdb(A);
    initdb(B);
    start(B, portB);
    const bPid = lockPid(B);
    const bStart = lockStart(B);
    fs.writeFileSync(lockFile(A), `${bPid}\n${A}\n${bStart}\n${portB}\n/tmp\n`);
    const aLockHash = sha256(lockText(A));

    check("B (…/owner's data) is a live postmaster that answers", alive(bPid) && answers(portB), `pid ${bPid}`);

    const apostropheDown = devDb("down", A, portB);
    check("down of A REFUSED (non-zero)", apostropheDown.status !== 0, `exit ${apostropheDown.status}`);
    check(
      "the refusal is the argument-vector test",
      `${apostropheDown.stdout}${apostropheDown.stderr}`.includes("does not name this data directory"),
      "",
    );
    check("B's postmaster is STILL ALIVE", alive(bPid));
    check("B still ANSWERS on its port", answers(portB));
    check("A's lock file is byte-identical", sha256(lockText(A)) === aLockHash);

    const apostropheDestroy = devDb("destroy", A, portB);
    check("destroy of A REFUSED (non-zero)", apostropheDestroy.status !== 0, `exit ${apostropheDestroy.status}`);
    check(
      "destroy said it refused to delete",
      `${apostropheDestroy.stdout}${apostropheDestroy.stderr}`.includes("refusing to delete"),
    );
    check("A's data directory is PRESERVED", fs.existsSync(path.join(A, "PG_VERSION")));
    check("B survived destroy as well", alive(bPid) && answers(portB));
    check("A's lock file is still byte-identical", sha256(lockText(A)) === aLockHash);

    /* ── case 2: simultaneous starts ──────────────────────────────── */
    console.log("── case 2: two clusters started CONCURRENTLY, C's lock naming D");
    initdb(C);
    initdb(D);
    let cStart = null;
    let dStart = null;
    let attempts = 0;
    do {
      if (attempts > 0) {
        const cStopped = stopStarted(C);
        const dStopped = stopStarted(D);
        if (!cStopped.stopped || !dStopped.stopped) {
          throw new Error(`could not restart the pair for a same-second start: ${cStopped.why} / ${dStopped.why}`);
        }
      }
      const [cExit, dExit] = await Promise.all([startAsync(C, portC), startAsync(D, portD)]);
      if (cExit !== 0 || dExit !== 0) throw new Error(`concurrent start failed (C ${cExit}, D ${dExit})`);
      remember(C, portC);
      remember(D, portD);
      cStart = lockStart(C);
      dStart = lockStart(D);
      attempts += 1;
      log(`attempt ${attempts}: C start ${cStart}, D start ${dStart}`);
    } while (Math.abs(cStart - dStart) > 2 && attempts < 3);

    const cPid = lockPid(C);
    const dPid = lockPid(D);
    const ties = Math.abs(cStart - dStart) <= 2;
    check("C and D were started inside the same two-second window", ties, `C ${cStart}, D ${dStart}`);
    check("both clusters answer", answers(portC) && answers(portD), `pids ${cPid}/${dPid}`);

    const cOriginalLock = lockText(C);
    fs.writeFileSync(lockFile(C), `${dPid}\n${C}\n${dStart}\n${portC}\n/tmp\n`);
    const cLockHash = sha256(lockText(C));

    const simultaneousDown = devDb("down", C, portC);
    check("down of C REFUSED (non-zero)", simultaneousDown.status !== 0, `exit ${simultaneousDown.status}`);
    check(
      "the refusal names the argument-vector test",
      `${simultaneousDown.stdout}${simultaneousDown.stderr}`.includes("does not name this data directory"),
      "",
    );
    check("D (the pid C's lock named) is STILL ALIVE", alive(dPid));
    check("C's OWN postmaster is STILL ALIVE", alive(cPid));
    check("C still ANSWERS (it was not stopped)", answers(portC));
    check("D still ANSWERS", answers(portD));
    check("C's lock file is byte-identical", sha256(lockText(C)) === cLockHash);

    // The probe OWNS the tampered file it planted, so it puts its own evidence back before
    // cleanup: a cleaner must never do this (tenth review, P3), and the case now also proves
    // that a cluster whose file was put back still stops normally.
    fs.writeFileSync(lockFile(C), cOriginalLock);
    check("the probe restored the lock file it planted", lockText(C) === cOriginalLock);
    const cDownAfter = devDb("down", C, portC);
    check("C can still be stopped normally once its own lock file is back", cDownAfter.status === 0, `exit ${cDownAfter.status}`);
    check("C's postmaster is gone after the normal stop", !alive(cPid), `pid ${cPid}`);

    /* ── case 3: an apostrophe path is still manageable ───────────── */
    console.log("── case 3: positive control — an apostrophe path is OURS");
    initdb(E);
    start(E, portE);
    const ePid = lockPid(E);
    const eDown = devDb("down", E, portE);
    check("down of …/owner's lifecycle SUCCEEDS", eDown.status === 0, `exit ${eDown.status}`);
    check("its postmaster is gone", !alive(ePid), `pid ${ePid}`);

    /* ── case 4: the force path, verified ─────────────────────────── */
    console.log("── case 4: stale postmaster force-terminated after re-verification");
    initdb(F);
    start(F, portF1);
    const fPid = lockPid(F);
    const forcedStart = devDb("start", F, portF2);
    // THE OUTPUT IS PART OF THE EVIDENCE (tenth review, run 7). The run that failed here
    // recorded only `exit 1`, so the refusal — which names the reason and the pids it saw —
    // was lost and the cause had to be guessed. A refusal is a decision this probe must be
    // able to READ, so both streams are captured and attached to the check.
    const forcedOutput = `${forcedStart.stdout}${forcedStart.stderr}`.trim();
    check(
      "start on a DIFFERENT port succeeded",
      forcedStart.status === 0,
      `exit ${forcedStart.status}${forcedOutput ? `\n${forcedOutput}` : " (no output)"}`,
    );
    check("the old postmaster is GONE (termination was verified)", !alive(fPid), `pid ${fPid}`);
    check("a replacement lock file exists", fs.existsSync(lockFile(F)));
    const fPid2 = lockPid(F);
    check("the replacement is a DIFFERENT pid", fPid2 > 0 && fPid2 !== fPid, `${fPid} → ${fPid2}`);
    check("the replacement ANSWERS on the new port", answers(portF2));
    check("the force path was taken (not a silent reuse)", fPid2 !== fPid);
    const fDown = devDb("down", F, portF2);
    check("the replacement can be stopped normally", fDown.status === 0, `exit ${fDown.status}`);
    check("its postmaster is gone", !alive(fPid2), `pid ${fPid2}`);

    /* ── case 5: a LIVE replacement of the same directory ─────────── */
    console.log("── case 5: the cleaner meets a live replacement of the same directory");
    initdb(G);
    start(G, portG);
    const gEntry = started.find((entry) => entry.dir === G);
    const gOldPid = gEntry.pid;
    // An IMMEDIATE stop is a crash from the postmaster's point of view: the directory is left
    // needing recovery, and the next start writes a NEW lock naming a NEW postmaster. That is
    // the reviewer's "replacement حي لنفس المجلد" — produced by this probe, not planted.
    run(PG_CTL, ["-D", G, "stop", "-m", "immediate", "-w", "-t", "30"]);
    check("the first postmaster of G is gone (immediate stop)", !alive(gOldPid), `pid ${gOldPid}`);
    const gRestart = run(PG_CTL, startArgs(G, portG));
    check("G was restarted on the same data directory", gRestart.status === 0, `exit ${gRestart.status}`);
    const gNewPid = lockPid(G);
    const gNewLock = lockText(G);
    check("the replacement is a DIFFERENT live pid", gNewPid > 0 && gNewPid !== gOldPid && alive(gNewPid), `${gOldPid} → ${gNewPid}`);
    check("the replacement answers", answers(portG));

    // The cleaner still holds the OLD entry (old pid, old lock). It must refuse — and not
    // write the old lock over the valid one, which is the tenth review's P3.
    const replacementStop = stopOwnedCluster(gEntry);
    check("the cleaner REFUSED to stop the directory it no longer owns", replacementStop.stopped === false, replacementStop.why);
    check(
      "the refusal names the replacement it did not start",
      `${replacementStop.why}`.includes("did NOT start"),
      "",
    );
    check("the replacement is STILL ALIVE", alive(gNewPid), `pid ${gNewPid}`);
    check("the replacement still ANSWERS", answers(portG));
    check("the replacement's lock file is byte-identical", lockText(G) === gNewLock);
    check("the OLD pid was not re-adopted by the refusal", lockPid(G) === gNewPid, `lock names ${lockPid(G)}`);
    check(
      "the refused resource stayed in the cleanup inventory",
      inventory.retained().includes(G),
      inventory.retained().join(", "),
    );

    // The probe started this replacement itself, so it adopts it — and then stops it the
    // ordinary way, which is also the positive control for the case above.
    inventory.adopt({ dir: G, port: portG, pid: gNewPid, originalLock: gNewLock });
    const gDown = devDb("down", G, portG);
    check("the replacement can then be stopped normally", gDown.status === 0, `exit ${gDown.status}`);
    check("the replacement's postmaster is gone", !alive(gNewPid), `pid ${gNewPid}`);
  };

  try {
    for (const tool of [INITDB, PG_CTL, PSQL]) {
      if (!fs.existsSync(tool)) throw new Error(`missing PostgreSQL tool: ${tool} (set PG_BIN)`);
    }

    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nexup-ownership-proof-"));
    console.log(`── eighth-review ownership probe ──────────────────────────────`);
    console.log(`   scratch: ${scratch}`);

    await cases();
  } catch (error) {
    abort = error;
  } finally {
    /* ── cleanup: stop by directory, verify, preserve on doubt ────── */
    const unverified = [];
    // A REFUSAL IS REPORTED AS ITS OWN FACT, next to the preserved resource: "stopped: false"
    // and "could not be started" need different follow-up, and the tenth review's P3 asked for
    // the resource that is still in the inventory to be visible in the cleanup result.
    const refusals = [];
    // A COPY: `stopStarted` splices, so iterating the live array would skip entries.
    const ownedCount = started.length;
    for (const entry of [...started]) {
      const outcome = stopStarted(entry.dir);
      if (!outcome.stopped) {
        unverified.push(`${entry.dir} (${outcome.why})`);
        refusals.push({ dir: entry.dir, why: outcome.why });
      }
    }

    /**
     * CLEANUP IS ITS OWN OUTCOME. It is reported separately from the assertions, so "the
     * run aborted" and "a cluster would not stop" stay distinguishable in the artifact —
     * they need different follow-up.
     */
    const cleanup = {
      state: unverified.length > 0 ? "unverified" : ownedCount > 0 ? "verified" : "nothing-started",
      clustersStarted: ownedCount,
      clustersStopped: ownedCount - unverified.length,
      preserved: unverified,
      // The resources the cleanup REFUSED to release — still in the inventory, still running.
      refusals,
      inventoryRetained: inventory.retained(),
      scratchRemoved: false,
    };

    const summary = {
      generatedAt: new Date().toISOString(),
      probe: "eighth review ownership reproductions on disposable clusters",
      scratch,
      // A PROOF THAT ABORTED IS NOT A PASS. `aborted` and the original error are recorded
      // here even when `checksFailed` is 0, because zero assertions is not zero failures.
      aborted: abort !== null,
      error: describeError(abort),
      checks: results.length,
      checksPassed: results.filter((entry) => entry.ok).length,
      checksFailed: results.filter((entry) => !entry.ok).length,
      results,
      cleanup,
    };
    const outcome = proofOutcome(summary);
    summary.state = outcome.state;
    summary.stateReasons = outcome.reasons;

    if (unverified.length > 0) {
      console.error(`\ncleanup: shutdown could NOT be verified for:\n  ${unverified.join("\n  ")}`);
      console.error(`cleanup: PRESERVING ${scratch}`);
    } else if (scratch === null) {
      console.log("cleanup: nothing was created, so nothing needed stopping");
    } else if (process.env.PROOF_KEEP === "1") {
      console.log(`\nPROOF_KEEP=1 — leaving the scratch directory at ${scratch}`);
    } else {
      try {
        fs.rmSync(scratch, { recursive: true, force: true });
        summary.cleanup.scratchRemoved = true;
      } catch (error) {
        // A scratch directory that outlived cleanup is a fact about the run, not a reason to
        // lose the artifact: record it, and let the outcome fail on it.
        summary.cleanup.state = "unverified";
        summary.cleanup.preserved.push(`${scratch} (could not be removed: ${describeError(error)?.message})`);
        const revised = proofOutcome(summary);
        summary.state = revised.state;
        summary.stateReasons = revised.reasons;
        outcome.state = revised.state;
        outcome.exitCode = revised.exitCode;
      }
    }

    const outFile = process.env.PROOF_OUT
      ? path.resolve(process.env.PROOF_OUT)
      : path.join(REPO_ROOT, "docs/evidence/step5a4-eighth-review-ownership-2026-10-19.json");
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const { buildManifest } = await import("./evidence-manifest.mjs");
    summary.manifest = buildManifest([
      "scripts/dev-db.mjs",
      "scripts/dev-db-ownership.mjs",
      "scripts/dev-db-ownership-proof.mjs",
      "scripts/run-http-proof-safety.sh",
      "tests/dev-db-ownership.test.ts",
      "scripts/evidence-manifest.mjs",
      "scripts/verify-evidence-manifest.mjs",
    ]);
    fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);

    console.log("────────────────────────────────────────────────────────────────");
    console.log(`   checks passed: ${summary.checksPassed}`);
    console.log(`   checks failed: ${summary.checksFailed}`);
    console.log(`   aborted      : ${summary.aborted}${summary.error ? ` (${summary.error.name}: ${summary.error.message})` : ""}`);
    console.log(`   cleanup      : ${cleanup.state} (${cleanup.clustersStopped}/${cleanup.clustersStarted} stopped)`);
    console.log(`   evidence     : ${path.relative(REPO_ROOT, outFile)}`);
    console.log(`   manifest     : ${summary.manifest.digest}`);
    if (outcome.reasons.length > 0) console.log(`   because      : ${outcome.reasons.join("; ")}`);

    console.log(`ownership-proof-state: ${outcome.state}`);
    process.exitCode = outcome.exitCode;
  }

  // Rethrown AFTER the artifact and the exit status exist, so an abort leaves evidence that
  // agrees with the exit code instead of a 0/0 artifact that claims success.
  if (abort !== null) throw abort;
}

/** Is this file the entry module? `false` when a test imports it for `proofOutcome`. */
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalise = (file) => {
    const resolved = path.resolve(file).replace(/\\/g, "/");
    return WIN ? resolved.toLowerCase() : resolved;
  };
  return normalise(entry) === normalise(fileURLToPath(import.meta.url));
}

if (invokedDirectly()) {
  try {
    await main();
  } catch (error) {
    // The original error, printed once, with the artifact already written and the exit
    // status already set. Nothing is swallowed.
    console.error(error);
    process.exitCode = 1;
  }
}
