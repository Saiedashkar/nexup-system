/**
 * WHOSE PROCESS IS THE ONE THE LOCK FILE NAMES? — the dev-database harness's identity
 * layer, extracted so it can be exercised without signalling anything.
 *
 * The eighth review's findings, and what each one changed here:
 *
 *   P1-1  `samePath()` removed EVERY quote character, so `…\owners data` and
 *         `…\owner's data` compared EQUAL. A path is now compared as a path: exactly, with
 *         separators and (on Windows) case normalised, and with symlinks resolved. Quoting
 *         is removed only where it is SYNTACTIC — in `parseWindowsCommandLine` — and never
 *         from a path.
 *
 *   P1-2  A start time within two seconds of the server on the configured port was treated
 *         as proof that the pid in the lock file was that server. Two clusters started in
 *         the same second defeat it. Start times are no longer SUFFICIENT: the only
 *         positive proof is the process's OWN argument vector carrying an exact
 *         `-D`/`--pgdata` argument that resolves to this data directory. A start-time
 *         disagreement may still REFUSE (that is what a reused pid looks like); agreement
 *         never authorises.
 *
 *   P1-3  The force command's exit status was ignored, so `clearStalePostmaster` deleted the
 *         lock file of a postmaster that had only been ASKED to die. `stopOwnPostmaster`
 *         now checks the signal's result AND verifies the pid is gone; anything else is a
 *         failure, and callers preserve the lock file and the data.
 *
 *   P1-4  `down` and the graceful restart read ownership once and then signalled through
 *         `pg_ctl` without re-reading. `stopOwnPostmaster` re-reads immediately before it
 *         signals; the graceful callers re-read through `revalidate()` themselves.
 *
 *   P1-5  `ps -o args=` renders a command line whose argument boundaries are gone, so a path
 *         containing a space was reparsed into two arguments. On POSIX the argument vector
 *         is read from `/proc/<pid>/cmdline` (NUL-separated, boundaries intact). Where that
 *         is unavailable the answer is `null` — UNSUPPORTED — and ownership is UNCERTAIN.
 *         The rendered form is never parsed into arguments.
 *
 *   P1-6  (ninth review) Ownership was granted when ANY data-directory option matched, so a
 *         FOREIGN postmaster whose FIRST `-D` named the reviewed directory authorised both
 *         the inspection and the signal. PostgreSQL honours the LAST option, which makes
 *         "any" a statement about nothing. Exactly ONE option is now required, in an exact
 *         spelling, and repeats/abbreviations are refused — `dataDirectoryOptions`.
 *
 *   P1-7  (tenth review) "The named pid is gone" was still the whole of the shutdown test.
 *         A postmaster's backends and auxiliary workers are its DESCENDANTS, and a parent
 *         that exits does not take them with it (the reviewer reproduced exactly that: parent
 *         gone, child alive, no SQL answer, lock deleted). The SQL test cannot stand in for
 *         it either — a leftover backend holds the directory without answering anything. So
 *         the workers are enumerated and their identity established BEFORE the signal, and
 *         their death is verified before any lock file, replacement start or deletion is
 *         allowed. When the platform will not list processes, nothing is signalled.
 *
 *   P1-8  (tenth review) A stale lock was cleared once its named pid was gone, even though
 *         the DEAD pid's own children (which keep its number as their parent on Windows) or a
 *         live postmaster of this directory could still be running. `directoryOccupation()`
 *         now gates every release: no lock removal, no replacement start, no `down` success
 *         and no directory deletion while any such process is alive or while the platform
 *         will not say whether one is.
 *
 * Everything the inspector needs from the outside world is injected (`exec`, `isAlive`,
 * `readTextFile`, `fileExists`, `listProcesses`, `readLink`, `sleep`, `nowSeconds`), so the
 * decisions can be regressed with a fake process table and a failing `taskkill` without
 * touching a real one.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * How far two readings of ONE startup may disagree, in whole seconds.
 *
 * Both readings are taken on the same machine: the process's creation time and the start
 * time the postmaster wrote on line 3 of its own lock file. Rounding to seconds is the only
 * expected difference. This window is NOT evidence of ownership — it can only refute it.
 */
export const START_TIME_TOLERANCE_SECONDS = 2;

/** The image name of a Windows postmaster. NECESSARY for ownership, never sufficient. */
export function isPostmasterImage(image) {
  return /^postgres(\.exe)?$/i.test(String(image ?? ""));
}

/**
 * Split a WINDOWS command line into argv, by the rule the C runtime uses.
 *
 * This is the ONLY place quoting is syntax. A double quote groups characters and is
 * removed; `2n` backslashes before a quote are `n` literal backslashes, `2n+1` are `n`
 * literal backslashes followed by a literal quote; `""` inside a quoted run is one literal
 * quote. An APOSTROPHE is an ordinary character: Windows does not quote with it, and a data
 * directory may legitimately contain one.
 */
export function parseWindowsCommandLine(cmdline) {
  const source = String(cmdline ?? "");
  const args = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length) break;
    let argument = "";
    let quoted = false;
    while (index < source.length) {
      const character = source[index];
      if (!quoted && /\s/.test(character)) break;
      if (character === "\\") {
        let slashes = 0;
        while (source[index] === "\\") {
          slashes += 1;
          index += 1;
        }
        if (source[index] === '"') {
          argument += "\\".repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            argument += '"';
            index += 1;
          }
          continue;
        }
        argument += "\\".repeat(slashes);
        continue;
      }
      if (character === '"') {
        if (quoted && source[index + 1] === '"') {
          argument += '"';
          index += 2;
          continue;
        }
        quoted = !quoted;
        index += 1;
        continue;
      }
      argument += character;
      index += 1;
    }
    args.push(argument);
  }
  return args;
}

/** The long option a postmaster takes its data directory from. */
export const PGDATA_LONG_OPTION = "pgdata";

/**
 * Every data-directory option in an argument vector — and every reason its meaning cannot be
 * pinned down.
 *
 * Returns `{ options, problems }`:
 *
 *   options   the occurrences in the order they appear, in the four spellings this gate
 *             treats as naming a data directory: `-D <dir>`, `-D<dir>`, `--pgdata <dir>`,
 *             `--pgdata=<dir>`. Only `-D` is in PostgreSQL 18's own `--help`; the
 *             `--pgdata` forms are kept as a deliberate OVER-approximation, because refusing
 *             a process that could not have started is cheaper than accepting one that did.
 *             Because the input is an argv — real on POSIX, faithfully tokenised on Windows
 *             — a path is ONE argument, spaces and apostrophes included.
 *   problems  the ways this vector resists a single reading (see below).
 *
 * WHY THE COUNT MATTERS, AND WHY THIS FUNCTION DOES NOT PICK A WINNER.
 *
 * The ninth review's P1 was an ownership bypass built on `some()`: the inspector collected
 * EVERY `-D`/`--pgdata` value and authorised the pid when ANY one of them matched, so a
 * FOREIGN postmaster — `postgres -D C:\review-first -D C:\review-last`, really serving
 * `C:\review-last` — passed both the initial inspection and the signal-time revalidation
 * whenever its earlier, INEFFECTIVE option named the reviewed directory. PostgreSQL honours
 * the LAST repeated option (the reviewer proved it with `-C data_directory`), so "any one
 * matches" is not a statement about which cluster the process actually opened.
 *
 * Two ways out exist: model PostgreSQL's effective-option semantics exactly, or refuse to
 * decide. This gate REFUSES — a postmaster's argv is never legitimately ambiguous, and an
 * ownership decision that may signal a live process must not rest on a re-implementation of
 * `getopt_long`. So ANY of the following is reported as a `problem`, and the caller fails
 * closed:
 *
 *   * more than one occurrence, whatever the mix of forms or the order — including the
 *     case where one of them is this data directory;
 *   * a `-D`/`--pgdata` with nothing after it, or an empty value;
 *   * a spelling that LOOKS like `--pgdata` without being it (`--p`, `--pgd`, `--pgdat …`,
 *     with `=` or a following value). What one of those sets is PARSER-DEPENDENT: PostgreSQL
 *     18's own `--help` lists no `--pgdata` long option and reads every `--NAME=VALUE` as a
 *     run-time parameter (`--pgdata=x` is reported as `unrecognized configuration
 *     parameter "pgdata"`), while a parser that accepts unambiguous long-option prefixes
 *     would bind the same word to the data directory. This gate does not decide which
 *     happened — it names the argument and refuses.
 *
 * A refusal is not a claim that the process is foreign; it is the absence of a claim that it
 * is ours, which is the only thing a signal may rest on.
 */
export function dataDirectoryOptions(argv) {
  const list = Array.isArray(argv) ? argv.map((entry) => String(entry ?? "")) : [];
  const options = [];
  const problems = [];

  for (let index = 0; index < list.length; index += 1) {
    const argument = list[index];

    if (argument === "-D" || argument === "--pgdata") {
      const value = index + 1 < list.length ? list[index + 1] : null;
      if (value === null || value.length === 0) {
        problems.push(`\`${argument}\` at position ${index} has no value`);
        continue;
      }
      options.push({ form: argument === "-D" ? "-D <dir>" : "--pgdata <dir>", value, position: index });
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      const body = argument.slice(2);
      const equals = body.indexOf("=");
      const name = equals < 0 ? body : body.slice(0, equals);
      const attached = equals < 0 ? null : body.slice(equals + 1);
      if (name === PGDATA_LONG_OPTION) {
        if (attached === null) continue; // the detached form was consumed above
        if (attached.length === 0) {
          problems.push(`\`--pgdata=\` at position ${index} has an empty value`);
          continue;
        }
        options.push({ form: "--pgdata=<dir>", value: attached, position: index });
        continue;
      }
      if (name.length > 0 && PGDATA_LONG_OPTION.startsWith(name)) {
        problems.push(
          `\`--${name}\` at position ${index} is not \`--pgdata\` but could be read as it by a parser that ` +
            "accepts long-option prefixes, and this gate does not decide which reading applies",
        );
      }
      continue;
    }

    if (argument.startsWith("-D") && argument.length > 2) {
      options.push({ form: "-D<dir>", value: argument.slice(2), position: index });
    }
  }

  if (options.length > 1) {
    problems.push(
      `${options.length} data-directory options (${options
        .map((option) => `\`${option.form}\` at position ${option.position}`)
        .join(", ")}); PostgreSQL honours the LAST, and this gate does not re-implement that choice`,
    );
  }

  return { options, problems };
}

/**
 * Build the inspector. `dataDir` is the directory whose ownership is at stake.
 */
export function createOwnershipInspector(options) {
  const {
    dataDir,
    platform = process.platform,
    pidFile = path.join(dataDir, "postmaster.pid"),
    exec,
    isAlive,
    fileExists = (file) => fs.existsSync(file),
    readTextFile = (file) => fs.readFileSync(file, "utf8"),
    removeFile = (file) => fs.rmSync(file, { force: true }),
    sleep = () => {},
    nowSeconds = () => Math.floor(Date.now() / 1000),
    terminationTimeoutMs = 20_000,
    // THE PROCESS TABLE. A postmaster's worker processes are what a pid check cannot see;
    // `null` from this lister is "the platform will not say", which fails closed exactly the
    // way an unreadable argv does.
    listProcesses = null,
    // POSIX only: `/proc/<pid>/cwd`. A backend's working directory is the data directory, so
    // it identifies an orphan whose parent has already been reparented away.
    readLink = (target) => fs.readlinkSync(target),
    // The SERVING test is injected too: it is the only evidence that a gone pid is not a
    // free directory, and a caller that does not model its cluster gets the fail-closed
    // answer ("not serving") only where it explicitly asked for it. Without these two the
    // function would reference undefined identifiers, so `clearStalePostmaster` would throw
    // instead of refusing — see `clusterStillServing` below.
    clusterRunning = () => false,
    dataDirectoryServingIsOurs = () => false,
  } = options ?? {};

  if (!dataDir) throw new Error("createOwnershipInspector needs a dataDir");
  if (typeof exec !== "function") throw new Error("createOwnershipInspector needs an exec");
  if (typeof isAlive !== "function") throw new Error("createOwnershipInspector needs an isAlive");

  const WIN = platform === "win32";

  /**
   * A path compared the way the FILESYSTEM compares it (Windows is case-insensitive).
   *
   * NO QUOTE IS EVER REMOVED HERE. The eighth review's first finding was exactly this:
   * stripping `"` and `'` made two different directories compare equal, and a lock file
   * naming a foreign cluster's postmaster was accepted. Quoting is syntax, and syntax is
   * removed by the tokeniser that consumes it — not by a comparator that cannot know
   * whether a character belongs to the name.
   */
  function samePath(a, b) {
    const norm = (value) => {
      let out = String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
      // A symlinked directory (`/var` → `/private/var` on macOS) is the same directory
      // under a different spelling; best-effort, and only ever makes the comparison MORE
      // likely to succeed for a genuinely identical directory.
      try {
        if (out && fs.existsSync(out)) {
          if (fs.realpathSync.native) out = fs.realpathSync.native(out).replace(/\\/g, "/");
        }
      } catch {
        /* keep the textual form */
      }
      return WIN ? out.toLowerCase() : out;
    };
    return norm(a) === norm(b);
  }

  /** The raw lines of the lock file, or `null` when there is no file. */
  function lockfileLines() {
    if (!fileExists(pidFile)) return null;
    try {
      return String(readTextFile(pidFile)).split(/\r?\n/);
    } catch {
      return null;
    }
  }

  /** The pid the lock file names, or 0 when it names none. Reading is not signalling. */
  function lockfilePid() {
    const raw = lockfileLines();
    if (!raw) return 0;
    const pid = Number(raw[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  }

  /** The data directory the lock file itself records (its second line), or `""`. */
  function lockfileDataDirectory() {
    const raw = lockfileLines();
    return raw && typeof raw[1] === "string" ? raw[1] : "";
  }

  /** The start time recorded on the lock file's third line, or `null`. */
  function lockfileStartEpoch() {
    const raw = lockfileLines();
    if (!raw) return null;
    const recorded = Number(raw[2]);
    return Number.isFinite(recorded) && recorded > 1_000_000_000 ? Math.floor(recorded) : null;
  }

  /** The IMAGE NAME of a live pid, or "" when the platform will not say. */
  function processImageName(pid) {
    const result = WIN
      ? exec("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 30_000 })
      : exec("ps", ["-p", String(pid), "-o", "comm="], { timeout: 30_000 });
    if (!result || result.status !== 0) return "";
    const text = String(result.stdout ?? "");
    const match = text.match(/^"([^"]+)"/m) ?? text.trim().match(/^(\S+)/m);
    return match ? path.basename(match[1]) : "";
  }

  /**
   * The ARGUMENT VECTOR of a live pid — real argv, or `null` when it cannot be had.
   *
   * POSIX: `/proc/<pid>/cmdline` is the process's own argv, NUL-separated, boundaries
   * intact. There is no fallback to `ps`, because `ps` renders a command line and the
   * boundaries cannot be recovered from it — the eighth review's fifth finding.
   * Windows: `Win32_Process.CommandLine`, tokenised by the platform's own quoting rule.
   */
  function argvOfProcess(pid) {
    if (WIN) {
      const commandLine = windowsCommandLine(pid);
      return commandLine ? parseWindowsCommandLine(commandLine) : null;
    }
    let raw;
    try {
      raw = readTextFile(`/proc/${pid}/cmdline`);
    } catch {
      return null;
    }
    if (typeof raw !== "string" || raw.length === 0) return null;
    const argv = raw.split("\0").filter((entry) => entry.length > 0);
    return argv.length > 0 ? argv : null;
  }

  /** The rendered command line of a Windows pid, or "" when the platform will not say. */
  function windowsCommandLine(pid) {
    // `Get-CimInstance` first (wmic is absent on recent Windows images), then wmic.
    const viaPowerShell = exec(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
      { timeout: 60_000 },
    );
    if (viaPowerShell && viaPowerShell.status === 0) {
      // SUCCESS WITH EMPTY OUTPUT IS AN ANSWER, not a failure to retry through another tool:
      // it means this account cannot see that process's command line (a process in another
      // session, typically). `wmic` reads the same WMI provider with the same permissions and
      // cannot do better — and on this machine it costs tens of seconds, which the tenth
      // review's release gate would pay on every stale-start path. `argvOfProcess` turns the
      // empty string into `null`, and ownership stays UNCERTAIN.
      return String(viaPowerShell.stdout ?? "").trim();
    }
    const viaWmic = exec("wmic", ["process", "where", `processid=${pid}`, "get", "commandline", "/format:list"], {
      timeout: 30_000,
    });
    if (viaWmic && viaWmic.status === 0) {
      return String(viaWmic.stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().startsWith("commandline="))
        .map((line) => line.slice("commandline=".length).trim())
        .join(" ");
    }
    return "";
  }

  /**
   * How long this pid has been alive, in whole seconds, as the OS sees it. `null` when the
   * platform will not say — a refusal to draw a conclusion, never a match.
   *
   * AGE, not an absolute start timestamp: a process start time handed back by `Get-Process`
   * carries no usable zone, and converting it produced a value two hours out on this
   * machine. A DURATION needs no zone.
   */
  function processAgeSeconds(pid) {
    if (!(Number.isInteger(pid) && pid > 0)) return null;
    if (WIN) {
      const viaPowerShell = exec(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-Process -Id ${pid} -ErrorAction Stop; [string]([long]((Get-Date) - $p.StartTime).TotalSeconds)`,
        ],
        { timeout: 60_000 },
      );
      if (!viaPowerShell || viaPowerShell.status !== 0) return null;
      const seconds = Number(String(viaPowerShell.stdout ?? "").trim());
      return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null;
    }
    const elapsed = exec("ps", ["-p", String(pid), "-o", "etimes="], { timeout: 30_000 });
    if (!elapsed || elapsed.status !== 0) return null;
    const seconds = Number(String(elapsed.stdout ?? "").trim());
    return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null;
  }

  /** Bounded wait for a pid to disappear. */
  function waitForPidGone(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return true;
      sleep(200);
    }
    return !isAlive(pid);
  }

  /**
   * EVERY process on this machine as `{ pid, parentPid, image }`, or `null` when the platform
   * will not say.
   *
   * Injected when a harness models its own machine; otherwise read through the same bounded
   * `exec` the rest of this file uses. `image` is the base name: `postgres.exe` on Windows,
   * `postgres` on POSIX.
   */
  function processTable() {
    const lister = typeof listProcesses === "function" ? listProcesses : defaultListProcesses;
    let rows;
    try {
      rows = lister();
    } catch {
      return null;
    }
    return Array.isArray(rows) ? rows : null;
  }

  function defaultListProcesses() {
    if (WIN) {
      const result = exec(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)\" }",
        ],
        { timeout: 60_000 },
      );
      if (!result || result.status !== 0) return null;
      const rows = [];
      for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [pid, parentPid, ...rest] = line.split("\t");
        const parsedPid = Number(pid);
        const parsedParent = Number(parentPid);
        if (!Number.isInteger(parsedPid) || parsedPid <= 0) continue;
        if (!Number.isInteger(parsedParent) || parsedParent < 0) continue;
        rows.push({ pid: parsedPid, parentPid: parsedParent, image: rest.join(" ").trim() });
      }
      return rows;
    }
    const result = exec("ps", ["-eo", "pid=,ppid=,comm="], { timeout: 60_000 });
    if (!result || result.status !== 0) return null;
    const rows = [];
    for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;
      rows.push({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        image: path.basename(match[3].trim()),
      });
    }
    return rows;
  }

  /** Every DESCENDANT of `rootPid` in a table, direct and transitive. */
  function descendantsOf(rootPid, table) {
    const children = new Map();
    for (const row of table) {
      if (!children.has(row.parentPid)) children.set(row.parentPid, []);
      children.get(row.parentPid).push(row);
    }
    const seen = new Set();
    const queue = [rootPid];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const child of children.get(current) ?? []) {
        if (seen.has(child.pid)) continue;
        seen.add(child.pid);
        queue.push(child.pid);
      }
    }
    return table.filter((row) => seen.has(row.pid));
  }

  /** Is `candidate` the directory `parent` or inside it? */
  function pathIsInside(parent, candidate) {
    const norm = (value) => {
      let out = String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
      try {
        if (out && fs.existsSync(out) && fs.realpathSync.native) out = fs.realpathSync.native(out).replace(/\\/g, "/");
      } catch {
        /* keep the textual form */
      }
      return WIN ? out.toLowerCase() : out;
    };
    const root = norm(parent);
    const target = norm(candidate);
    if (!root || !target) return false;
    return target === root || target.startsWith(`${root}/`);
  }

  /**
   * THE WORKERS OF A POSTMASTER, AS THEY STAND RIGHT NOW — the snapshot must be taken WHILE it
   * is still alive, because on POSIX a dead parent's children are reparented to init and the
   * link that proved their ownership is gone.
   *
   * Returns `{ known, pids, why }`. `known: false` means the platform would not list
   * processes: nothing may be signalled on that, because the thing that must be verified
   * afterwards cannot even be named.
   */
  function snapshotClusterProcesses(rootPid) {
    if (!(Number.isInteger(rootPid) && rootPid > 0)) {
      return { known: false, pids: [], why: "no positive pid was supplied" };
    }
    const table = processTable();
    if (table === null) {
      return {
        known: false,
        pids: [],
        why: "this platform would not list processes, so the cluster's worker processes cannot be enumerated",
      };
    }
    const pids = descendantsOf(rootPid, table)
      .filter((row) => isAlive(row.pid))
      .map((row) => row.pid);
    return { known: true, pids: pids.sort((a, b) => a - b), why: null };
  }

  /**
   * DID THE WHOLE CLUSTER STOP? — asked of the snapshot taken before the signal.
   *
   * `ok` is the conjunction the tenth review's P1 asks for: the postmaster itself is gone AND
   * every worker that was its descendant is gone. A worker that survives is a cluster that is
   * still using this data directory, whatever the port answers (`remaining` names it).
   */
  function awaitTermination(pid, snapshot) {
    const watched = Array.isArray(snapshot?.pids) ? [...new Set(snapshot.pids)].filter((entry) => entry !== pid) : [];
    let remaining = [];
    const deadline = Date.now() + terminationTimeoutMs;
    for (;;) {
      remaining = watched.filter((candidate) => isAlive(candidate));
      if (remaining.length === 0) break;
      if (Date.now() >= deadline) break;
      sleep(200);
    }
    const parentGone = !isAlive(pid);
    const ok = parentGone && remaining.length === 0;
    return {
      ok,
      parentGone,
      watched,
      remaining,
      why: ok
        ? null
        : parentGone
          ? `pid ${pid} is gone, but descendant process(es) ${remaining.join(", ")} are still alive`
          : `pid ${pid} is still alive`,
    };
  }

  /**
   * WHICH LIVE PROCESSES HOLD THIS DATA DIRECTORY? — the release gate.
   *
   * Three independent statements, because no single one covers the cases the tenth review
   * found:
   *
   *   * descendants of a DEAD lock-file pid. Windows keeps the original parent number on a
   *     child after its parent exits, so a dead postmaster's workers are still nameable; on
   *     POSIX they are not, which is why the snapshot before the signal exists as well.
   *   * a live postmaster whose OWN argument vector names this data directory — a replacement,
   *     including one listening on a different port, which the SERVING test cannot see.
   *   * (POSIX) a PostgreSQL process whose working directory is inside this data directory —
   *     the backend that outlived its postmaster and was reparented out of reach.
   *
   * A FOURTH statement is not a test at all but the absence of one (eleventh review, P1): a
   * live main postmaster whose argument vector cannot be read, or whose vector does not name
   * exactly one data directory unambiguously, is **not** "a process using some other
   * directory". Treating it that way — the old `continue` — answered `known: true, pids: []`
   * and let the lock file be deleted, a replacement started and the data directory removed
   * while a live PostgreSQL may have been using it. Such a process makes the answer
   * UNRESOLVED: it is named in `unresolved`, and the caller refuses and preserves.
   *
   * What still answers `known: true, pids: []` is positive evidence of ANOTHER directory: a
   * readable vector carrying exactly one `-D`/`--pgdata` that resolves somewhere else. That
   * is the positive control — a foreign postmaster is not a reason to refuse.
   *
   * `known: false` is a refusal, not an empty answer. Callers must not remove a lock file,
   * start a replacement or delete the data directory on it.
   */
  function directoryOccupation(deadPid = 0) {
    const table = processTable();
    if (table === null) {
      return {
        known: false,
        pids: [],
        reasons: [],
        why: "this platform would not list processes, so the directory cannot be shown to be free",
      };
    }

    const found = new Map();
    if (Number.isInteger(deadPid) && deadPid > 0) {
      for (const row of descendantsOf(deadPid, table)) {
        if (isAlive(row.pid)) found.set(row.pid, `a descendant of pid ${deadPid}, the pid the lock file names`);
      }
    }

    // ONLY MAIN POSTMASTERS ARE PROBED, not the backends they forked. A backend's data
    // directory is the one its postmaster opened, and the postmaster is scanned on its own
    // line below; reading every backend's command line would cost one platform round trip
    // per process to learn nothing new (`-D` is an option of the MAIN process).
    const postmasterPids = new Set(
      table.filter((row) => row.pid > 0 && isPostmasterImage(row.image)).map((row) => row.pid),
    );
    const byPid = new Map(table.map((row) => [row.pid, row]));
    const forkedByAPostmaster = (pid) => {
      let current = byPid.get(pid)?.parentPid ?? 0;
      for (let guard = 0; current > 0 && guard < 64; guard += 1) {
        if (postmasterPids.has(current) && current !== pid) return true;
        current = byPid.get(current)?.parentPid ?? 0;
      }
      return false;
    };

    // NOT PROVEN FOREIGN IS NOT FREE (eleventh review, P1). Each of these three is a process
    // that may be using THIS data directory and that this gate cannot rule out, so each one
    // turns the whole answer into a refusal instead of being skipped.
    // A postmaster's OWN CHILDREN share its image but never carry `-D`: PostgreSQL starts them
    // with `--forkchild`, `--boot` or `--single`. A readable vector saying so identifies a
    // child, which is not a postmaster whose directory is unknown — the ancestry test above,
    // `descendantsOf(deadPid)` and (POSIX) the working directory already place it. An
    // UNREADABLE vector proves none of that, so it stays unresolved.
    const childRole = (argv) => argv.some((argument) => /^--(forkchild|boot|single)(=|$)/.test(argument));

    const unresolved = [];
    for (const row of table) {
      if (!(row.pid > 0) || !isAlive(row.pid) || !isPostmasterImage(row.image)) continue;
      if (forkedByAPostmaster(row.pid)) continue;
      const argv = argvOfProcess(row.pid);
      if (argv !== null && childRole(argv)) continue;
      const parsed = argv === null ? null : dataDirectoryOptions(argv);
      // NOTHING EXCLUDES A VECTOR THAT CANNOT ANSWER (twelfth review, P1). A previous
      // "started before this directory was created" clock test was removed: a directory's
      // birth time is mutable metadata, not identity, so a live postmaster that really is
      // using this directory could be made to look younger than the process and be skipped.
      // Only a readable vector naming exactly one OTHER directory resolves an answer.
      if (parsed === null) {
        unresolved.push({
          pid: row.pid,
          why: "its argument vector could not be read, so it cannot be shown to be using a different data directory",
        });
        continue;
      }
      if (parsed.problems.length > 0) {
        unresolved.push({
          pid: row.pid,
          why: `its argument vector does not name one data directory unambiguously (${parsed.problems.join("; ")})`,
        });
        continue;
      }
      if (parsed.options.length !== 1) {
        unresolved.push({
          pid: row.pid,
          why:
            `its argument vector carries no data-directory option, so the directory it serves is only ` +
            "known from the environment it inherited",
        });
        continue;
      }
      if (samePath(parsed.options[0].value, dataDir)) {
        found.set(row.pid, "a postmaster whose own argument vector names this data directory");
      }
    }

    if (!WIN) {
      for (const row of table) {
        if (!(row.pid > 0) || found.has(row.pid) || !isAlive(row.pid) || !isPostmasterImage(row.image)) continue;
        let cwd = null;
        try {
          cwd = readLink(`/proc/${row.pid}/cwd`);
        } catch {
          cwd = null;
        }
        if (typeof cwd === "string" && pathIsInside(dataDir, cwd)) {
          found.set(row.pid, "a PostgreSQL process whose working directory is inside this data directory");
        }
      }
    }

    const pids = [...found.keys()].sort((a, b) => a - b);
    const reasons = pids.map((pid) => ({ pid, why: found.get(pid) }));
    if (unresolved.length > 0) {
      const unidentified = unresolved.map((entry) => `pid ${entry.pid}: ${entry.why}`).join("; ");
      return {
        known: false,
        pids,
        reasons,
        unresolved,
        why:
          `live PostgreSQL process(es) cannot be shown to be using a different data directory ` +
          `(${unidentified}), so it cannot be shown that nothing is using ${dataDir}` +
          (pids.length > 0 ? ` (process(es) ${pids.join(", ")} also hold it)` : ""),
      };
    }
    return { known: true, pids, reasons, unresolved, why: null };
  }  /**
   * WHOSE process is the one the lock file names? — asked WITHOUT signalling it.
   *
   *   OURS       EVERY one of these holds, and the last is the positive identity:
   *                1. the lock file names a pid that is alive;
   *                2. that pid's image is a PostgreSQL postmaster (necessary, never enough:
   *                   a foreign cluster's pid looks exactly like this);
   *                3. the lock file records THIS data directory — a file that describes a
   *                   different directory is stale evidence about a different cluster;
   *                4. the process's own argument vector carries EXACTLY ONE `-D`/`--pgdata`
   *                   option and it resolves to THIS data directory. This is the only
   *                   statement on the machine that ties THAT pid to THAT directory, and a
   *                   vector with several (or an abbreviation of `--pgdata`) ties it to
   *                   none of them as far as a signal is concerned — see
   *                   `dataDirectoryOptions`;
   *                5. the lock file's recorded start time does not contradict the pid's.
   *
   *              A start time that AGREES proves nothing (two clusters can start in the
   *              same second), which is why it is not a clause that can authorise.
   *
   *   UNCERTAIN  a live process is named and at least one clause fails, INCLUDING the case
   *              where the platform will not report an argv-preserving argument vector.
   *              Nothing may be signalled.
   *
   *   ABSENT     nothing is named, or what is named is gone.
   *
   * IMPORTANT — the ABSENT/UNCERTAIN distinction is about the LOCK FILE's named pid, not
   * about the cluster. A pid can disappear and be reused (or the lock file can be removed)
   * while the data directory is STILL SERVING on its port, or while another identified
   * cluster resource is still alive. "The named pid is gone" is therefore NOT "the cluster
   * has shut down", and it is not permission to clear the lock, start a replacement, report
   * success for `down`, or delete the directory. Any path that wants to do those things must
   * separately establish that the data directory is NOT serving and that no identified cluster
   * resource remains — see `clusterStillServing` below.
   *
   * The image name is used to REPORT what was found; it is one necessary clause, never the
   * decisive one.
   */
  function inspect() {
    const pid = lockfilePid();
    if (pid <= 0) {
      return { state: "ABSENT", pid: 0, why: "no postmaster.pid names a process", dataDirectories: [] };
    }
    if (!isAlive(pid)) {
      return { state: "ABSENT", pid, why: `postmaster.pid names pid ${pid}, which no longer exists`, dataDirectories: [] };
    }

    const image = processImageName(pid);
    const saw = `pid ${pid} is alive${image ? ` (image \`${image}\`)` : " (the platform would not name its image)"}`;

    if (!isPostmasterImage(image)) {
      return {
        state: "UNCERTAIN",
        pid,
        why: `${saw}, and it is not a PostgreSQL postmaster; an image name says what a process IS, never which directory it owns`,
        dataDirectories: [],
      };
    }

    const recorded = lockfileDataDirectory();
    if (!samePath(recorded, dataDir)) {
      return {
        state: "UNCERTAIN",
        pid,
        why:
          `${saw}, but the lock file records ${recorded ? `\`${recorded}\`` : "no data directory"} rather than ` +
          `\`${dataDir}\`, so the file describes a different cluster`,
        dataDirectories: [],
      };
    }

    const argv = argvOfProcess(pid);
    if (argv === null) {
      return {
        state: "UNCERTAIN",
        pid,
        why:
          `${saw}, but this platform would not report its argument vector in an argv-preserving form, ` +
          "so it cannot be shown to belong to this data directory",
        dataDirectories: [],
      };
    }

    const parsed = dataDirectoryOptions(argv);
    const dataDirectories = parsed.options.map((option) => option.value);

    // AMBIGUOUS FIRST. A vector this gate cannot read exactly is not evidence for anything,
    // and it is checked BEFORE the match below so that a matching earlier option cannot
    // stand in for the one PostgreSQL actually honours (ninth review, P1).
    if (parsed.problems.length > 0) {
      return {
        state: "UNCERTAIN",
        pid,
        why:
          `${saw}, but its argument vector cannot be read as naming one data directory: ` +
          `${parsed.problems.join("; ")}. Which directory it opened is therefore unknown, ` +
          "and nothing may be signalled on that",
        dataDirectories,
      };
    }

    if (dataDirectories.length === 0) {
      return {
        state: "UNCERTAIN",
        pid,
        why: `${saw}, but its argument vector carries no \`-D\`/\`--pgdata\`, so it cannot be shown to belong to this data directory`,
        dataDirectories,
      };
    }

    if (!samePath(dataDirectories[0], dataDir)) {
      return {
        state: "UNCERTAIN",
        pid,
        why:
          `${saw}, but its argument vector does not name this data directory ` +
          `(\`-D\` arguments: ${dataDirectories.map((directory) => `\`${directory}\``).join(", ")})`,
        dataDirectories,
      };
    }

    const lockStart = lockfileStartEpoch();
    const age = processAgeSeconds(pid);
    const pidStart = age === null ? null : nowSeconds() - age;
    if (lockStart !== null && pidStart !== null && Math.abs(lockStart - pidStart) > START_TIME_TOLERANCE_SECONDS) {
      return {
        state: "UNCERTAIN",
        pid,
        why:
          `${saw}; its argument vector names this data directory, but the lock file records a start time of ` +
          `${lockStart} and this process started at ${pidStart}, so the file describes a pid that has been REUSED`,
        dataDirectories,
      };
    }

    return {
      state: "OURS",
      pid,
      why: `${saw}, and its argument vector names this data directory as its one exact \`-D\`/\`--pgdata\` argument`,
      dataDirectories,
    };
  }

  /**
   * THE ONLY FORCE ESCALATION. It takes a pid precisely so no caller can reach it with a
   * bare number read out of a lock file: every call site passes what `inspect()` established.
   *
   *  1. re-read the evidence IMMEDIATELY before the signal, and require OURS for THAT pid;
   *  2. run the platform's force command;
   *  3. CHECK ITS EXIT STATUS, and verify the pid is actually gone.
   *
   * A failure of (3) returns `ok: false` and the caller MUST preserve the lock file and the
   * data. The eighth review's third finding was this function returning `true`
   * unconditionally, so a failed `taskkill` deleted the lock of a live postmaster.
   */
  function stopOwnPostmaster(pid) {
    if (!(Number.isInteger(pid) && pid > 0)) return { ok: false, signalled: false, reason: "no positive pid was supplied" };

    const current = inspect();
    if (current.state !== "OURS") {
      return { ok: false, signalled: false, reason: `ownership could not be re-established immediately before the signal: ${current.why}` };
    }
    if (current.pid !== pid) {
      return {
        ok: false,
        signalled: false,
        reason: `the lock file now names pid ${current.pid}, not the pid ${pid} whose ownership was established`,
      };
    }

    // SNAPSHOT THE WORKERS BEFORE THE SIGNAL (tenth review, P1). A postmaster's backends and
    // auxiliary workers are its descendants, and on POSIX they are REPARENTED the instant it
    // dies — while it is alive is the only moment their ownership can be established. A pid
    // that disappears is therefore NOT a cluster shutdown, and an unresponsive SQL endpoint
    // is not one either: a leftover worker holds the directory without answering anything.
    const snapshot = snapshotClusterProcesses(pid);
    if (!snapshot.known) {
      return {
        ok: false,
        signalled: false,
        reason:
          `the worker processes of pid ${pid} could not be enumerated (${snapshot.why}), so their ` +
          "termination could not be established — nothing was signalled and the cluster is PRESERVED",
      };
    }

    const signal = WIN
      ? exec("taskkill", ["/F", "/T", "/PID", String(pid)], { timeout: 60_000 })
      : exec("kill", ["-9", String(pid)], { timeout: 30_000 });
    const status = signal && Number.isInteger(signal.status) ? signal.status : -1;
    const signalled = status === 0;

    if (!waitForPidGone(pid, terminationTimeoutMs)) {
      return {
        ok: false,
        signalled,
        reason:
          `${WIN ? "taskkill" : "kill -9"} exited ${status} and pid ${pid} is STILL ALIVE: ` +
          "termination could not be verified",
      };
    }

    // THE PARENT IS GONE — THE CLUSTER IS NOT NECESSARILY. Every worker that was a descendant
    // of the postmaster at the moment of the signal must be gone too before anything (lock
    // file, data directory, replacement start) may be released.
    const termination = awaitTermination(pid, snapshot);
    if (!termination.ok) {
      return {
        ok: false,
        signalled,
        descendants: snapshot.pids,
        remaining: termination.remaining,
        reason:
          `pid ${pid} is gone, but descendant process(es) ${termination.remaining.join(", ")} of this ` +
          "cluster are still alive: the cluster has NOT shut down, so nothing may be released",
      };
    }

    return {
      ok: true,
      signalled,
      descendants: snapshot.pids,
      reason: signalled
        ? `${WIN ? "taskkill" : "kill -9"} exited 0, pid ${pid} is gone, and its ${snapshot.pids.length} worker process(es) are gone`
        : `${WIN ? "taskkill" : "kill -9"} exited ${status}, but pid ${pid} is gone: nothing is left to signal`,
    };
  }

  /**
   * Is the data directory still SERVING on its port — asked of the SERVER itself?
   *
   * The decisive question for "can I clear the lock / start a replacement / delete the
   * directory": a live pid can be gone while a different cluster still answers on the port,
   * and the lock file naming a gone pid is NOT evidence that nobody is serving the directory.
   * This function asks the cluster, not the filesystem.
   *
   * Requires `clusterRunning` AND the server's own `data_directory` to be this directory.
   * Both must hold; a listener on our port that reports a DIFFERENT data directory is
   * somebody else's cluster and must not be treated as "our stale postmaster" kin.
   * False by default in injected harnesses that do not model the cluster.
   */
  function clusterStillServing() {
    if (typeof clusterRunning !== "function") return false;
    if (!clusterRunning()) return false;
    if (typeof dataDirectoryServingIsOurs !== "function") return false;
    const serving = dataDirectoryServingIsOurs();
    if (typeof serving === "string" ? serving.length === 0 : !serving) return false;
    // The answer comes from the SERVER, not from the lock file. An earlier version also
    // required the file to name a live OURS/UNCERTAIN pid, which made the check report "not
    // serving" in precisely the case it exists for: a lock file left behind by a gone pid
    // while another cluster still answers on the port (ninth review, P1). A file is never
    // evidence that a port is free.
    return true;
  }

  /**
   * Remove a lock file a crashed postmaster left behind — but only when nothing is left to
   * protect.
   *
   * The eighth review's third finding: the previous caller deleted the file whatever the
   * force command did, so a postmaster that was only ASKED to die lost the evidence of its
   * own liveness. The file is now removed ONLY when the directory is verifiably NOT serving,
   * which is a stronger condition than "the named pid is gone".
   *
   * Callers that want to START A REPLACEMENT (e.g. `ensureCluster` when the port is bound but
   * the cluster is not answering) MUST call this and refuse the replacement when it refuses —
   * otherwise a stale-start cleanup deletes the lock file underneath a live foreign cluster and
   * a new `initdb` is attempted on a directory that may still be in use.
   *
   * Returns `{ cleared, refused, why }`; `refused` is the FAIL CLOSED answer and callers
   * must stop rather than continue.
   */
  function clearStalePostmaster() {
    if (!fileExists(pidFile)) {
      // No lock file: still refuse if something is serving the directory, because a
      // replacement startup must not treat "no lock file" as "directory free".
      if (clusterStillServing()) {
        return {
          cleared: false,
          refused: true,
          pid: lockfilePid(),
          why: "there is no postmaster.pid, but the data directory is still serving on its port",
        };
      }
      // A removed lock file is not proof that the cluster's PROCESSES are gone (tenth
      // review, P1): a worker that outlived its postmaster is invisible to the serving test
      // when it answers nothing. The release is refused while one holds the directory, and
      // while the platform will not say whether one does.
      const occupation = directoryOccupation(0);
      if (!occupation.known) {
        return {
          cleared: false,
          refused: true,
          pid: 0,
          remaining: [],
          why: `there is no postmaster.pid and no server answers, but ${occupation.why}`,
        };
      }
      if (occupation.pids.length > 0) {
        return {
          cleared: false,
          refused: true,
          pid: 0,
          remaining: occupation.pids,
          why:
            `there is no postmaster.pid, but process(es) ${occupation.pids.join(", ")} still hold this ` +
            `data directory (${occupation.reasons.map((entry) => `${entry.pid}: ${entry.why}`).join("; ")})`,
        };
      }
      return { cleared: true, refused: false, pid: 0, remaining: [], why: null };
    }

    const ownership = inspect();
    if (ownership.state === "ABSENT") {
      if (clusterStillServing()) {
        return {
          cleared: false,
          refused: true,
          pid: ownership.pid,
          remaining: [],
          why: `the lock file names pid ${ownership.pid}, which no longer exists, but the data directory still answers on its port`,
        };
      }
      // THE DEAD PID'S OWN WORKERS ARE STILL NAMEABLE (tenth review, P1/P3). On Windows a
      // child keeps its parent's number after that parent exits, so these are exactly the
      // processes the reviewer found alive while the lock was being deleted: parent gone,
      // child alive, no SQL answer.
      const occupation = directoryOccupation(ownership.pid);
      if (!occupation.known) {
        return {
          cleared: false,
          refused: true,
          pid: ownership.pid,
          remaining: [],
          why: `the lock file names pid ${ownership.pid}, which is gone, but ${occupation.why}`,
        };
      }
      if (occupation.pids.length > 0) {
        return {
          cleared: false,
          refused: true,
          pid: ownership.pid,
          remaining: occupation.pids,
          why:
            `the lock file names pid ${ownership.pid}, which is gone, but process(es) ` +
            `${occupation.pids.join(", ")} still hold this data directory ` +
            `(${occupation.reasons.map((entry) => `${entry.pid}: ${entry.why}`).join("; ")})`,
        };
      }
      removeFile(pidFile);
      return { cleared: true, refused: false, pid: ownership.pid, remaining: [], why: null };
    }
    if (ownership.state === "UNCERTAIN") {
      return {
        cleared: false,
        refused: true,
        pid: ownership.pid,
        why: ownership.why,
      };
    }
    if (ownership.state === "OURS") {
      const stopped = stopOwnPostmaster(ownership.pid);
      if (!stopped.ok) {
        return {
          cleared: false,
          refused: true,
          pid: ownership.pid,
          why: `pid ${ownership.pid} was identified as this cluster's postmaster, but termination could not be established (${stopped.reason})`,
        };
      }
    }
    // A verified stop says the pid WE SIGNALLED is gone, and `stopOwnPostmaster` now also
    // verified that the workers it snapshotted are gone. It still does NOT say the directory
    // is free: another cluster can be answering on its port, or a REPLACEMENT can be running
    // on a different one. So both tests are asked after EVERY successful stop, OURS included.
    if (clusterStillServing()) {
      return {
        cleared: false,
        refused: true,
        pid: ownership.pid,
        remaining: [],
        why: "the named pid is gone and no identifiable OURS postmaster remains, but the data directory still answers on its port",
      };
    }
    const occupation = directoryOccupation(ownership.pid);
    if (!occupation.known || occupation.pids.length > 0) {
      return {
        cleared: false,
        refused: true,
        pid: ownership.pid,
        remaining: occupation.pids ?? [],
        why: !occupation.known
          ? `the identified postmaster is gone, but ${occupation.why}`
          : `the identified postmaster (pid ${ownership.pid}) is gone, but process(es) ` +
            `${occupation.pids.join(", ")} still hold this data directory ` +
            `(${occupation.reasons.map((entry) => `${entry.pid}: ${entry.why}`).join("; ")})`,
      };
    }

    // Remove the stale lock file. At this point:
    //   * if ownership was OURS, stopOwnPostmaster already verified the pid is gone;
    //   * if ownership was ABSENT, there was no live named pid and the directory is not
    //     serving (otherwise we would have refused above);
    //   * if ownership was UNCERTAIN, we already refused earlier.
    removeFile(pidFile);
    return {
      cleared: true,
      refused: false,
      pid: ownership.pid,
      remaining: [],
      why: null,
    };
  }

  return {
    samePath,
    inspect,
    stopOwnPostmaster,
    clearStalePostmaster,
    clusterStillServing,
    lockfilePid,
    lockfileDataDirectory,
    argvOfProcess,
    waitForPidGone,
    // The shutdown half of the gate (tenth review): what a pid check cannot see.
    snapshotClusterProcesses,
    awaitTermination,
    directoryOccupation,
  };
}
