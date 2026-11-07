# COMMAND — Marketing Room · handoff to MAIN BUILDER 2

**Worktree** `nexup-command-product` · **branch** `feature/command-product-lab` ·
**HEAD** `4ecc1a7` · nothing committed, staged, pushed or deployed.

**Route:** `/command/marketing`

The room works one campaign — «تصميم متاجر سلة وزد» — from the brief to a
scheduling request, entirely inside the room:

| Station | Opens | Changes |
| --- | --- | --- |
| الاستراتيجية · Strategy | the brief and its acceptance fields | approves the brief |
| المحتوى · Content | the editable X draft, counter, live preview | edits the text by hand |
| مراجعة النشر · Publish review | approval, slot, connector, request history | approves a version, requests scheduling |

---

## 1 · Ownership

This pass owned the marketing room **only**. The shared gateway, the rail, the
phone bar, the composer, the locale provider, the login and `/api/**` belong to
MAIN BUILDER 2 and are untouched.

| Area | Owner | This pass |
| --- | --- | --- |
| `src/app/command/layout.tsx`, `command-shell.tsx`, `global-nav.tsx`, `mobile-nav.tsx`, `context-rail.tsx`, `executive-dock.tsx`, `command.css` … `home.css` | MAIN BUILDER 2 | **not edited** |
| `src/components/command/i18n/*` | MAIN BUILDER 2 | **not edited** — the room carries its own bilingual copy |
| `src/components/command/state/*` | MAIN BUILDER 2 | **not edited** — the room owns its own demo state |
| `src/lib`, `src/app/api`, `prisma/`, auth, X, AI providers, Hostinger | outside scope | **not touched** |
| `src/app/command/marketing/**`, `src/components/command/marketing/**` | this pass | new, self-contained |

The route is reachable by URL today. Wiring it into the rail or a department
card is MAIN BUILDER 2's edit; nothing here requires one.

## 2 · Files to move (exact list — eight source files, one test, this doc)

```
src/app/command/marketing/page.tsx                      the route (metadata, imports the stylesheet)
src/app/command/marketing/marketing.css                 the whole look, every rule scoped to .nc-mk
src/components/command/marketing/marketing-room.tsx     composition: heading, orbit stage, decisions,
                                                        analysis line, team strip, notes, state owner
src/components/command/marketing/station-work.tsx       the in-room work panel (3 stations, tablist)
src/components/command/marketing/campaign-model.ts      the campaign state machine (pure functions)
src/components/command/marketing/schedule-connector.ts  the replaceable connector + local demo impl
src/components/command/marketing/campaign-copy.ts       Arabic + English copy, ar typed as typeof en
src/components/command/marketing/campaign-notice.ts     outcome -> the one notice shown (pure, testable)
tests/command-marketing-room.test.ts                    37 model / connector / copy / notice assertions (25 when this pass shipped)
docs/COMMAND_MARKETING_ROOM.md                          this file
```

Zero modified files. `git status --porcelain` shows only:

```
?? src/app/command/marketing/
?? src/components/command/marketing/
?? tests/command-marketing-room.test.ts
```

Not shipped, dev-only, lives in the git-ignored `.demo/`:
`capture-marketing.mjs` (the capture below), `marketing-dev.log`,
`marketing-checks.log`, `marketing-capture.log`.
`docs/marketing-review/` holds the screenshots and `report.json`.

## 3 · Guarantees the room keeps

1. **The brief gates the work.** Nothing can be approved or scheduled before it.
2. **An approval belongs to a version.** Editing the draft after approval marks
   the approval *expired* and withdraws any accepted schedule; the reader must
   approve again. The version number increments on each approval.
3. **One request, not two.** A request is identified by approved text + slot. An
   accepted (or in-flight) request with that identity is reported as a duplicate
   and the connector is **not called again**. A *refused* request stays
   retryable and the attempt counter increments.
4. **Scheduling is not publishing.** `CampaignState.published` is the literal
   type `false` and no function assigns it. The publish block says so before and
   after acceptance.
5. **Failure is reachable on purpose.** The third slot
   (`thursday-night`, `demoFails: true`) is refused by the demo connector, so the
   failure path is demonstrated rather than described.

## 4 · The connector seam

```ts
type ScheduleConnector = {
  id: string;
  label: string;
  mode: "demo" | "live";
  schedule(input: { campaignId; text; slotId; version }): Promise<ScheduleConnectorResult>;
};
```

`createDemoScheduleConnector()` makes **no network call**, needs **no account or
credential**, and returns a receipt (`demo-x-…`) the room stores. To go live:
implement the same type against X and pass it to `requestSchedule(...)` in
`marketing-room.tsx` — one line. The model, the dedupe rule and every UI state
stay as they are. `mode` is rendered beside the connector label, so a
half-finished switch cannot look live.

## 5 · What a refresh does

**Everything in this room is local to the browser tab.** A refresh, a route
change or a new tab returns the campaign to its first state: brief approval, hand
edits, approval version and request history are **not saved**. The room states
this on the page (`notes.local` / `notes.reset`) rather than implying
persistence. No X account, no AI provider, no database and no publishing path is
connected to this route.

## 6 · Checks run

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint src/app/command/marketing src/components/command/marketing tests/command-marketing-room.test.ts` | exit 0, 0 problems |
| Tests | `npx vitest run tests/command-marketing-room.test.ts tests/command-locale.test.ts tests/command-center-state.test.ts` | **67/67 passed** (25 marketing, 32 locale, 10 centre state) |
| Browser | `node .demo/capture-marketing.mjs http://127.0.0.1:3317` | see §7 |

Run against a private `next dev --webpack -p 3317`. Port 3211 was not touched.

## 7 · Browser evidence

What the browser actually did on `/command/marketing` (Arabic, 1440×900), with the
sentences the room printed:

| Step | What the room showed |
| --- | --- |
| brief → hand edit → publish review | approval reads «الاعتماد: لم تُعتمد بعد» — the edit expired the version, and the schedule block is withdrawn |
| approve version → slot → request | «الجدولة مقبولة» · receipt `demo-x-1-1` · publish line «الجدولة مقبولة للموعد اليوم · 6:00 م. ولم يُنشر المنشور على X.» |
| the identical request again | «طلب مكرّر» · the history stayed at **one** row, so the connector was not called a second time |
| reset → demo-refusal slot | «الموصل التجريبي رفض الطلب» (`x_schedule_refused`) · `data-accepted="false"` · publish line «لم يُنشر. الجدولة المقبولة طلب، وليست نشرًا.» |
| console errors | **0** during the whole walk |
| horizontal overflow | none at 1440 RTL, 1440 LTR and 390 RTL (scrollWidth equals the viewport in all three) |
| phone, scrolled to the end | the notes end at y=710 with the fixed `nc-mobilebar` starting at y=772 — nothing sits under the phone bar |

`docs/marketing-review/` — captured on the route above, Arabic first:

- `marketing-desktop-ar.png` · 1440×900
- `marketing-mobile-ar.png` · 390×844, plus full-page and publish-panel frames
- `marketing-desktop-en.png`
- the journey: `marketing-review-stale-ar.png` (approval expired after a hand
  edit), `marketing-journey-success-ar.png`, `marketing-journey-duplicate-ar.png`,
  `marketing-journey-failure-ar.png`
- `report.json` — the notice text, history rows, publish sentence, station and
  team states, and the horizontal-overflow measurement for each frame.

## 8 · Visual direction

Planet, orbit rings, smoked glass and calm champagne edges use `foundation.css`
tokens; `marketing.css` adds only `.nc-mk`-scoped rules. Blue is not used at all
(it belongs to EXEC), mint is the single action colour, and the one animated
element — a very slow outer ring — stops under `prefers-reduced-motion` and
`.nc-root[data-motion="reduced"]`. Arabic is the reference reading: RTL-first,
logical properties only, no letter-spacing. The phone is recomposed rather than
shrunk — decisions first, stations as full-width rows, a scrollable tab strip,
no horizontal overflow.
