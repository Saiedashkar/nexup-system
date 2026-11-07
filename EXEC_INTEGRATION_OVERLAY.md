# EXEC integration copy — assembly record

**Worktree:** `nexup-exec-integration` (sibling of both sources)
**Branch:** `feature/exec-integration-lab`
**Base commit:** `4ecc1a7fd1a28f2a45d2dfbd32a878914133356f` — *feat(workforce): scope the mission lifecycle to the authenticated authority*

This directory is a **throwaway integration copy**. No source worktree was written to:
`nexup-business-system` (Core), `nexup-exec-experience` (EXEC) and `nexup-command-product` (Product)
are as they were before this assembly — the Product layer was read out of its working tree, never into it. Machine-readable detail, including every per-path hash, is in
[EXEC_INTEGRATION_MANIFEST.json](EXEC_INTEGRATION_MANIFEST.json).

## 1. How it was assembled

```
git worktree add ../nexup-exec-integration -b feature/exec-integration-lab 4ecc1a7
# then, path by path, in this order:
#   layer 1 — the Core snapshot   (74 paths, from Core's WORKING TREE)
#   layer 2 — the EXEC layer      (32 paths, from EXEC's WORKING TREE)
#   layer 3 — authored server side (11 paths, written here only)
#   layer 4 — the Product command layer (85 paths from Product's WORKING TREE, 1 deletion)
```

The Core snapshot is **uncommitted work**: `4ecc1a7` alone would have been "a chat lab on the old
Core". So layer 1 copies the frozen snapshot out of Core's working tree, not out of the commit.

### Layer 1 — Core snapshot (74 paths)

| Group | Count | Notes |
|---|---|---|
| Tracked, modified (` M`) | 41 | working-tree bytes, not `HEAD` bytes |
| Untracked (`??`) | 33 | new files, including `AI_WORKFORCE_PHASE_5` proposal |

The earlier statement was 73 + the review report; that is the same set: 74 paths, of which
`docs/evidence/step5a4-tenth-review-corrections-2026-10-24.md` is the report.

### Layer 2 — EXEC layer (32 paths)

| Group | Count | Notes |
|---|---|---|
| Tracked, modified | 1 | `src/app/command/exec/page.tsx` — renders `ExecExperience`, keeps the old console on `/command/exec/console` |
| Untracked source | 17 | `src/components/command/exec-lab/**` |
| Untracked routes + CSS | 3 | `src/app/command/exec-lab.css`, `exec/lab/page.tsx`, `exec/console/page.tsx` |
| Untracked public assets | 10 | 4 images, 4 fonts, `OFL.txt`, `SOURCE.txt` |
| Untracked test | 1 | `tests/exec-experience.test.ts` |

**Overlap between layers: 0.** The one path that both teams *reasoned about* is
`src/app/command/exec/page.tsx`; Core's snapshot does not touch it, so EXEC's version applies
cleanly with no merge decision. No Product API path (`nexup-command-product/src/app/api/**`) was
copied, and the legacy Product EXEC routes are absent here by construction.

### Excluded on purpose

`.exec-*` logs / pid / ready / status files, `tmp-exec-*`, `tmp-captures-*`, `EXEC_HANDOFF.md`,
`docs/**` (evidence, reference boards, mockups, `exec-head-review`), every capture/probe script
(`capture-*.mjs`, `probe-*.mjs`, `nce-capture.sh`, `fix-chrome-css-mjs.mjs`, …), and any `.env`,
secret, cookie or secret-adjacent file. Verified: `git status` in this copy contains **no**
`.env*`, `.log`, `.pid`, `tmp-*` path.

### Layer 3 — authored here (11 paths)

`src/modules/exec-conversation/{contracts,connector,dummy-connector,composition,http-guard}.ts`,
`src/app/api/exec/turn/route.ts`, `src/middleware.ts` (narrow exception),
`tests/exec-conversation-turn.test.ts`, `tests/exec-conversation-timeout.test.ts`,
`tests/exec-review-session.test.ts`, `scripts/exec-review-session.mjs`.

### Layer 4 — Product command layer (2026-10-29)

The six pages a reviewer asked to use (`/command`, clients, projects, missions, finance, EXEC
conversation) lived only in Product's working tree. They were copied in as the **last** layer so the
newest bytes win on every path they own, and nothing else is touched.

| Group | Count | Notes |
|---|---|---|
| `src/app/command/**` and `src/components/command/**` | 79 | 39 tracked-modified + 40 untracked in Product |
| `public/exec-lab/` additions | 3 | `README.md`, `exec-body.webp`, `space-home.webp` (the home composition's background) |
| `public/exec-lab/exec-head.png` | 1 | already present from the EXEC layer, **byte-identical** — the only shared path in the whole tree |
| Product tests | 2 | `tests/command-locale.test.ts`, `tests/command-product-lab.test.ts` |
| **Deletion** | 1 | `src/components/command/adaptive-command-deck.tsx` — Product replaced the permanent bottom deck with `command-actions.tsx` |

**Path-level conflicts: none.** Core ↔ EXEC ↔ Product share zero paths except `exec-head.png`
(identical bytes). What needed a **decision** rather than a merge:

- `src/app/command/exec/page.tsx` is EXEC's. Product never modified it (its version is the base
  `ExecWorkspace`), so the EXEC experience stays mounted at `/command/exec` and the assembled tree did
  not overwrite it. `exec-workspace.tsx` remains in the tree but is no longer mounted by any route.
- `public/exec-lab/` is a **union**, never a replacement: the directory now holds the EXEC character
  assets and fonts *and* the home background. Replacing one set with the other breaks one of the two
  surfaces.
- No `src/app/api/**` path was copied from Product. Core owns `api/ai-workforce/{decisions,missions,
  missions/[id]}`, and its newer guards stay exactly as they were.
- `src/middleware.ts` was not touched by this layer: the narrow `/api/exec/turn` exception is unchanged.

### Reconciliation of the EXEC layer (same day)

Five EXEC files were edited by NEXUP AGENT after the layer was copied (`exec-lab.css`, `chrome.tsx`,
`exec-experience.tsx`, `exec-nav.tsx`, `i18n.ts`). The manifest now records their **current** bytes,
keeps the as-copied hashes per row under `sha256AsCopied`, and stores the original aggregate as
`digests.execLayer32AsCopied` (it would otherwise report a permanent false drift). Nothing in those
files was changed here.

## 2. Verification performed

| Check | Result |
|---|---|
| Core paths copied | 74 / 74, byte-identical to source (`sha256` per path) |
| EXEC paths copied | 32 / 32, byte-identical to source |
| Mismatches | 0 |
| Integration `git status` after layer 1 | 41 ` M` + 33 `??` — identical shape to Core |
| Integration `git status` after layer 2 | 42 ` M` + 64 `??` (adds EXEC's page edit + 31 new files) |
| Product paths copied | 79 source + 4 assets (1 already identical) + 2 tests, byte-identical to source |
| Product deletion | `adaptive-command-deck.tsx` absent — the verifier fails if it returns |
| Integration `git status` after layer 4 | 82 ` M` + 84 `??` + 1 ` D` = 167 entries, 0 staged |
| Manifest | `node scripts/verify-exec-integration-manifest.mjs` → 202 rows, 4 digests, exit 0 |
| Reviewer's per-file hashes (`exec/page.tsx`, `tests/exec-experience.test.ts`) | **match exactly** |
| Reviewer's review-report hash | **matches exactly** (`8ecece1e…88f426e`) |
| Leaked artefacts in the copy | none |

### Digest recipe (reproducible)

Per path: `sha256` of the raw bytes. Layer digest: `sha256` of the path-sorted rows
`<sha256>  <path>`, joined with `\n`, with a trailing `\n`.

The recipe is executable, not prose:

```bash
cd nexup-exec-integration
node scripts/verify-exec-integration-manifest.mjs   # exit 0 = tree still matches the manifest
```

It re-reads every one of the 117 recorded paths, recomputes the five digests, prints them and
fails non-zero on any drift. (A shell `sha256sum` pipeline is *not* equivalent: it emits
`<hash> *<path>` with a single space and its own ordering, which is exactly how two honest
observers end up quoting different aggregates for identical bytes.)

| Digest | Recipe | Value |
|---|---|---|
| Core, 73 paths (excl. report) | rows as above, report removed | `02c0b9119456245b18d971aac949a26f4151aaad4740d36c391a8dc88b23acad` |
| Review report | single file | `8ecece1ee4b19c4c8f2fc983ff7c0ac7a8f1fa94540fc7f55d293dfba88f426e` |
| Core, 74 paths | all rows | `b440aaeddfbc4fbd3f133fa28de35a12fb05e98ed60708ce261b93035af09b3c` |
| EXEC, 32 paths (current bytes) | all rows | `607dc6464eb76319e24d941912901ee92e43ce082ab57bf4c5b4a7d533fae361` |
| EXEC, 32 paths (as copied) | original rows | `c1130edcb66e8955703760d81e5ff83ae89042e401523920e33e443af23a4de7` |
| Authored, 11 paths | all rows | `e570f66bd85d79ed33fa1c86dc977e0cfc6eb4627b5b3b45afcdf00511348873` |
| Product, 85 paths | all rows | `6931b00c1a3ff07c551b3a4d6caa1ed28ed9717dced3549a65efa076dc88efcb` |

**Honest note on the reviewer's aggregate values.** `18084902…`, `8781d341…` and `b0b60205…` are
recorded verbatim in the manifest under `reviewerReferenceValues`. Their row recipe is not
published, and it was not reproduced here: the same 32 EXEC rows yield `c1130edc…` under the
recipe above. What *is* pinned are the things that decide identity — the exact path sets, the
per-file hashes the reviewer published, the review-report hash, and byte-equality of every copy
against its source. Aggregate mismatch therefore indicates a different recipe, not different bytes.

## 3. Environment notes

- `node_modules` is a **directory junction** to `nexup-business-system/node_modules`; nothing was
  installed, and `package.json` / the lockfile are the base commit's.
- The throwaway `AUTH_SECRET` and the minted review cookie jar live **outside** this tree (OS temp);
  neither is copied in, and neither value is printed anywhere.
- `.next/` from the smoke run was deleted; the tree carries sources and review artefacts only.
- `scripts/exec-review-session.mjs` must keep **LF** endings: this vitest/Vite version fails to
  parse a CRLF `.mjs` imported from a test (`SyntaxError: Invalid or unexpected token`).
