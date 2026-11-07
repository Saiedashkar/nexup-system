#!/usr/bin/env node
/**
 * THE EVIDENCE MANIFEST — one canonical, documented format, so a digest is a claim
 * anyone can re-derive.
 *
 * An evidence file that lists "the files this was measured against" as an object
 * keyed by path is not checkable: two runs that disagree cannot be compared, a
 * missing entry is invisible, and a digest of it would depend on key order. This
 * module fixes a shape instead of leaving each writer to invent one.
 *
 * ── FORMAT `nexup-evidence-manifest/1` ──
 *
 * {
 *   "format": "nexup-evidence-manifest/1",
 *   "hashAlgorithm": "sha256",
 *   "digestAlgorithm": "sha256",
 *   "canonicalForm": "<the description below, verbatim>",
 *   "files": [                       // SORTED BY `path`, POSIX separators
 *     { "path": "...", "sha256": "<hex>", "bytes": <decimal>, "tracked": <bool|null> }
 *   ],
 *   "digest": "<sha256 of the canonical form>"
 * }
 *
 * The CANONICAL FORM is the text the digest is taken over, and it is intentionally
 * something a shell can reproduce:
 *
 *   for every file, in ascending `path` order:  "<sha256><SP><SP><bytes><SP><SP><path><LF>"
 *
 * i.e. one line per file, `sha256sum`'s two-space separator, the size in bytes as a
 * decimal, the repository-relative path with `/` separators, LF line endings and no
 * trailing blank line. Independent re-derivation, without this module:
 *
 *   node scripts/verify-evidence-manifest.mjs <evidence.json>
 *
 * checks BOTH halves — that `digest` matches the canonical form of `files`, and that
 * every recorded `sha256` still matches the file on disk — so a tampered list, a
 * stale list and a missing file all fail loudly.
 *
 * `tracked` records whether git tracks the path (or null when git cannot say). An
 * UNTRACKED implementation file is exactly the change a reviewer reading only the
 * commit would miss, so it is labelled rather than omitted.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..");
export const MANIFEST_FORMAT = "nexup-evidence-manifest/1";
export const CANONICAL_FORM =
  'one line per file, sorted by `path` (ascending byte order, `/` separators): "<sha256>  <bytes>  <path>\\n" — two spaces as the separator, size in bytes as decimal, LF line endings, no trailing blank line — hashed with sha256';

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

/** The repository-relative, `/`-separated path used in every manifest entry. */
export function manifestPath(file, repoRoot = REPO_ROOT) {
  const relative = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
  return relative.split(path.sep).join("/");
}

/** The manifest's canonical form, given its files. Exported so a verifier re-derives it. */
export function canonicalForm(files) {
  return [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.bytes}  ${file.path}\n`)
    .join("");
}

export function digestOf(files) {
  return crypto.createHash("sha256").update(canonicalForm(files), "utf8").digest("hex");
}

/**
 * Builds the manifest for a list of paths.
 *
 * A path that does not exist is recorded as `{ present: false, path }` and takes
 * part in the canonical form through its own line, so "the file was missing when
 * this ran" is a durable, digest-covered fact rather than an omission.
 */
export function buildManifest(paths, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const files = paths.map((file) => {
    const relative = manifestPath(file, repoRoot);
    const full = path.join(repoRoot, relative);
    if (!fs.existsSync(full)) {
      return { path: relative, present: false, sha256: null, bytes: null, tracked: null };
    }
    const bytes = fs.readFileSync(full);
    return {
      path: relative,
      present: true,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      tracked: git(["ls-files", "--error-unmatch", relative], repoRoot) !== null,
    };
  });
  // A missing file has no hash to take part in the canonical form; it is spelled
  // with the empty-string hash so the line, and therefore the digest, still exists.
  const forDigest = files.map((file) =>
    file.present ? file : { path: file.path, sha256: "-".repeat(64), bytes: -1 },
  );
  return {
    format: MANIFEST_FORMAT,
    hashAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    canonicalForm: CANONICAL_FORM,
    files,
    digest: digestOf(forDigest),
  };
}

/**
 * Re-derives a manifest's digest and re-hashes its files.
 *
 * Returns `{ ok, digestMatches, mismatches, missing, digest, recomputed }` — no
 * printing, so a caller decides what a failure means.
 */
export function verifyManifest(manifest, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const forDigest = files.map((file) =>
    file.present === false ? { path: file.path, sha256: "-".repeat(64), bytes: -1 } : file,
  );
  const recomputed = digestOf(forDigest);
  const mismatches = [];
  const missing = [];
  for (const file of files) {
    if (file.present === false) {
      missing.push(file.path);
      continue;
    }
    const full = path.join(repoRoot, file.path);
    if (!fs.existsSync(full)) {
      missing.push(file.path);
      continue;
    }
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (sha256 !== file.sha256) mismatches.push({ path: file.path, recorded: file.sha256, actual: sha256 });
  }
  return {
    ok: recomputed === manifest?.digest && mismatches.length === 0 && missing.length === 0,
    digestMatches: recomputed === manifest?.digest,
    expected: manifest?.digest ?? null,
    recomputed,
    mismatches,
    missing,
  };
}
