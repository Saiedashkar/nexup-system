#!/usr/bin/env node
/**
 * Re-derives an evidence file's manifest, independently of whoever wrote it.
 *
 * It checks both halves of the claim:
 *
 *   1. `digest` equals the sha256 of the CANONICAL FORM of `files` — so the list
 *      itself cannot be edited without the digest changing;
 *   2. every recorded `sha256` still matches the file on disk — so a stale list, a
 *      tampered file and a MISSING file all fail loudly.
 *
 * It never rewrites anything. A non-zero exit means the evidence does not describe
 * the tree it is sitting in, which is the only thing that makes a digest worth
 * publishing.
 *
 * Usage:
 *   node scripts/verify-evidence-manifest.mjs <evidence.json> [--quiet]
 *
 * The manifest may be the whole file or a `manifest` property of it. `--quiet`
 * prints only the verdict lines, for use inside a proof run.
 */

import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT, verifyManifest } from "./evidence-manifest.mjs";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/verify-evidence-manifest.mjs <evidence.json> [--quiet]");
  process.exit(2);
}
const quiet = flags.includes("--quiet");

const full = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
if (!fs.existsSync(full)) {
  console.error(`FAIL: no such evidence file: ${file}`);
  process.exit(1);
}

let document;
try {
  document = JSON.parse(fs.readFileSync(full, "utf8"));
} catch (error) {
  console.error(`FAIL: ${file} is not JSON: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const manifest = document?.manifest ?? document;
if (manifest?.format !== "nexup-evidence-manifest/1") {
  console.error(`FAIL: ${file} does not carry a ${"nexup-evidence-manifest/1"} manifest (found: ${manifest?.format ?? "none"})`);
  process.exit(1);
}

const verdict = verifyManifest(manifest);
if (!quiet) {
  console.log(`manifest     : ${manifest.files.length} files, format ${manifest.format}`);
  console.log(`digest       : ${verdict.expected}`);
  console.log(`recomputed   : ${verdict.recomputed}`);
  if (verdict.mismatches.length > 0) {
    for (const mismatch of verdict.mismatches) {
      console.log(`  changed    : ${mismatch.path} (recorded ${mismatch.recorded.slice(0, 12)}…, now ${mismatch.actual.slice(0, 12)}…)`);
    }
  }
  for (const missing of verdict.missing) console.log(`  missing    : ${missing}`);
}
console.log(`manifest-state: ${verdict.ok ? "ok" : "failed"}`);
process.exit(verdict.ok ? 0 : 1);
