import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_LABEL,
  dirFor,
  formatNumber,
  isLocale,
  isolate,
  localeFromCookie,
  otherLocale,
} from "@/components/command/i18n/locale";
import { DICTIONARIES, ar, en } from "@/components/command/i18n/messages";
import { AREAS, RAIL_AREAS } from "@/components/command/lab/areas";
import {
  DEPARTMENTS,
  DEPARTMENT_IDS,
  EXECUTIVE,
  SYSTEMS,
} from "@/components/command/state/organization-model";
import {
  CONTEXT_LAYERS,
  EXEC_ACTIVITY,
  EXEC_AREAS,
  EXEC_IDENTITY,
  EXEC_STATUS,
  MISSION_ROUTE,
  REPEATING_WORK,
  SUMMON_TARGETS,
  WAR_ROOM,
} from "@/components/command/state/exec-model";
import {
  DEPARTMENT_SLUGS,
  WORKSPACES,
  departmentMissions,
  totalMissions,
} from "@/components/command/state/department-workspace";
import { DEPARTMENT_ICONS } from "@/components/command/ui/icons";
import { DEMO_STATES, commandAdapter } from "@/components/command/state/demo/adapter";
import { CommandLocaleProvider, createTranslator, useLocale } from "@/components/command/i18n/command-locale";
import { CONTENT_AR } from "@/components/command/i18n/content";
import { demoDataset } from "@/components/command/state/demo/dataset";
import { SCENARIO_ORDER, buildSnapshot } from "@/components/command/state/demo-scenarios";
import { ACTORS, ACTOR_MODES } from "@/components/command/state/actor-workspace";
import { ACTORS as PRESENCE_ACTORS } from "@/components/command/state/actors";
import { WORKSPACE_MODES } from "@/components/command/state/department-workspace";
import type { AgentStatus, MissionStatus, RiskLevel, SystemState, TaskState } from "@/components/command/state/demo/types";
import type { ExecPhase, NodeVisualStatus } from "@/components/command/state/visual-state";

/**
 * PASS 2 · THE BILINGUAL CONTRACT
 * ───────────────────────────────
 * These assertions turn the Pass-2 promises into facts a build can check:
 *
 *  · the dictionary is COMPLETE in both languages — a key that exists in one and
 *    not the other is a failure here, not a blank line in the UI;
 *  · the Arabic dictionary is a real translation, not a copy of the English;
 *  · every navigable area, department and status enum the product can render has
 *    words in both languages;
 *  · the SIX APPROVED departments are balanced three-and-three around the core,
 *    and the shared service owns no missions.
 *
 * Nothing here renders a component: it asserts the MODEL the components read,
 * which is what keeps the surfaces bilingual instead of the tests.
 */

/* ── Dictionary helpers ─────────────────────────────────────────────────── */

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function leafValue(dictionary: unknown, path: string): string {
  return path.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    dictionary,
  ) as string;
}

const EN_PATHS = leafPaths(en).sort();
const AR_PATHS = leafPaths(ar).sort();

describe("Pass 2 · the dictionary is complete in both languages", () => {
  it("has exactly the same keys in English and Arabic", () => {
    expect(AR_PATHS).toEqual(EN_PATHS);
  });

  it("has no empty translation in either language", () => {
    for (const path of EN_PATHS) {
      expect(leafValue(en, path), `en:${path} is empty`).toBeTruthy();
      expect(leafValue(ar, path), `ar:${path} is empty`).toBeTruthy();
    }
  });

  /**
   * A copy-paste English string is the most common way a "translated" product
   * silently stops being one. Brand and identifier keys are legitimately equal
   * in both languages, so they are listed here explicitly rather than excluded
   * by a pattern — the list IS the exemption policy.
   */
  const IDENTICAL_BY_DESIGN = new Set([
    "shell.brandName",
    "shell.brandSub",
    "shell.osLabel",
    "shell.version",
    "shell.rail.workforce", // "القوى العاملة" differs; kept for clarity of intent
    "areas.exec.label",
    "areas.exec.short",
    "execDock.openPage",
    "execDock.talk", // differs; listed to document the exception review
  ]);

  it("actually translates, rather than reusing the English text", () => {
    const identical = EN_PATHS.filter(
      (path) => leafValue(en, path) === leafValue(ar, path) && !IDENTICAL_BY_DESIGN.has(path),
    );
    /* A handful of technical strings legitimately match (codes, symbols). The
       assertion is that it stays a handful rather than becoming the norm. */
    expect(identical.length, `untranslated keys: ${identical.join(", ")}`).toBeLessThan(12);
  });
});

describe("Pass 2 · every navigable surface and enum has words", () => {
  it("names every area, in both languages", () => {
    for (const area of AREAS) {
      for (const field of ["label", "short", "blurb"] as const) {
        const key = `areas.${area.id}.${field}`;
        expect(EN_PATHS, `${key} missing`).toContain(key);
      }
    }
  });

  it("names every rail area, in both languages", () => {
    for (const rail of RAIL_AREAS) {
      expect(EN_PATHS, `shell.rail.${rail.id} missing`).toContain(`shell.rail.${rail.id}`);
    }
  });

  it("names every department in the dictionary AND gives it an icon", () => {
    for (const department of DEPARTMENTS) {
      for (const field of ["name", "brief", "capability", "space", "insight", "bottleneck", "director"] as const) {
        expect(EN_PATHS, `dept.${department.id}.${field} missing`).toContain(`dept.${department.id}.${field}`);
      }
      expect(DEPARTMENT_ICONS[department.id], `${department.id} has no icon`).toBeTruthy();
    }
  });

  it("labels every status vocabulary the UI can render", () => {
    const statuses: Array<[string, string[]]> = [
      ["status.mission", ["planned", "active", "waiting", "blocked", "review", "completed", "failed"] as MissionStatus[]],
      ["status.task", ["done", "running", "queued", "waiting", "blocked", "failed"] as TaskState[]],
      ["status.agent", ["active", "thinking", "waiting", "idle", "blocked", "offline"] as AgentStatus[]],
      ["status.risk", ["low", "medium", "high", "critical"] as RiskLevel[]],
      ["status.priority", ["low", "normal", "high", "critical"]],
      ["status.decision", ["pending", "approved", "rejected", "expired"]],
      ["status.project", ["discovery", "active", "review", "on-hold", "closed"]],
      ["status.client", ["healthy", "watch", "at-risk"]],
      ["status.activity", ["human", "agent", "mission", "approval", "system", "finance", "error"]],
      ["status.system", ["CONNECTED", "PARTIAL", "MOCK", "MISSING", "BLOCKED", "NEEDS_APPROVAL"] as SystemState[]],
    ];
    for (const [namespace, values] of statuses) {
      for (const value of values) {
        expect(EN_PATHS, `${namespace}.${value} missing`).toContain(`${namespace}.${value}`);
        expect(leafValue(ar, `${namespace}.${value}`)).toBeTruthy();
      }
    }
  });

  it("labels every runtime state and executive phase", () => {
    const nodes: NodeVisualStatus[] = [
      "IDLE", "THINKING", "ACTIVE", "HANDOFF", "WAITING", "APPROVAL_REQUIRED", "BLOCKED", "COMPLETED", "ERROR",
    ];
    for (const status of nodes) {
      expect(EN_PATHS).toContain(`status.node.${status}`);
    }
    const phases: ExecPhase[] = ["ready", "thinking", "running", "waiting"];
    for (const phase of phases) {
      expect(EN_PATHS).toContain(`status.phase.${phase}`);
    }
  });

  it("labels the four reviewer demo states", () => {
    for (const state of DEMO_STATES) {
      expect(EN_PATHS).toContain(`kit.demoState.${state.id}`);
    }
  });
});

describe("Pass 2 · the locale contract", () => {
  it("supports exactly two locales, with a direction each", () => {
    expect(LOCALES).toEqual(["en", "ar"]);
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(otherLocale("en")).toBe("ar");
    expect(otherLocale("ar")).toBe("en");
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("rejects anything that is not a locale", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("writes each locale's own name in its own language", () => {
    expect(LOCALE_LABEL.en).toBe("English");
    expect(LOCALE_LABEL.ar).toBe("العربية");
  });

  it("formats figures with Western digits in both languages", () => {
    /* Identifiers and codes must not change shape with the language: an Arabic
       control room still reads `2041`, never `٢٠٤١`. */
    expect(formatNumber("en", 2041)).toMatch(/2/);
    expect(formatNumber("ar", 2041)).toMatch(/2/);
    expect(formatNumber("ar", 2041)).not.toMatch(/[٠-٩]/);
  });

  it("isolates Latin identifiers for mixed-direction text", () => {
    const wrapped = isolate("MIS-2041");
    expect(wrapped.startsWith("\u2066")).toBe(true);
    expect(wrapped.endsWith("\u2069")).toBe(true);
    expect(wrapped).toContain("MIS-2041");
  });

  it("exposes both dictionaries under the same contract", () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual(["ar", "en"]);
  });

  it("resolves an absent or unknown cookie to the default, never to a guess", () => {
    expect(localeFromCookie("ar")).toBe("ar");
    expect(localeFromCookie("en")).toBe("en");
    expect(localeFromCookie(undefined)).toBe(DEFAULT_LOCALE);
    expect(localeFromCookie("")).toBe(DEFAULT_LOCALE);
    expect(localeFromCookie("fr")).toBe(DEFAULT_LOCALE);
  });

  it("persists the preference in a cookie the server can read", () => {
    /* `localStorage` is unreadable during a server render, which is why a
       returning Arabic reader used to get an English first paint. The key must
       stay a name the layout looks up, and the lifetime must outlast a session. */
    expect(LOCALE_COOKIE).toBe("nexup.command.locale");
    expect(LOCALE_COOKIE_MAX_AGE).toBeGreaterThan(60 * 60 * 24 * 30);
  });
});

/* ── First paint, as the server actually produces it ────────────────────── */

function LocaleProbe() {
  const { locale, dir, t } = useLocale();
  return createElement("div", { "data-locale": locale, dir }, t("cc.title"));
}

function renderWithInitial(initialLocale: "en" | "ar") {
  /* Children go in as the third argument (not a `children` prop): the provider
     is rendered exactly the way the layout renders it. */
  const props = { initialLocale };
  return renderToStaticMarkup(createElement(CommandLocaleProvider, props, createElement(LocaleProbe)));
}

describe("Pass 5 · the first paint is already in the reader's language", () => {
  it("renders Arabic, RTL, from the server when the cookie says ar", () => {
    const html = renderWithInitial("ar");
    expect(html).toContain('data-locale="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/[\u0600-\u06FF]/);
  });

  it("renders English, LTR, when there is no preference", () => {
    const html = renderWithInitial("en");
    expect(html).toContain('data-locale="en"');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toMatch(/[\u0600-\u06FF]/);
  });
});

describe("Pass 2 · six balanced department surfaces", () => {
  it("has exactly six departments, each with a route slug", () => {
    expect(DEPARTMENTS).toHaveLength(6);
    expect(DEPARTMENT_IDS).toHaveLength(6);
    for (const id of DEPARTMENT_IDS) {
      expect(DEPARTMENT_SLUGS[id], `${id} has no slug`).toBeTruthy();
    }
  });

  it("puts three spaces on each side of the Intelligence Core", () => {
    const left = DEPARTMENTS.filter((department) => department.x < EXECUTIVE.x);
    const right = DEPARTMENTS.filter((department) => department.x > EXECUTIVE.x);
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
    /* The core is centred between the two flanks, not pushed to one side. */
    expect(EXECUTIVE.x).toBeGreaterThan(Math.max(...left.map((d) => d.x)));
    expect(EXECUTIVE.x).toBeLessThan(Math.min(...right.map((d) => d.x)));
  });

  it("counts commissioned work only, and never the shared service", () => {
    /* `knowledge` is a SHARED SERVICE: it groups what the organization knows
       rather than work anyone commissioned, so it owns no missions and
       contributes nothing to the totals. Pass 4's taxonomy added one
       work-owning department (`creative`, producing for clients), so the total
       moved by exactly the two client commissions it holds — 13 + 2 = 15. */
    expect(departmentMissions("knowledge")).toEqual([]);
    expect(totalMissions()).toBe(15);
  });

  it("gives every department its own deck, without duplicating an id twice", () => {
    for (const department of DEPARTMENTS) {
      expect(department.deck.length, `${department.id} has no deck`).toBeGreaterThan(0);
      const ids = department.deck.map((action) => action.id);
      expect(new Set(ids).size, `${department.id} repeats a deck action`).toBe(ids.length);
    }
  });
});

/* ── The demo records themselves ────────────────────────────────────────── */

/** Every string in a demo record, with the path it sits at. */
function collectStrings(value: unknown, path: string, out: Array<[string, string]> = []) {
  if (typeof value === "string") {
    out.push([path, value]);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectStrings(item, `${path}[${i}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStrings(child, `${path}.${key}`, out);
  }
  return out;
}

/**
 * A code, identifier, figure or single Latin word: data, not copy to translate.
 * Dotted lowercase tokens are tool, skill and model ids; a currency-led value is
 * a figure. Both appear in copy-bearing fields (`label`, `value`) without being
 * prose, which is why the exemption is spelled out rather than implied.
 */
function isDataValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/\s/.test(trimmed) && trimmed.length <= 14) return true;
  if (/^[a-z][a-z0-9._-]*$/.test(trimmed)) return true;
  if (/^[$€£]\d/.test(trimmed)) return true;
  if (/^\d/.test(trimmed)) return true;
  if (/^[A-Z0-9][A-Z0-9 _·-]*$/.test(trimmed)) return true;
  return false;
}

/**
 * Fields that hold user-visible copy. Listed explicitly rather than guessed, so
 * adding a task title or a role to the demo data fails this test until the
 * Arabic exists — which is the whole point of a bilingual pass.
 */
const COPY_FIELDS = new Set([
  "title",
  "objective",
  "owner",
  "note",
  "actor",
  "text",
  "role",
  "currentFocus",
  "requestedAction",
  "requestedBy",
  "impact",
  "policy",
  "nextMilestone",
  "meta",
  "openItems",
  "purpose",
  "stateDetail",
  "evidence",
  "scope",
  "bottleneck",
  "narrative",
  "activeJob",
  /* The model files label things rather than narrate them. */
  "label",
  "hint",
  "detail",
  "value",
  "cadence",
  "insight",
  "character",
  "headline",
  "mission",
  "priority",
  "capability",
  /* The department workspaces carry the state line and the two fields a reader
     reads first — what the space is for, and what is waiting on a person. */
  "focus",
  "attention",
  "ownership",
  "trend",
  "usedBy",
  "bottleneck",
]);

describe("Pass 2 · the demo records are Arabic too", () => {
  const records: Array<[string, string]> = [
    ...collectStrings(demoDataset(), "dataset"),
    ...SCENARIO_ORDER.flatMap((id) => collectStrings(buildSnapshot(id, 1), `scenario:${id}`)),
    ...collectStrings(ACTOR_MODES, "ACTOR_MODES"),
    ...collectStrings(WORKSPACE_MODES, "WORKSPACE_MODES"),
    /* The three model files the workspaces render from. They hold EXEC's own
       configuration, the six department surfaces and every actor workspace, so
       an untranslated sentence here is an English block inside Arabic chrome. */
    ...collectStrings(ACTORS, "ACTORS"),
    ...collectStrings(DEPARTMENTS, "DEPARTMENTS"),
    ...collectStrings(SYSTEMS, "SYSTEMS"),
    /* The six department workspaces. They are a content model rendered through
       `tc()` exactly like the three above, so leaving them out of this walk left
       the newest department — Creative & Production — describing itself in
       English inside the Arabic product. */
    ...collectStrings(WORKSPACES, "WORKSPACES"),
    ...collectStrings(
      [
        EXEC_IDENTITY,
        EXEC_STATUS,
        EXEC_AREAS,
        SUMMON_TARGETS,
        WAR_ROOM,
        MISSION_ROUTE,
        REPEATING_WORK,
        CONTEXT_LAYERS,
        EXEC_ACTIVITY,
      ],
      "EXEC_MODEL",
    ),
  ];

  it("translates every value of a copy-bearing demo field", () => {
    const missing = records
      .filter(([path]) => COPY_FIELDS.has(path.replace(/\[\d+\]/g, "").split(".").pop() ?? ""))
      .filter(([, value]) => !isDataValue(value))
      .filter(([, value]) => !(value in CONTENT_AR))
      .map(([path, value]) => `${path.replace(/\[\d+\]/g, "[]")}: ${value}`);

    expect([...new Set(missing)]).toEqual([]);
  });

  it("translates every presence actor the rail and the pods render", () => {
    /* `name` is a display label, not an identifier, for the presence cast — which
       is why this is asserted here instead of via the generic field filter, where
       client and system names legitimately stay Latin. */
    const missing = [...new Set(PRESENCE_ACTORS.flatMap((actor) => [actor.name, actor.role]))].filter(
      (value) => !(value in CONTENT_AR),
    );
    expect(missing, `no Arabic line for: ${missing.join(" | ")}`).toEqual([]);
  });

  it("translates the department and actor mode labels the workspaces render", () => {
    const labels = [...WORKSPACE_MODES, ...ACTOR_MODES].flatMap((mode) => [mode.label, mode.hint]);
    const missing = labels.filter((label) => !(label in CONTENT_AR));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("translates the skills, capabilities and model lines the shared registry names", () => {
    /* The shared service names what every department draws on: an agent's
       capabilities and skills, a system's capabilities, and the models with
       their quota notes. Those names are read as content — “Retouching” is a
       skill a reader reads, not an identifier — so each one owes an Arabic line,
       and the identifiers that legitimately stay Latin are mapped to themselves
       in `content.ts` where the decision can be reviewed. */
    const dataset = demoDataset();
    const values = new Set<string>();
    for (const agent of dataset.agents) {
      for (const capability of agent.capabilities) values.add(capability);
      for (const skill of agent.skills) values.add(skill.name);
    }
    for (const system of dataset.systems) {
      for (const capability of system.capabilities) values.add(capability);
    }
    for (const model of dataset.models) {
      values.add(model.name);
      values.add(model.quota.note);
    }

    const missing = [...values].filter((value) => !(value in CONTENT_AR)).sort();
    expect(missing, `no Arabic line for: ${missing.join(" | ")}`).toEqual([]);
  });

});

describe("Pass 2 · the Executive answers in the active language", () => {
  const arTranslate = createTranslator(ar);
  const dataset = demoDataset();

  it("routes an Arabic question to the same branch as its English equivalent", () => {
    const arabic = commandAdapter.reply(dataset, "ما الذي يحتاجني اليوم؟", arTranslate);
    const english = commandAdapter.reply(dataset, "What needs me today?");

    expect(arabic.kind).toBe(english.kind);
    expect(arabic.cards.map((card) => card.value)).toEqual(english.cards.map((card) => card.value));
    expect(arabic.text).toBe(arTranslate("execReply.queueText", {
      count: dataset.decisions.filter((d) => d.status === "pending").length,
      title: dataset.decisions.find((d) => d.status === "pending")?.title ?? "",
      impact: dataset.decisions.find((d) => d.status === "pending")?.impact ?? "",
    }));
  });

  it("writes Arabic, not English, in the Arabic console", () => {
    /* The sentence, the card that frames a figure, and the label of the action
       that continues the conversation. Provider and system NAMES stay Latin,
       which is why the assertion names the copy instead of all card labels. */
    const queue = commandAdapter.reply(dataset, "ما الذي يحتاجني اليوم؟", arTranslate);
    expect(queue.text).toMatch(/[\u0600-\u06FF]/);
    expect(queue.cards[0].label).toBe(arTranslate("execReply.queueCardDecisions"));
    expect(queue.actions[1].label).toBe(arTranslate("execReply.queueActionWhy"));

    const systems = commandAdapter.reply(dataset, "ما الأنظمة الناقصة؟", arTranslate);
    expect(systems.text).toMatch(/[\u0600-\u06FF]/);
    expect(systems.actions[0].label).toBe(arTranslate("execReply.systemsActionMap"));
  });

  it("still composes English when no translator is handed in", () => {
    const fallback = commandAdapter.reply(dataset, "Tell me something surprising.");
    expect(fallback.text).toContain("missions");
  });
});

/* ── Every string the Command product hands to `tc()` ───────────────────── */

/**
 * The overlay is only half the contract; the other half is that render sites ask
 * for the translation. This walks the Command product's own source, collects
 * every literal passed to `tc(...)`, and requires an Arabic line for each. Brand
 * and product identifiers passed through `tc()` are required to be present too,
 * mapped to themselves — which keeps the exempt set written down in `content.ts`
 * instead of hidden in a test pattern.
 */
const TC_CALL = 'tc("';

function commandSourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) commandSourceFiles(full, out);
    else if (/\.tsx?$/.test(full) && !full.includes("i18n")) out.push(full);
  }
  return out;
}

describe("Pass 2 · every tc() literal has an Arabic line", () => {
  const literals = new Set<string>();
  for (const file of [
    ...commandSourceFiles("src/app/command"),
    ...commandSourceFiles("src/components/command"),
  ]) {
    const source = readFileSync(file, "utf8");
    let index = source.indexOf(TC_CALL);
    while (index !== -1) {
      const start = index + TC_CALL.length;
      const end = source.indexOf('"', start);
      if (end === -1) break;
      literals.add(source.slice(start, end));
      index = source.indexOf(TC_CALL, end);
    }
  }

  it("finds the tc() call sites at all", () => {
    expect(literals.size).toBeGreaterThan(100);
  });

  it("translates every one of them", () => {
    const missing = [...literals].filter((value) => !(value in CONTENT_AR)).sort();
    expect(missing, `no Arabic line for: ${missing.join(" | ")}`).toEqual([]);
  });
});
