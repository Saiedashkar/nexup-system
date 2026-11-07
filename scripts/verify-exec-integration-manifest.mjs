#!/usr/bin/env node
/**
 * Recomputes EXEC_INTEGRATION_MANIFEST.json from the files on disk.
 *
 * Read-only. It proves that what is in this worktree is still what the manifest
 * recorded: per-path sha256 for every overlay path, and one digest per layer.
 * Any drift (a stray edit, a re-copied file, a line-ending flip) changes a
 * per-path hash and therefore a layer digest, and this exits non-zero.
 *
 *   node scripts/verify-exec-integration-manifest.mjs
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST = "EXEC_INTEGRATION_MANIFEST.json";

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const digestRows = (rows) =>
  createHash("sha256")
    .update(rows.map((row) => `${row.sha256}  ${row.path}`).join("\n") + "\n")
    .digest("hex");

export function verifyManifest(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), "utf8"));
  const problems = [];
  const summary = {};

  for (const [layerName, rows] of Object.entries(manifest.layers)) {
    let checked = 0;
    for (const row of rows) {
      let actual;
      try {
        actual = sha(path.join(root, row.path));
      } catch {
        problems.push(`${layerName}: missing ${row.path}`);
        continue;
      }
      if (actual !== row.sha256) problems.push(`${layerName}: changed ${row.path}`);
      checked += 1;
    }
    summary[layerName] = { checked, expected: rows.length, digest: digestRows(rows) };
  }

  const expected = {
    core73_excludingReport: digestRows(
      manifest.layers.core.filter((row) => row.path !== manifest.digests.reviewReport.path),
    ),
    reviewReport: manifest.layers.core.find((row) => row.path === manifest.digests.reviewReport.path)?.sha256,
    core74_full: digestRows(manifest.layers.core),
    execLayer32: digestRows(manifest.layers.exec),
    authored11: digestRows(manifest.layers.authored),
    product85: digestRows(manifest.layers.product ?? []),
    /* The layers this tree added AFTER the Product copy: the Marketing & Sales
       gateway/room (sales), the marketing room delivered from the product tree
       (marketing) and Mission Control's glass (missionsGlass). They are digested
       exactly like every layer before them, so a stray edit to any of them fails
       verification instead of passing unnoticed. */
    salesLayer: digestRows(manifest.layers.sales ?? []),
    marketingLayer: digestRows(manifest.layers.marketing ?? []),
    missionsGlassLayer: digestRows(manifest.layers.missionsGlass ?? []),
  };

  /* A deletion is part of the overlay: the base commit still carries the file,
     so if it reappears the tree no longer matches what was assembled. */
  for (const removal of manifest.deletions ?? []) {
    if (existsSync(path.join(root, removal.path))) problems.push(`deletion: still present ${removal.path}`);
  }

  for (const [key, value] of Object.entries(expected)) {
    if (manifest.digests[key]?.value !== value) {
      problems.push(`digest ${key}: manifest ${manifest.digests[key]?.value} != recomputed ${value}`);
    }
  }

  return { ok: problems.length === 0, problems, summary, expected };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const { ok, problems, summary } = verifyManifest();
  console.log(
    JSON.stringify(
      {
        manifest: MANIFEST,
        layers: summary,
        problems,
      },
      null,
      2,
    ),
  );
  if (!ok) {
    console.error(`manifest verification FAILED (${problems.length} problem(s))`);
    process.exitCode = 1;
  } else {
    console.log("manifest verification OK");
  }
}
