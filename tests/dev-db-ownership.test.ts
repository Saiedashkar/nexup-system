import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createOwnershipInspector,
  dataDirectoryOptions,
  parseWindowsCommandLine,
} from "../scripts/dev-db-ownership.mjs";
import { createCleanupInventory } from "../scripts/dev-db-ownership-proof.mjs";

/**
 * THE OWNERSHIP GATE — the eighth and ninth reviews' findings, reduced to the decisions they
 * turn on and run against the SAME inspector the harness uses.
 *
 * The process table, the lock file, the force command and the SERVING test are injected, so a
 * FAILED force command and a cluster that is still answering on its port are both reachable
 * here. A real image will not hand you an unkillable postmaster, and no test may signal a real
 * one. The real-cluster reproductions live in `scripts/dev-db-ownership-proof.mjs`.
 *
 * The invariant under test: nobody is signalled, and no lock file is removed, on less than
 * positive evidence that the pid belongs to THIS data directory — and "the named pid is gone"
 * is not evidence that the directory is free.
 */

type PidFacts = {
  image: string;
  argv: string[];
  ageSeconds: number;
  /** The parent the OS reports. A dead parent's number survives on Windows, which is how a
   *  leftover worker of a crashed postmaster is still nameable. */
  parentPid?: number;
};

/** How Windows would quote one argument — enough to exercise the tokeniser honestly. */
function renderWindowsArgv(argv: string[]): string {
  return argv
    .map((argument) => (/[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument))
    .join(" ");
}

type HarnessOptions = {
  platform: "win32" | "linux";
  dataDir: string;
  lock?: string;
  processes: Map<number, PidFacts>;
  taskkill?: { status: number; kills: boolean; killsTree?: boolean };
  clusterRunning?: () => boolean;
  dataDirectoryServingIsOurs?: () => boolean;
  /** POSIX only: `/proc/<pid>/cwd`, the identity of an orphan whose parent was reparented. */
  cwds?: Map<number, string>;
  /** `null` models a platform that will not list processes at all. */
  listProcessesUnavailable?: boolean;
};

function buildHarness(options: HarnessOptions) {
  const files = new Map<string, string>();
  const pidFile = `${options.dataDir}/postmaster.pid`;
  if (options.lock !== undefined) files.set(pidFile, options.lock);

  const alive = new Set(options.processes.keys());
  const signals: { command: string; args: string[] }[] = [];
  const removed: string[] = [];
  const rendered: string[] = [];
  const taskkill = options.taskkill ?? { status: 0, kills: true, killsTree: true };
  const clusterRunning = options.clusterRunning ?? (() => false);
  const dataDirectoryServingIsOurs = options.dataDirectoryServingIsOurs ?? (() => false);

  /** Every declaration of a worker: the pid whose PARENT it is, when the OS would say. */
  const childrenOf = (pid: number) =>
    [...options.processes.entries()]
      .filter(([candidate, facts]) => candidate !== pid && facts.parentPid === pid)
      .map(([candidate]) => candidate);

  const exec = (command: string, args: string[]) => {
    signals.push({ command, args });
    if (options.listProcessesUnavailable && (command === "powershell" || command === "ps")) {
      const script = args.join(" ");
      if (script.includes("ParentProcessId") || args[0] === "-eo") {
        return { status: 1, stdout: "", stderr: "process listing is not available" };
      }
    }
    if (command === "tasklist") {
      const pid = Number(args[1].replace("PID eq ", ""));
      const facts = options.processes.get(pid);
      return {
        status: facts && alive.has(pid) ? 0 : 1,
        stdout: facts ? `"${facts.image}","${pid}","Console","1","10,000 K"` : "",
        stderr: "",
      };
    }
    if (command === "wmic") {
      const pid = Number(args[2].replace("processid=", ""));
      const facts = options.processes.get(pid);
      return { status: 0, stdout: facts ? `CommandLine=${renderWindowsArgv(facts.argv)}\r\r\n` : "", stderr: "" };
    }
    if (command === "powershell") {
      const script = args.join(" ");
      // THE PROCESS TABLE (tenth review, P1): pid, parent pid and image, tab-separated.
      if (script.includes("ParentProcessId")) {
        const lines = [...options.processes.entries()]
          .filter(([pid]) => alive.has(pid))
          .map(([pid, facts]) => `${pid}\t${facts.parentPid ?? 0}\t${facts.image}`);
        return { status: 0, stdout: `${lines.join("\r\n")}\r\n`, stderr: "" };
      }
      const pidMatch = script.match(/ProcessId=(\d+)/);
      if (pidMatch) {
        const facts = options.processes.get(Number(pidMatch[1]));
        return { status: facts ? 0 : 1, stdout: facts ? renderWindowsArgv(facts.argv) : "", stderr: "" };
      }
      const ageMatch = script.match(/Get-Process -Id (\d+)/);
      if (ageMatch) {
        const facts = options.processes.get(Number(ageMatch[1]));
        return { status: facts ? 0 : 1, stdout: facts ? String(facts.ageSeconds) : "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected script" };
    }
    if (command === "ps") {
      if (args.includes("args=")) {
        rendered.push(args.join(" "));
        throw new Error("the rendered `ps args=` form must never be consulted");
      }
      if (args[0] === "-eo") {
        const lines = [...options.processes.entries()]
          .filter(([pid]) => alive.has(pid))
          .map(([pid, facts]) => `${pid} ${facts.parentPid ?? 1} ${facts.image}`);
        return { status: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
      }
      const pid = Number(args[1]);
      const facts = options.processes.get(pid);
      if (!facts) return { status: 1, stdout: "", stderr: "" };
      if (args.includes("comm=")) return { status: 0, stdout: `${facts.image}\n`, stderr: "" };
      if (args.includes("etimes=")) return { status: 0, stdout: `${facts.ageSeconds}\n`, stderr: "" };
      return { status: 1, stdout: "", stderr: "unexpected ps field" };
    }
    if (command === "taskkill" || command === "kill") {
      const pid = Number(args[args.length - 1]);
      if (taskkill.status === 0 && taskkill.kills) {
        alive.delete(pid);
        // `taskkill /T` takes the tree with it; a bare `/PID` does not. The distinction is
        // exactly what the tenth review found the harness could not see.
        if (taskkill.killsTree !== false) {
          const queue = [...childrenOf(pid)];
          while (queue.length > 0) {
            const child = queue.shift() as number;
            alive.delete(child);
            queue.push(...childrenOf(child));
          }
        }
      }
      return { status: taskkill.status, stdout: "", stderr: taskkill.status === 0 ? "" : "refused" };
    }
    return { status: 1, stdout: "", stderr: `unexpected command ${command}` };
  };

  const inspector = createOwnershipInspector({
    dataDir: options.dataDir,
    platform: options.platform,
    pidFile,
    exec,
    isAlive: (pid: number) => alive.has(pid),
    fileExists: (file: string) => files.has(file),
    clusterRunning,
    dataDirectoryServingIsOurs,
    readLink: (target: string) => {
      const pid = Number(target.split("/")[2]);
      const cwd = options.cwds?.get(pid);
      if (typeof cwd !== "string" || !alive.has(pid)) throw new Error(`ENOENT: ${target}`);
      return cwd;
    },
    readTextFile: (file: string) => {
      if (file.startsWith("/proc/")) {
        const pid = Number(file.split("/")[2]);
        const facts = options.processes.get(pid);
        if (!facts || !alive.has(pid)) throw new Error(`ENOENT: ${file}`);
        return `${facts.argv.join("\0")}\0`;
      }
      const contents = files.get(file);
      if (contents === undefined) throw new Error(`ENOENT: ${file}`);
      return contents;
    },
    removeFile: (file: string) => {
      removed.push(file);
      files.delete(file);
    },
    sleep: () => {},
    nowSeconds: () => NOW,
    terminationTimeoutMs: 50,
  });

  return {
    inspector,
    files,
    pidFile,
    alive,
    signals,
    removed,
    rendered,
    writeLock: (contents: string) => files.set(pidFile, contents),
    isAlive: (pid: number) => alive.has(pid),
    clusterRunning,
    dataDirectoryServingIsOurs,
  };
}

const NOW = 1_700_000_000;
const reviewed = "C:\\probe\\reviewed";
const foreign = "C:\\probe\\foreign";

/** One live postmaster whose argv is exactly what is passed, named by this directory's lock. */
function inspectWith(
  argv: string[],
  dataDir = reviewed,
  extra?: { serving?: boolean; taskkill?: { status: number; kills: boolean }; lockPid?: number },
) {
  const processes = new Map<number, PidFacts>([
    [9500, { image: "postgres.exe", argv: ["postgres.exe", ...argv], ageSeconds: 30 }],
  ]);
  return buildHarness({
    platform: "win32",
    dataDir,
    lock: `${extra?.lockPid ?? 9500}\n${dataDir}\n${NOW - 30}\n5678\n/tmp\n`,
    processes,
    taskkill: extra?.taskkill,
    clusterRunning: () => !!extra?.serving,
    dataDirectoryServingIsOurs: () => !!extra?.serving,
  });
}

describe("a path is compared as a path, and only quoting that is syntax is removed", () => {
  it("distinct directories that differ only by an apostrophe do not compare equal", () => {
    const { inspector } = buildHarness({
      platform: "win32",
      dataDir: "C:\\probe\\owners data",
      processes: new Map(),
    });
    expect(inspector.samePath("C:\\probe\\owners data", "C:\\probe\\owner's data")).toBe(false);
    expect(inspector.samePath("C:\\probe\\owners data", "C:\\probe\\owners data")).toBe(true);
    // A quote is an ORDINARY character in a name, not something to delete.
    expect(inspector.samePath('C:\\probe\\a"b', "C:\\probe\\ab")).toBe(false);
    expect(inspector.samePath("C:\\probe\\a'b", "C:\\probe\\ab")).toBe(false);
    // The filesystem's own rules still hold: separators and Windows case.
    expect(inspector.samePath("C:\\probe\\Data\\", "c:/probe/data")).toBe(true);
  });

  it("the Windows tokeniser removes syntactic quotes and keeps an apostrophe", () => {
    expect(parseWindowsCommandLine(`postgres.exe -D "C:\\data\\owner's data" -p 5501`)).toEqual([
      "postgres.exe",
      "-D",
      "C:\\data\\owner's data",
      "-p",
      "5501",
    ]);
    // `""` inside a quoted run is one literal quote.
    expect(parseWindowsCommandLine('postgres.exe -D "C:\\a""b"')).toEqual(["postgres.exe", "-D", 'C:\\a"b']);
    // An empty quoted argument survives as one (empty) argument.
    expect(parseWindowsCommandLine('postgres.exe --config ""')).toEqual(["postgres.exe", "--config", ""]);
  });

  it("the reviewer's reproduction is refused: A's lock file naming B's postmaster", () => {
    const dataDir = "C:\\probe\\owners data";
    const neighbour = "C:\\probe\\owner's data";
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      // A's OWN second and third lines; B's real pid, argv and start time.
      lock: `8801\n${dataDir}\n${NOW - 300}\n5612\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [8801, { image: "postgres.exe", argv: ["postgres.exe", "-D", neighbour, "-p", "5612"], ageSeconds: 300 }],
      ]),
    });

    const reading = harness.inspector.inspect();
    expect(reading.state).toBe("UNCERTAIN");
    expect(reading.pid).toBe(8801);
    expect(reading.why).toContain("does not name this data directory");
    expect(harness.inspector.stopOwnPostmaster(8801)).toMatchObject({ ok: false, signalled: false });
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
  });
});

describe("every exact spelling, and nothing else, is a data-directory option", () => {
  it("reads the four forms and ignores unrelated flags", () => {
    const values = (argv: string[]) => dataDirectoryOptions(argv).options.map((option) => option.value);
    expect(values(["postgres", "-D", "/data", "-p", "5501"])).toEqual(["/data"]);
    expect(values(["postgres", "-D/data"])).toEqual(["/data"]);
    expect(values(["postgres", "--pgdata", "/data"])).toEqual(["/data"]);
    expect(values(["postgres", "--pgdata=/data"])).toEqual(["/data"]);
    expect(values(["postgres", "-p", "5501"])).toEqual([]);
    // A path may contain spaces: argv boundaries, not whitespace, are what splits it.
    expect(values(["postgres", "-D", "C:\\a\\owner's data"])).toEqual(["C:\\a\\owner's data"]);
    for (const argv of [["-D", "/data"], ["-D/data"], ["--pgdata", "/data"], ["--pgdata=/data"]]) {
      expect(dataDirectoryOptions(["postgres", ...argv]).problems).toEqual([]);
    }
  });

  it("a repetition, an abbreviation or a missing value is a problem, never a winner", () => {
    const ambiguous: string[][] = [
      // PostgreSQL honours the LAST option, so an earlier effective-looking match proves nothing.
      ["-D", reviewed, "-D", foreign],
      ["-D", foreign, "-D", reviewed],
      ["-D", reviewed, `-D${foreign}`],
      [`-D${reviewed}`, "-D", foreign],
      ["--pgdata", reviewed, "--pgdata", foreign],
      [`--pgdata=${reviewed}`, `--pgdata=${foreign}`],
      ["-D", reviewed, "--pgdata", foreign],
      [`--pgdata=${foreign}`, "-D", reviewed],
      // getopt_long accepts an UNAMBIGUOUS PREFIX of `--pgdata`: `--pgd=C:\x` sets it.
      [`--pgd=${foreign}`, "-D", reviewed],
      ["--p", reviewed, "-D", foreign],
      // no value at all
      ["-D"],
      ["--pgdata"],
      ["--pgdata="],
    ];
    for (const argv of ambiguous) {
      const { problems } = dataDirectoryOptions(["postgres.exe", ...argv]);
      expect(problems.length, `argv: ${argv.join(" ")}`).toBeGreaterThan(0);
    }
  });
});

describe("ownership is positive evidence, never a guess", () => {
  it("OURS when the ONLY data-directory option is this directory", () => {
    const harness = inspectWith(["-D", reviewed, "-p", "5678"]);
    expect(harness.inspector.inspect()).toMatchObject({ state: "OURS", pid: 9500 });
  });

  it("UNCERTAIN when the lock file records a different directory", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9500\n${foreign}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9500, { image: "postgres.exe", argv: ["postgres.exe", "-D", reviewed], ageSeconds: 30 }],
      ]),
    });
    expect(harness.inspector.inspect().state).toBe("UNCERTAIN");
    expect(harness.inspector.inspect().why).toContain("describes a different cluster");
  });

  it("UNCERTAIN when the lock file names a pid that is gone", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9999\n${reviewed}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map(),
    });
    expect(harness.inspector.inspect()).toMatchObject({ state: "ABSENT", pid: 9999 });
  });

  it("UNCERTAIN when the pid is alive but is not a postmaster", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9204\n${reviewed}\n${NOW - 60}\n5678\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9204, { image: "not_postgres.exe", argv: ["not_postgres.exe", "-D", reviewed], ageSeconds: 60 }],
      ]),
    });
    expect(harness.inspector.inspect().state).toBe("UNCERTAIN");
  });

  it("two clusters started in the SAME second are told apart by argv, not by start time", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9101\n${reviewed}\n${NOW - 120}\n5613\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9101, { image: "postgres.exe", argv: ["postgres.exe", "-D", foreign, "-p", "5613"], ageSeconds: 120 }],
      ]),
    });
    expect(harness.inspector.inspect().state).toBe("UNCERTAIN");
  });

  it("a start-time disagreement refuses an otherwise matching process (a reused pid)", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9103\n${reviewed}\n${NOW - 600}\n5613\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9103, { image: "postgres.exe", argv: ["postgres.exe", "-D", reviewed], ageSeconds: 5 }],
      ]),
    });
    const reading = harness.inspector.inspect();
    expect(reading.state).toBe("UNCERTAIN");
    expect(reading.why).toContain("REUSED");
  });

  it("a repeated or abbreviated option refuses, from BOTH directories' points of view", () => {
    const repeated: string[][] = [
      ["-D", reviewed, "-D", foreign],
      ["-D", foreign, "-D", reviewed],
      ["-D", reviewed, `-D${foreign}`],
      [`--pgdata=${reviewed}`, `--pgdata=${foreign}`],
      ["-D", reviewed, "--pgdata", foreign],
      [`--pgd=${foreign}`, "-D", reviewed],
      ["-D", reviewed, "--pgdata="],
    ];
    for (const argv of repeated) {
      for (const dataDir of [reviewed, foreign]) {
        const harness = inspectWith(argv, dataDir);
        const reading = harness.inspector.inspect();
        expect(reading.state, `argv: ${argv.join(" ")}`).toBe("UNCERTAIN");
        expect(reading.why).toMatch(/cannot be read as naming one data directory/);

        expect(harness.inspector.stopOwnPostmaster(9500)).toMatchObject({ ok: false, signalled: false });
        expect(harness.isAlive(9500)).toBe(true);

        const clearing = harness.inspector.clearStalePostmaster();
        expect(clearing).toMatchObject({ cleared: false, refused: true });
        expect(clearing.why).toMatch(/cannot be read as naming one data directory/);
        expect(harness.files.has(harness.pidFile)).toBe(true);
        expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
      }
    }
  });
});

describe("POSIX argv is read, never re-parsed from `ps`", () => {
  it("a spaced path stays ONE argument, and its neighbour does not match", () => {
    const processes = new Map<number, PidFacts>([
      [9401, { image: "postgres", argv: ["postgres", "-D", "/tmp/owner data", "-p", "5515"], ageSeconds: 45 }],
    ]);
    const ours = buildHarness({
      platform: "linux",
      dataDir: "/tmp/owner data",
      lock: `9401\n/tmp/owner data\n${NOW - 45}\n5515\n/tmp\n`,
      processes,
    });
    expect(ours.inspector.inspect().state).toBe("OURS");

    const neighbour = buildHarness({
      platform: "linux",
      dataDir: "/tmp/owner",
      lock: `9401\n/tmp/owner\n${NOW - 45}\n5515\n/tmp\n`,
      processes,
    });
    expect(neighbour.inspector.inspect().state).toBe("UNCERTAIN");
    expect(ours.rendered).toEqual([]);
    expect(neighbour.rendered).toEqual([]);
  });

  it("without an argv-preserving source the answer is UNCERTAIN, never a guess", () => {
    const inspector: ReturnType<typeof createOwnershipInspector> = createOwnershipInspector({
      dataDir: "/tmp/data",
      platform: "linux",
      pidFile: "/tmp/data/postmaster.pid",
      exec: (command: string, args: string[]) => {
        if (command === "ps" && args.includes("args=")) throw new Error("rendered ps must not be used");
        if (command === "ps" && args.includes("comm=")) return { status: 0, stdout: "postgres\n", stderr: "" };
        if (command === "ps") return { status: 0, stdout: "45\n", stderr: "" };
        throw new Error(`unexpected command ${command}`);
      },
      isAlive: () => true,
      fileExists: () => true,
      readTextFile: (file: string) => {
        if (file === "/tmp/data/postmaster.pid") return `9402\n/tmp/data\n${NOW - 45}\n5515\n/tmp\n`;
        throw new Error(`EACCES: ${file}`);
      },
      removeFile: () => {},
      sleep: () => {},
      nowSeconds: () => NOW,
      terminationTimeoutMs: 20,
    });
    const reading = inspector.inspect();
    expect(reading.state).toBe("UNCERTAIN");
    expect(reading.why).toContain("argv-preserving");
  });
});

describe("a signal needs ownership re-established at signal time, and a verified death", () => {
  it("a failing taskkill is a failure and the process stays", () => {
    const dataDir = "C:\\probe\\wedged";
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock: `9201\n${dataDir}\n${NOW - 60}\n5614\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9201, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 60 }],
      ]),
      taskkill: { status: 1, kills: false },
    });
    expect(harness.inspector.inspect().state).toBe("OURS");
    expect(harness.inspector.stopOwnPostmaster(9201)).toMatchObject({ ok: false, signalled: false });
    expect(harness.isAlive(9201)).toBe(true);

    const cleared = harness.inspector.clearStalePostmaster();
    expect(cleared).toMatchObject({ cleared: false, refused: true });
    expect(cleared.why).toContain("termination could not be established");
    expect(harness.files.has(harness.pidFile)).toBe(true);
    expect(harness.removed).toEqual([]);
  });

  it("taskkill reporting success while the process survives is still a failure", () => {
    const dataDir = "C:\\probe\\wedged";
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock: `9202\n${dataDir}\n${NOW - 60}\n5614\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9202, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 60 }],
      ]),
      taskkill: { status: 0, kills: false },
    });
    const stopped = harness.inspector.stopOwnPostmaster(9202);
    expect(stopped).toMatchObject({ ok: false, signalled: true });
    expect(stopped.reason).toContain("STILL ALIVE");
    expect(harness.isAlive(9202)).toBe(true);
  });

  it("a lock file swapped to a FOREIGN pid after the first reading is not signalled", () => {
    const dataDir = "C:\\probe\\moving";
    const other = "C:\\probe\\other";
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock: `9301\n${dataDir}\n${NOW - 30}\n0\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9301, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 30 }],
        [9302, { image: "postgres.exe", argv: ["postgres.exe", "-D", other], ageSeconds: 30 }],
      ]),
    });
    expect(harness.inspector.inspect()).toMatchObject({ state: "OURS", pid: 9301 });

    // The pid-reuse window the re-read exists to narrow.
    harness.writeLock(`9302\n${dataDir}\n${NOW - 30}\n0\n/tmp\n`);

    const stopped = harness.inspector.stopOwnPostmaster(9301);
    expect(stopped.ok).toBe(false);
    expect(stopped.reason).toContain("could not be re-established");
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
    expect(harness.isAlive(9301)).toBe(true);
    expect(harness.isAlive(9302)).toBe(true);
  });

  it("a lock file that now names a DIFFERENT pid is refused even when that pid is ours", () => {
    const dataDir = "C:\\probe\\moving2";
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock: `9303\n${dataDir}\n${NOW - 30}\n0\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [9303, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 30 }],
        [9304, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 30 }],
      ]),
    });
    harness.writeLock(`9304\n${dataDir}\n${NOW - 30}\n0\n/tmp\n`);

    expect(harness.inspector.stopOwnPostmaster(9303).ok).toBe(false);
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
  });

  it("refuses a pid that was never established", () => {
    const harness = inspectWith(["-D", reviewed]);
    expect(harness.inspector.stopOwnPostmaster(0)).toMatchObject({ ok: false, signalled: false });
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
  });
});

describe("the lock file is removed only when nothing is left to protect", () => {
  it("no lock file and nothing serving: cleared, nothing removed", () => {
    const harness = buildHarness({ platform: "win32", dataDir: reviewed, processes: new Map() });
    expect(harness.inspector.clearStalePostmaster()).toMatchObject({ cleared: true, refused: false });
    expect(harness.removed).toEqual([]);
  });

  it("no lock file but the directory still serving: refused", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      processes: new Map(),
      clusterRunning: () => true,
      dataDirectoryServingIsOurs: () => true,
    });
    const result = harness.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true });
    expect(result.why).toContain("still serving");
  });

  it("a dead pid and a not-serving directory: the stale lock is cleared", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9999\n${reviewed}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map(),
    });
    expect(harness.inspector.clearStalePostmaster()).toMatchObject({ cleared: true, refused: false });
    expect(harness.files.has(harness.pidFile)).toBe(false);
    expect(harness.removed).toEqual([harness.pidFile]);
  });

  it("a dead pid while the directory still serves ANOTHER cluster: lock preserved (ninth review P1)", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `9999\n${reviewed}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map(),
      clusterRunning: () => true,
      dataDirectoryServingIsOurs: () => true,
    });
    const result = harness.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true });
    expect(result.why).toContain("still answers on its port");
    expect(harness.files.has(harness.pidFile)).toBe(true);
    expect(harness.removed).toEqual([]);
  });

  it("UNCERTAIN ownership refuses and removes nothing", () => {
    const harness = inspectWith(["-D", foreign]);
    const result = harness.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true });
    expect(harness.files.has(harness.pidFile)).toBe(true);
    expect(harness.removed).toEqual([]);
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
  });

  it("a verified stop is permission to clear ONLY when the directory is not serving", () => {
    const stoppedAndFree = inspectWith(["-D", reviewed], reviewed, { serving: false });
    expect(stoppedAndFree.inspector.clearStalePostmaster()).toMatchObject({ cleared: true, refused: false });
    expect(stoppedAndFree.files.has(stoppedAndFree.pidFile)).toBe(false);

    const stoppedButServing = inspectWith(["-D", reviewed], reviewed, { serving: true });
    const result = stoppedButServing.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true });
    expect(result.why).toContain("still answers on its port");
    expect(stoppedButServing.files.has(stoppedButServing.pidFile)).toBe(true);
  });

  it("a single option naming a NEIGHBOUR leaves that postmaster alone", () => {
    // The lock file records the directory whose ownership is at stake, but the process's only
    // `-D` names a different one: nothing may be concluded, and nothing may be signalled.
    const harness = inspectWith(["-D", foreign], reviewed);
    expect(harness.inspector.inspect().state).toBe("UNCERTAIN");
    const result = harness.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true });
    expect(harness.isAlive(9500)).toBe(true);
    expect(harness.files.has(harness.pidFile)).toBe(true);
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
  });
});

/**
 * TENTH REVIEW, P1 — A SHUTDOWN IS THE WHOLE CLUSTER, NOT THE ONE PID IN THE LOCK FILE.
 *
 * The reviewer's reproduction: the postmaster is gone, one of its workers is alive, the port
 * answers nothing, and the cleaner declared the cluster stopped and deleted the lock. Neither
 * "parent pid gone" nor "SQL does not answer" covers it, so the worker processes are
 * snapshotted before a signal and checked afterwards, and a dead pid's own children are still
 * nameable through the parent number the OS keeps.
 */
describe("a shutdown needs the workers gone too, not only the named pid", () => {
  const dataDir = "C:\\probe\\workers";
  const worker: PidFacts = {
    image: "postgres.exe",
    argv: ["postgres.exe", "--forkchild=backend"],
    ageSeconds: 30,
    parentPid: 7001,
  };

  it("a dead pid with a live worker keeps the lock file byte-for-byte", () => {
    const lock = `7001\n${dataDir}\n${NOW - 30}\n5614\n/tmp\n`;
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock,
      // No SQL answer is modelled at all — the leftover worker is the only evidence, which is
      // exactly why the serving test cannot stand in for this one.
      processes: new Map<number, PidFacts>([[7002, worker]]),
    });

    const result = harness.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true, remaining: [7002] });
    expect(result.why).toContain("still hold this data directory");
    expect(harness.files.get(harness.pidFile)).toBe(lock);
    expect(harness.removed).toEqual([]);
    expect(harness.isAlive(7002)).toBe(true);
    // Nothing was signalled: a worker is never killed because it holds a file.
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
  });

  it("a forced stop that kills the postmaster but not its worker is a FAILURE", () => {
    const lock = `7101\n${dataDir}\n${NOW - 30}\n5614\n/tmp\n`;
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock,
      processes: new Map<number, PidFacts>([
        [7101, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 30 }],
        [7102, { ...worker, parentPid: 7101 }],
      ]),
      // `/PID` without `/T`: the postmaster dies, the worker it forked does not.
      taskkill: { status: 0, kills: true, killsTree: false },
    });

    const stopped = harness.inspector.stopOwnPostmaster(7101);
    expect(stopped).toMatchObject({ ok: false, signalled: true, remaining: [7102] });
    expect(stopped.reason).toContain("still alive");
    expect(stopped.reason).toContain("nothing may be released");
    expect(harness.isAlive(7102)).toBe(true);

    // ... and the lock is not cleared on that answer either.
    const cleared = harness.inspector.clearStalePostmaster();
    expect(cleared).toMatchObject({ cleared: false, refused: true });
    expect(harness.files.get(harness.pidFile)).toBe(lock);
    expect(harness.removed).toEqual([]);
  });

  it("a tree kill that takes the workers with it is still a verified stop", () => {
    const dataDir2 = "C:\\probe\\workers\\tree";
    const lock = `7201\n${dataDir2}\n${NOW - 30}\n5614\n/tmp\n`;
    const harness = buildHarness({
      platform: "win32",
      dataDir: dataDir2,
      lock,
      processes: new Map<number, PidFacts>([
        [7201, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir2], ageSeconds: 30 }],
        [7202, { ...worker, parentPid: 7201 }],
        [7203, { ...worker, parentPid: 7202 }],
      ]),
    });

    expect(harness.inspector.snapshotClusterProcesses(7201)).toMatchObject({ known: true, pids: [7202, 7203] });
    const stopped = harness.inspector.stopOwnPostmaster(7201);
    expect(stopped).toMatchObject({ ok: true, signalled: true, descendants: [7202, 7203] });
    expect(harness.inspector.clearStalePostmaster()).toMatchObject({ cleared: true, refused: false });
    expect(harness.files.has(harness.pidFile)).toBe(false);
  });

  it("POSIX: a worker reparented out of reach is found by its working directory", () => {
    const posixDir = "/tmp/owner data";
    const lock = `7301\n${posixDir}\n${NOW - 30}\n5515\n/tmp\n`;
    const harness = buildHarness({
      platform: "linux",
      dataDir: posixDir,
      lock,
      // The parent is gone and the child now reports init as its parent, so the parent number
      // proves nothing — its working directory is the data directory, and that is the identity.
      processes: new Map<number, PidFacts>([
        [7302, { image: "postgres", argv: ["postgres", "--forkchild"], ageSeconds: 30, parentPid: 1 }],
      ]),
      cwds: new Map([[7302, `${posixDir}/base`]]),
    });

    const result = harness.inspector.clearStalePostmaster();
    expect(result).toMatchObject({ cleared: false, refused: true, remaining: [7302] });
    expect(result.why).toContain("working directory");
    expect(harness.files.get(harness.pidFile)).toBe(lock);
  });

  it("a platform that will not list processes is refused, never assumed empty", () => {
    const lock = `7401\n${dataDir}\n${NOW - 30}\n5614\n/tmp\n`;
    const harness = buildHarness({
      platform: "win32",
      dataDir,
      lock,
      processes: new Map<number, PidFacts>([
        [7401, { image: "postgres.exe", argv: ["postgres.exe", "-D", dataDir], ageSeconds: 30 }],
      ]),
      listProcessesUnavailable: true,
    });

    expect(harness.inspector.snapshotClusterProcesses(7401)).toMatchObject({ known: false, pids: [] });
    const stopped = harness.inspector.stopOwnPostmaster(7401);
    expect(stopped).toMatchObject({ ok: false, signalled: false });
    expect(stopped.reason).toContain("could not be enumerated");
    expect(harness.isAlive(7401)).toBe(true);
    expect(harness.signals.some((signal) => signal.command === "taskkill")).toBe(false);
    expect(harness.files.get(harness.pidFile)).toBe(lock);
  });
});

/**
 * THE SHARED GATE, AND THE COMMANDS THAT MUST ENTER IT.
 *
 * Running `start`/`restart`/`down`/`destroy` for this would need real clusters and would risk
 * whatever is already running on this machine, so the call sites are asserted here while the
 * decisions themselves are exercised above.
 */
describe("one gate, entered by every command that can signal", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts", "dev-db.mjs"), "utf8");

  function bodyOf(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `scripts/dev-db.mjs must define ${name}()`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\n}\n", start);
    expect(end, `${name}() must be a top-level function`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("every signalling path reads ownership, or its replacement, before it stops anything", () => {
    expect(bodyOf("ensureCluster")).toContain("clearStalePostmaster()");
    for (const name of ["stopForRestart", "stop", "destroy"]) {
      expect(bodyOf(name), `${name}() must consult the ownership gate`).toContain(
        "ownershipOfLockfileProcess()",
      );
    }
    // The graceful paths re-read the evidence immediately before the signal.
    for (const name of ["stopForRestart", "destroy"]) {
      expect(bodyOf(name), `${name}() must re-read before signalling`).toContain("revalidateOwnership(");
    }
  });

  it("every release is gated on the directory being free, not on a stopped pid", () => {
    // The tenth review's P1: a stopped postmaster is not a stopped cluster. Each path that
    // releases something (a replacement start, a `down` success, a deletion) must say so.
    expect(bodyOf("ensureCluster")).toContain("clearStalePostmaster()");
    for (const name of ["stopForRestart", "stop"]) {
      expect(bodyOf(name), `${name}() must snapshot the workers before signalling`).toContain(
        "snapshotClusterProcesses(",
      );
      expect(bodyOf(name), `${name}() must verify the workers are gone`).toContain("awaitTermination(");
    }
    for (const name of ["stopForRestart", "destroy"]) {
      expect(bodyOf(name), `${name}() must refuse while a process holds the directory`).toContain(
        "assertDirectoryFree(",
      );
    }
    // `destroy` must ask it with the pid whose children it is about to outlive.
    expect(bodyOf("destroy")).toContain('assertDirectoryFree(ownership.pid, "delete")');
    // And the gate itself must be an inspector call, not a local re-implementation.
    expect(bodyOf("assertDirectoryFree")).toContain("ownershipInspector.directoryOccupation(");
  });

  it("the gate is one inspector reading one lock file, told whether the directory serves", () => {
    const gate = bodyOf("ownershipOfLockfileProcess");
    expect(gate).toContain("ownershipInspector.inspect()");
    // The inspector's authority comes from argv alone: no pre-collected candidate directories.
    expect(source).not.toContain("dataDirectoriesFromArgv");
    // The SERVING test is wired at the one place that knows this machine.
    const wiring = source.slice(source.indexOf("createOwnershipInspector({"));
    const end = wiring.indexOf("\n});");
    expect(end).toBeGreaterThan(0);
    const options = wiring.slice(0, end);
    expect(options).toContain("clusterRunning");
    expect(options).toContain("dataDirectoryServingIsOurs");
  });
});

/**
 * ELEVENTH REVIEW, P1 — AN UNREADABLE COMMAND LINE IS NOT AN EMPTY DIRECTORY.
 *
 * The reviewer's isolated reproduction: the lock file names a dead pid 8001, a LIVE
 * PostgreSQL postmaster 8002 exists, the process table is available, and 8002's argument
 * vector cannot be read. The old loop skipped it (`continue`) and the gate answered
 * `known: true, pids: []`, so the lock was deleted and the directory treated as free.
 *
 * The rule now: a live main postmaster whose vector cannot be read makes the whole answer
 * UNRESOLVED. Nothing below signals anything.
 *
 * The eleventh review's follow-up removed the one exception this suite first carried: a
 * directory's birth time is MUTABLE metadata (`SetCreationTimeUtc` moves it), so "the process
 * started first" is not a proof that it is somewhere else. A live owner whose directory has
 * been made to look younger than the process stays unresolved, and the resource is kept.
 */
describe("eleventh/twelfth review P1 — unable to prove a live postmaster is somewhere else", () => {
  function unreadableNeighbour(extra: Partial<HarnessOptions> = {}) {
    return buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `8001\n${reviewed}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        // A main postmaster (no postmaster parent), alive, and its vector is not readable.
        [8002, { image: "postgres.exe", argv: [], ageSeconds: 900, parentPid: 0 }],
      ]),
      ...extra,
    });
  }

  it("answers UNRESOLVED, names the pid, and is not an empty directory", () => {
    const harness = unreadableNeighbour();
    const occupation = harness.inspector.directoryOccupation(8001);

    expect(occupation.known).toBe(false);
    expect(occupation.pids).toEqual([]);
    expect(occupation.unresolved).toEqual([
      { pid: 8002, why: expect.stringContaining("could not be read") },
    ]);
    expect(occupation.why).toContain("8002");
    expect(occupation.why).toContain("cannot be shown to be using a different data directory");
  });

  it("the stale lock is preserved and nothing is signalled (the reported case)", () => {
    const harness = unreadableNeighbour();
    const lock = harness.files.get(harness.pidFile);

    const clearing = harness.inspector.clearStalePostmaster();
    expect(clearing).toMatchObject({ cleared: false, refused: true });
    expect(clearing.why).toContain("8002");
    expect(harness.files.get(harness.pidFile)).toBe(lock);
    expect(harness.removed).toEqual([]);
    expect(harness.signals.some((signal) => signal.command === "taskkill" || signal.command === "kill")).toBe(false);
  });

  it("an ambiguous vector is unresolved too, and one with no data-directory option as well", () => {
    const ambiguous = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `8001\n${reviewed}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [8003, { image: "postgres.exe", argv: ["postgres.exe", "-D", reviewed, "-D", foreign], ageSeconds: 900 }],
        [8004, { image: "postgres.exe", argv: ["postgres.exe"], ageSeconds: 900 }],
      ]),
    });
    const occupation = ambiguous.inspector.directoryOccupation(8001);
    expect(occupation.known).toBe(false);
    expect(occupation.unresolved.map((entry: { pid: number }) => entry.pid)).toEqual([8003, 8004]);
    expect(ambiguous.inspector.clearStalePostmaster()).toMatchObject({ cleared: false, refused: true });
  });

  it("POSITIVE CONTROL a readable vector naming ANOTHER directory resolves the answer", () => {
    const harness = buildHarness({
      platform: "win32",
      dataDir: reviewed,
      lock: `8001\n${reviewed}\n${NOW - 30}\n5678\n/tmp\n`,
      processes: new Map<number, PidFacts>([
        [8005, { image: "postgres.exe", argv: ["postgres.exe", "-D", foreign, "-p", "5613"], ageSeconds: 900 }],
      ]),
    });
    const occupation = harness.inspector.directoryOccupation(8001);
    expect(occupation).toMatchObject({ known: true, pids: [], unresolved: [] });
    // A foreign cluster is not a reason to refuse: the ordinary stale-lock path still works.
    expect(harness.inspector.clearStalePostmaster()).toMatchObject({ cleared: true, refused: false });
    expect(harness.removed).toEqual([harness.pidFile]);
  });

  it("REGRESSION a live owner behind a younger-looking directory is still refused (the counter-case)", () => {
    // The reviewer's counter-case: `SetCreationTimeUtc` moved a real directory's creation time
    // two hours forward while the directory stayed the same, so the directory can look NEWER
    // than a live postmaster that is really using it. Identity cannot rest on that; the clock
    // is no longer consulted, so the outcome is the same for any timing.
    const harness = unreadableNeighbour();
    const lock = harness.files.get(harness.pidFile);

    expect(harness.inspector.directoryOccupation(8001)).toMatchObject({
      known: false,
      pids: [],
      unresolved: [{ pid: 8002, why: expect.stringContaining("could not be read") }],
    });

    const clearing = harness.inspector.clearStalePostmaster();
    expect(clearing).toMatchObject({ cleared: false, refused: true });
    expect(clearing.why).toContain("8002");
    // The lock is byte-for-byte the one that was there, and nothing was signalled.
    expect(harness.files.get(harness.pidFile)).toBe(lock);
    expect(harness.removed).toEqual([]);
    expect(harness.signals.some((signal) => signal.command === "taskkill" || signal.command === "kill")).toBe(false);
  });

  it("no creation-time probe survives in the inspector", () => {
    const ownership = fs.readFileSync(path.join(process.cwd(), "scripts", "dev-db-ownership.mjs"), "utf8");
    expect(ownership).not.toContain("startedBeforeDirectory");
    expect(ownership).not.toContain("CreationDate");
    expect(ownership).not.toContain("birthtime");
  });

  it("restart and destroy refuse on that uncertainty, before they release anything", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts", "dev-db.mjs"), "utf8");
    const read = (name: string, from: number, to: number) => {
      const start = source.indexOf(`function ${name}(`, from);
      const end = source.indexOf("\n}\n", start);
      expect(start, `${name}() must exist`).toBeGreaterThanOrEqual(0);
      expect(end, `${name}() must be a top-level function`).toBeLessThan(to);
      return source.slice(start, end);
    };
    const gate = read("assertDirectoryFree", 0, source.length);
    // `known: false` is its own refusal, not a fall-through to the pid list.
    expect(gate).toContain("if (!occupation.known)");
    expect(gate).toContain("throw new Error");
    expect(gate).toContain("PRESERVED");

    // The delete happens only after that gate, in that order.
    const destroy = read("destroy", 0, source.length);
    expect(destroy.indexOf("assertDirectoryFree(")).toBeGreaterThan(0);
    expect(destroy.indexOf("fs.rmSync(DATA_DIR")).toBeGreaterThan(destroy.indexOf("assertDirectoryFree("));
    // A restart clears the lock only after the same gate.
    const start_ = read("stopForRestart", 0, source.length);
    expect(start_.indexOf("assertDirectoryFree(")).toBeGreaterThan(0);
    for (const call of start_.matchAll(/assertDirectoryFree\(/g)) {
      expect(start_.slice(call.index)).toContain("fs.rmSync(pidFile");
    }
    // ... and a replacement is started only after that wrapper, which THROWS on a refusal:
    // no `pg_ctl start` is reachable while the directory's occupation is unresolved.
    const ensure = read("ensureCluster", 0, source.length);
    expect(ensure.indexOf("clearStalePostmaster()")).toBeGreaterThan(0);
    expect(ensure.indexOf('"pg_ctl start"')).toBeGreaterThan(ensure.indexOf("clearStalePostmaster()"));
  });

  it("cleanup reports such a resource as PRESERVED and keeps it in the inventory", () => {
    let stopCalls = 0;
    const inventory = createCleanupInventory({
      stopCluster: () => {
        stopCalls += 1;
        return {
          stopped: false,
          why: "live PostgreSQL process(es) cannot be shown to be using a different data directory (pid 8002) — PRESERVED",
        };
      },
    });
    inventory.remember({ dir: "C:\\probe\\eleventh", pid: 8001, originalLock: null });

    const outcome = inventory.stopStarted("C:\\probe\\eleventh");
    expect(outcome.stopped).toBe(false);
    expect(outcome.why).toContain("PRESERVED");
    expect(stopCalls).toBe(1);
    // Not spliced: the resource is still the cleaner's responsibility.
    expect(inventory.retained()).toEqual(["C:\\probe\\eleventh"]);

    // And the proof never reports a stop on an unknown occupation: every read is guarded.
    const proof = fs.readFileSync(path.join(process.cwd(), "scripts", "dev-db-ownership-proof.mjs"), "utf8");
    const guarded = proof.match(/if \(!occupation\.known \|\| occupation\.pids\.length > 0\)/g) ?? [];
    expect(guarded.length).toBe(3);
    expect(proof).not.toMatch(/if \(occupation\.pids\.length > 0\)/);
  });
});
