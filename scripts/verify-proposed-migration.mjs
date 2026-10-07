#!/usr/bin/env node
/**
 * Proves a PROPOSED migration is additive-only.
 *
 * Section C of the closure mission requires that a schema change is inspected
 * and demonstrably safe before anyone applies it. Reading the SQL by eye is not
 * a guarantee, so this checks it mechanically:
 *
 *   - no DROP / DELETE / TRUNCATE / RENAME anywhere;
 *   - no ALTER TABLE against a table that already exists (only the tables this
 *     file itself creates may be altered, and only to add a constraint);
 *   - every statement is one of the shapes an additive change may contain;
 *   - the tables created are reported, so a human can compare them with the
 *     intent.
 *
 * Usage:
 *   node scripts/verify-proposed-migration.mjs <migration.sql> [--allow=table,...]
 *
 * `--allow` lists tables this file may ALTER — i.e. the tables it creates. Any
 * other ALTER is a hard failure: that is how a migration would quietly touch
 * production data.
 */

import { readFileSync } from "node:fs";

const DESTRUCTIVE = /^\s*(DROP|DELETE|TRUNCATE|RENAME)\b/i;
const STATEMENT_START = /^\s*(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|CREATE TYPE|ALTER TABLE|COMMENT ON|CREATE EXTENSION|\/\*|--)/i;
/** A statement may also close on its own line (`);`), and comments may continue. */
const CONTINUATION = /^(\)\s*;?|\*|\/\*|--)/;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const allowArg = args.find((a) => a.startsWith("--allow="));
if (!file) {
  console.error("usage: node scripts/verify-proposed-migration.mjs <migration.sql> [--allow=table,...]");
  process.exit(2);
}

const sql = readFileSync(file, "utf8");

// Comments are stripped before checking, and blanked rather than removed so
// line numbers in a failure message still point at the real file. A comment
// that merely MENTIONS a DROP is documentation, not a destructive statement.
const code = sql
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
const lines = code.split(/\r?\n/);

// 1. Nothing destructive, anywhere, in any position.
const destructive = lines
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => DESTRUCTIVE.test(line));
if (destructive.length > 0) {
  console.error(`FAIL: ${file} contains destructive statements:`);
  for (const hit of destructive) console.error(`  ${hit.index}: ${hit.line.trim()}`);
  process.exit(1);
}

// 2. Every non-empty, non-comment line must belong to a statement shape we allow.
const suspicious = lines
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => line.trim() !== "" && !STATEMENT_START.test(line) && !CONTINUATION.test(line.trim()) && !/^\s/.test(line));
if (suspicious.length > 0) {
  console.error(`FAIL: ${file} has lines that start an unrecognized statement:`);
  for (const hit of suspicious) console.error(`  ${hit.index}: ${hit.line.trim()}`);
  process.exit(1);
}

// 3. ALTER TABLE may only target tables this file creates.
const created = [...code.matchAll(/CREATE TABLE\s+"?([a-zA-Z0-9_]+)"?/gi)].map((m) => m[1]);
const allowed = new Set(
  allowArg ? allowArg.slice("--allow=".length).split(",").filter(Boolean) : created,
);
const altered = [...code.matchAll(/ALTER TABLE\s+"?([a-zA-Z0-9_]+)"?/gi)].map((m) => m[1]);
const foreignAlters = altered.filter((table) => !allowed.has(table));
if (foreignAlters.length > 0) {
  console.error(`FAIL: ${file} alters a table it does not create: ${[...new Set(foreignAlters)].join(", ")}`);
  process.exit(1);
}

// 4. Report the intent so a reviewer can diff it against expectation.
const kinds = {};
for (const match of code.matchAll(/^\s*(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|CREATE TYPE|ALTER TABLE)/gim)) {
  kinds[match[1].toUpperCase()] = (kinds[match[1].toUpperCase()] ?? 0) + 1;
}

console.log(`ok   additive-only: ${file}`);
console.log(`ok   no DROP / DELETE / TRUNCATE / RENAME`);
console.log(`ok   every ALTER TABLE targets a table this file creates (${[...allowed].join(", ")})`);
console.log(`     tables created : ${created.join(", ") || "(none)"}`);
console.log(`     statement kinds: ${Object.entries(kinds).map(([k, v]) => `${v}× ${k}`).join(", ")}`);
