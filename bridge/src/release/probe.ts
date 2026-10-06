import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { CommandResult, FileRead, HostProbe, PathStat, SourceHit, TreeSearch } from "./runner";

/**
 * The two implementations of the host seam.
 *
 * `createLiveProbe()` inspects the machine it runs on and is what an operator
 * runs on the VPS. `createRecordedProbe()` replays a recorded host so the exact
 * same check definitions can be exercised on a workstation with no Linux host,
 * no network and no Hermes — which is how these probes are tested.
 *
 * A recorded fixture that does not record a command yields `ran: false`, i.e.
 * "could not run", never a silent pass. Fail-closed therefore survives the
 * fixture path too.
 */

export function commandKey(command: string, args: readonly string[] = []): string {
  return [command, ...args].join(" ");
}

/* ── live host ───────────────────────────────────────────────────────────── */

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".cache",
]);

const TEXT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|toml|ya?ml|py|rs|go|txt|cfg|ini|conf|sh|service)$/i;

/** Bounds so a probe can never turn into an unbounded filesystem walk. */
const MAX_FILES = 4_000;
const MAX_BYTES_PER_FILE = 512 * 1024;
const MAX_HITS_PER_NEEDLE = 8;
const COMMAND_TIMEOUT_MS = 15_000;

export function createLiveProbe(): HostProbe {
  return {
    label: () => "live host",
    now: () => new Date(),
    run(command, args = [], options): CommandResult {
      const result = spawnSync(command, [...args], {
        encoding: "utf8",
        timeout: COMMAND_TIMEOUT_MS,
        ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
      });
      if (result.error) {
        const code = (result.error as NodeJS.ErrnoException).code;
        return { ran: false, code: null, stdout: "", stderr: "", reason: code ?? result.error.message };
      }
      return { ran: true, code: result.status ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    read(relativeOrAbsolute): FileRead {
      try {
        return { ok: true, content: readFileSync(relativeOrAbsolute, "utf8") };
      } catch (error) {
        return { ok: false, content: null, reason: (error as NodeJS.ErrnoException).code ?? "unreadable" };
      }
    },
    stat(relativeOrAbsolute): PathStat {
      try {
        const info = statSync(relativeOrAbsolute);
        return {
          exists: true,
          mode: (info.mode & 0o777).toString(8).padStart(3, "0"),
          size: info.size,
        };
      } catch {
        return { exists: false };
      }
    },
    searchTree(root, needles): TreeSearch {
      if (!existsSync(root)) return { ran: false, hits: {}, scannedFiles: 0, reason: "directory not found" };
      const hits: Record<string, SourceHit[]> = Object.fromEntries(needles.map((needle) => [needle, []]));
      let scannedFiles = 0;

      try {
        const stack: string[] = [root];
        while (stack.length > 0 && scannedFiles < MAX_FILES) {
          const dir = stack.pop() as string;
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!SKIP_DIRS.has(entry.name)) stack.push(full);
              continue;
            }
            if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
            if (statSync(full).size > MAX_BYTES_PER_FILE) continue;

            const lines = readFileSync(full, "utf8").split("\n");
            scannedFiles += 1;
            for (const needle of needles) {
              for (let index = 0; index < lines.length; index += 1) {
                if (hits[needle].length >= MAX_HITS_PER_NEEDLE) break;
                if (lines[index].includes(needle)) {
                  hits[needle].push({ file: full, line: index + 1, text: lines[index].trim().slice(0, 160) });
                }
              }
            }
          }
        }
      } catch (error) {
        return {
          ran: false,
          hits,
          scannedFiles,
          reason: (error as NodeJS.ErrnoException).code ?? "walk failed",
        };
      }

      return { ran: true, hits, scannedFiles };
    },
  };
}

/* ── recorded fixture ────────────────────────────────────────────────────── */

export type RecordedCommand = { ran?: boolean; code?: number | null; stdout?: string; stderr?: string };
export type RecordedStat = { exists?: boolean; mode?: string; owner?: string; group?: string; size?: number };
export type RecordedTree = { ran?: boolean; scannedFiles?: number; hits?: Record<string, SourceHit[]> };

export type RecordedFixture = {
  label?: string;
  now?: string;
  commands?: Record<string, RecordedCommand>;
  files?: Record<string, string>;
  stats?: Record<string, RecordedStat>;
  trees?: Record<string, RecordedTree>;
};

export function createRecordedProbe(fixture: RecordedFixture, source: string): HostProbe {
  const label = fixture.label ? `fixture:${source} (${fixture.label})` : `fixture:${source}`;
  const commands = fixture.commands ?? {};
  const files = fixture.files ?? {};
  const stats = fixture.stats ?? {};
  const trees = fixture.trees ?? {};
  const now = fixture.now ? new Date(fixture.now) : new Date(0);

  return {
    label: () => label,
    now: () => now,
    run(command, args = []): CommandResult {
      const recorded = commands[commandKey(command, args)];
      if (!recorded) {
        return { ran: false, code: null, stdout: "", stderr: "", reason: "command not recorded in fixture" };
      }
      return {
        ran: recorded.ran ?? true,
        code: recorded.code ?? 0,
        stdout: recorded.stdout ?? "",
        stderr: recorded.stderr ?? "",
      };
    },
    read(target): FileRead {
      const content = files[target];
      if (content === undefined) return { ok: false, content: null, reason: "file not recorded in fixture" };
      return { ok: true, content };
    },
    stat(target): PathStat {
      const recorded = stats[target];
      if (!recorded || recorded.exists === false) return { exists: false };
      return {
        exists: true,
        ...(recorded.mode !== undefined ? { mode: recorded.mode } : {}),
        ...(recorded.owner !== undefined ? { owner: recorded.owner } : {}),
        ...(recorded.group !== undefined ? { group: recorded.group } : {}),
        ...(recorded.size !== undefined ? { size: recorded.size } : {}),
      };
    },
    searchTree(root, needles): TreeSearch {
      const recorded = trees[root];
      if (!recorded) {
        return { ran: false, hits: {}, scannedFiles: 0, reason: "tree not recorded in fixture" };
      }
      const recordedHits = recorded.hits ?? {};
      const hits: Record<string, SourceHit[]> = Object.fromEntries(
        needles.map((needle) => [needle, recordedHits[needle] ?? []]),
      );
      return { ran: recorded.ran ?? true, hits, scannedFiles: recorded.scannedFiles ?? 0 };
    },
  };
}
