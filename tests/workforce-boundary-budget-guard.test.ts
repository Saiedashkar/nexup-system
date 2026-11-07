import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUDGET_DECISION_REASONS,
  BUDGET_SPEND_CLASSES,
  DENY_VARIABLE_AI_SPEND_POLICY_REF,
  DenyVariableAiSpendBudgetGovernor,
  denyVariableAiSpendBudgetGovernor,
  type BudgetEvaluationInput,
} from "@/modules/ai-workforce/policies/budget-governor";
import {
  RUNTIME_VARIABLE_COST_METADATA_KEY,
  runtimeDeclaresNoVariableCost,
  spendClassForBinding,
} from "@/modules/workforce/execution/capability-execution-contracts";

/**
 * BUDGET + ENGINEERING-PLANE BOUNDARY TRIPWIRES (ADR 0002).
 *
 * The owner's constraint, in its mechanical form:
 *
 *   1. FreeBuff is ENGINEERING-ONLY. NEXUP's business agents, EXEC and Hermes must
 *      never invoke it, delegate runtime work to it, or fall back to it. It is
 *      never a runtime, a transport, a tool or a degraded-mode responder.
 *   2. Do not assume any subscription provides free runtime/API access. Unknown
 *      billing or entitlement must BLOCK execution.
 *   3. No automatic paid fallback, no credit purchase, no top-up, no provider
 *      switching.
 *   4. Product/EXEC demos stay LOCAL with ZERO model calls.
 *
 * ── WHAT THESE CHECKS ARE, AND WHAT THEY ARE NOT ──
 *
 * These are LIMITED REGRESSION TRIPWIRES, not proofs. They read SOURCE and the
 * MANIFEST, because every rule here is a property of what the repository does NOT
 * contain, and the dangerous change is an ADDITION — someone wires a
 * `FreeBuffAdapter` behind `AgentRuntime`, adds `openai` to `package.json`, or
 * points the demo at a real host. None of that breaks a behavioural test, because
 * no test exercises a path that did not exist before. So the tripwire fails with
 * the file that broke the rule, at review time, instead of in production.
 *
 * They are also deliberately NOT a global ban. An engineering plane is allowed to
 * exist, to be named `EngineeringController`, and to carry a `FreeBuffAdapter` —
 * that is what an ENGINEERING plane is. What this file enforces is the DEPENDENCY
 * DIRECTION: the operations plane (the business agents, EXEC, Hermes) must not
 * import, name or reach engineering execution, so the engineering tool can never
 * become a business runtime, a transport or a fallback.
 *
 * A static scan cannot see everything. It cannot follow a specifier built at
 * runtime, a `require` of a computed name, or code reached through a package that
 * re-exports something else. It is a tripwire against the ORDINARY way this
 * mistake arrives — an import, a dependency, a URL, a wiring — and the real
 * guarantee is that a future runtime integration is a deliberate, reviewed change
 * instead of a quiet one.
 *
 * The fail-closed budget posture itself (sections 2–4) is NOT a static check: it
 * is asserted against the shipped governor and the spend classifier, which is the
 * code the execution boundary actually consults.
 */

const REPO_ROOT = path.resolve(__dirname, "..");

/** Reads a workspace file. Used by every structural check below. */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Strips comments so a structural rule cannot be satisfied — or tripped — by
 * prose. The line-comment pattern deliberately requires the `//` NOT to follow a
 * `:`, so a URL literal (`https://…`) survives intact and a provider host in a
 * string can never be hidden by the cleaner.
 */
function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
}

/** Every file under `relative` whose name ends with one of `extensions`. */
function filesUnder(relative: string, extensions: readonly string[]): string[] {
  const absolute = path.join(REPO_ROOT, relative);
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".demo") continue;
        visit(full);
      } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  visit(absolute);
  return out.sort();
}

/* ══════════════════════════════════════════════════════
   1 — The operations plane cannot REACH an engineering execution path
   ══════════════════════════════════════════════════════ */

/** Every place a business agent's work is routed, hosted or executed. */
const OPERATIONS_ROOTS = [
  "src/modules/ai-workforce",
  "src/modules/workforce",
  "src/app/api/ai-workforce",
  "src/lib",
] as const;

/**
 * Where an engineering plane WOULD live, and where it is allowed to live.
 *
 * Its existence is not a violation: an `EngineeringController` driving an
 * `EngineeringRuntime` port with a `FreeBuffAdapter` behind it is a legitimate
 * piece of software. What must not happen is a business file reaching INTO it,
 * and `isEngineeringPath` below is how this file keeps that distinction — the
 * engineering plane's own files are exempt from the operations-path rules.
 */
const ENGINEERING_ROOTS = ["src/modules/engineering", "src/engineering"] as const;

/**
 * True when a workspace-relative path belongs to the engineering plane.
 *
 * The containment test is written so `src/modules/engineering-plane` and
 * `src/engineering/controller.ts` both match, without a bare substring match that
 * would exempt an unrelated file (say `src/modules/workforce/engineering-notes.ts`)
 * from the operations-path rules.
 */
function isEngineeringPath(file: string): boolean {
  return ENGINEERING_ROOTS.some((root) => file === root || file.startsWith(`${root}/`) || file.startsWith(`${root}-`));
}

/**
 * The names that appear on the operations path ONLY if business work is being
 * routed to engineering execution.
 *
 * NO trailing `\b`: the thing this guards against is an ADAPTER, so the spellings
 * that must be caught are `FreeBuffAdapter`, `CodexAdapter`, `freebuffRuntime` —
 * a word boundary would let every one of them through.
 *
 * SCOPED TO THE OPERATIONS ROOTS. It is the dependency-direction rule in textual
 * form — reaching an engineering execution path requires naming it — which is why
 * the engineering plane itself remains free to use these names.
 */
const ENGINEERING_EXECUTION_NAME =
  /freebuff|codebuff|codex|engineering[-_ ]plane|engineeringcontroller|engineeringruntime|sponsored[-_ ]runtime/i;

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/** Every business-side source file. */
function operationsFiles(): string[] {
  return OPERATIONS_ROOTS.flatMap((root) => filesUnder(root, SOURCE_EXTENSIONS));
}

/**
 * Every module specifier a source file imports or requires.
 *
 * It looks at the specifier rather than the imported SYMBOL on purpose: a
 * re-exporting index would let a symbol-based check pass while the dependency —
 * the thing that makes the two planes one program — is still there.
 */
function importSpecifiers(source: string): string[] {
  const cleaned = strip(source);
  const patterns = [
    /\bfrom\s*["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /^\s*import\s*["'`]([^"'`]+)["'`]/gm,
  ];
  const specifiers: string[] = [];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

/** A specifier that resolves into an engineering execution path. */
const ENGINEERING_SPECIFIER = /(^|[/@._-])(engineering|freebuff|codebuff|codex)([/@._-]|$)/i;

describe("ADR 0002 — the operations plane cannot reach an engineering execution path", () => {
  it("names no engineering agent anywhere on the operations path", () => {
    for (const file of operationsFiles()) {
      expect(
        ENGINEERING_EXECUTION_NAME.test(strip(read(file))),
        `${file} names an engineering agent on the operations path`,
      ).toBe(false);
    }
  });

  it("imports nothing from an engineering execution path", () => {
    // ONLY the operations side is constrained. An engineering plane's files may
    // import each other freely — constraining those is the global ban the third
    // review removed, and it would forbid the engineering plane from existing.
    for (const file of filesUnder("src", SOURCE_EXTENSIONS)) {
      if (isEngineeringPath(file)) continue;
      for (const specifier of importSpecifiers(read(file))) {
        expect(
          ENGINEERING_SPECIFIER.test(specifier),
          `${file} imports "${specifier}" — the operations plane must not depend on engineering execution`,
        ).toBe(false);
      }
    }
  });

  it("declares no engineering agent as a dependency of the operations package", () => {
    // A dependency edge is a dependency direction too, and the package manifest is
    // where the edge would be written FIRST — before any import exists to scan.
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    const engineeringish = declared.filter((name) => ENGINEERING_SPECIFIER.test(name));
    expect(engineeringish, `an engineering agent was added to package.json: ${engineeringish.join(", ")}`).toEqual([]);
  });

  it("ships exactly two CURRENT Step-5 AgentRuntime implementations, in the workforce runtime directory", () => {
    // THE COUNT IS A DESCRIPTION OF TODAY, NOT A PERMANENT CAP. A reviewed future
    // runtime is a legitimate change; what this catches is an UNREVIEWED third one
    // arriving as a quiet fallback. Adding one therefore means updating ADR 0002
    // and this tripwire together — which is the point, and is why the failure
    // message says so rather than "never".
    const adapters = filesUnder("src/modules/workforce/runtimes", [".ts"])
      .filter((file) => /runtime-adapter\.ts$/.test(file))
      .map((file) => path.basename(file))
      .sort();
    expect(
      adapters,
      "a third Step-5 runtime adapter appeared: update ADR 0002 and this tripwire in the same reviewed change",
    ).toEqual(["deterministic-runtime-adapter.ts", "hermes-runtime-adapter.ts"]);

    // …and the implementations agree with the files: exactly these two classes
    // implement the Step-5 `AgentRuntime` port anywhere in `src/`.
    const implementors = filesUnder("src", SOURCE_EXTENSIONS).filter((file) =>
      /implements\s+(Async)?AgentRuntime\b/.test(strip(read(file))),
    );
    expect(implementors).toEqual([
      "src/modules/workforce/runtimes/deterministic-runtime-adapter.ts",
      "src/modules/workforce/runtimes/hermes/hermes-runtime-adapter.ts",
    ]);
  });

  it("accounts SEPARATELY for the retained Phase-1 LocalRuntimeAdapter", () => {
    // The Phase-1 adapter is kept, and it is not a Step-5 `AgentRuntime`: it
    // implements the earlier `RuntimeAdapter` port. Counting it in the Step-5 tally
    // above would have made this tripwire assert a number that was never true.
    const phase1 = "src/modules/ai-workforce/runtime/local-runtime-adapter.ts";
    const source = strip(read(phase1));
    expect(source).toMatch(/class\s+LocalRuntimeAdapter\s+implements\s+RuntimeAdapter\b/);
    expect(source, `${phase1} must not be a Step-5 agent runtime`).not.toMatch(/implements\s+(Async)?AgentRuntime\b/);
  });
});

/* ══════════════════════════════════════════════════════
   2 — No subscription is assumed to be free, and no paid escape hatch exists
   ══════════════════════════════════════════════════════ */

/** A model/agent provider SDK is what would make a paid turn possible at all. */
const PROVIDER_SDK = [
  /^openai$/,
  /^@anthropic-ai\//,
  /^@google\/generative-ai/,
  /^@google-cloud\/vertexai/,
  /^@ai-sdk\//,
  /^langchain/,
  /^llamaindex/,
  /^cohere-ai$/,
  /^@mistralai\//,
  /^@huggingface\//,
  /^replicate$/,
  /^ollama$/,
  /^@aws-sdk\/client-bedrock/,
];

/** Provider endpoints — a literal anywhere in the runtime source or a demo is a leak. */
const PROVIDER_HOST =
  /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openai\.azure\.com|api\.mistral\.ai|api\.cohere\.ai|api\.replicate\.com|api\.groq\.com|api\.together\.xyz|api\.deepseek\.com|api\.x\.ai|openrouter\.ai/i;

/**
 * Capability names that would BE a paid fallback, credit purchase, top-up or
 * provider switch. The stems are matched WITHOUT a trailing word boundary, so a
 * camelCase suffix cannot hide one (`topUpCredits`, `switchProviderNow`); the
 * leading boundary is what keeps this from tripping on an unrelated word.
 */
const PAID_ESCAPE_HATCH =
  /(^|[^a-z0-9])(top[-_]?up|credit[-_]?purchase|purchase[-_]?credit|buy[-_]?credit|prepaid|overdraft|switch[-_]?provider|provider[-_]?switch|fallback[-_]?provider|provider[-_]?fallback|auto[-_]?fallback)/i;

describe("ADR 0002 — unknown spend is blocked and there is no paid escape hatch", () => {
  it("depends on no model/agent provider SDK", () => {
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    const providerish = declared.filter((name) => PROVIDER_SDK.some((pattern) => pattern.test(name)));
    expect(providerish, `a provider SDK was added to package.json: ${providerish.join(", ")}`).toEqual([]);
  });

  it("names no provider endpoint in the runtime source or in the scripts", () => {
    const files = [
      ...filesUnder("src/modules/ai-workforce", SOURCE_EXTENSIONS),
      ...filesUnder("src/modules/workforce", SOURCE_EXTENSIONS),
      ...filesUnder("scripts", [".ts", ".mjs", ".cjs", ".sh"]),
    ];
    for (const file of files) {
      expect(PROVIDER_HOST.test(read(file)), `${file} names a model-provider endpoint`).toBe(false);
    }
  });

  it("contains no top-up, credit-purchase, prepaid-balance, overdraft or provider-switch code", () => {
    for (const root of ["src/modules/ai-workforce", "src/modules/workforce"]) {
      for (const file of filesUnder(root, SOURCE_EXTENSIONS)) {
        expect(PAID_ESCAPE_HATCH.test(strip(read(file))), `${file} implements a paid escape hatch`).toBe(false);
      }
    }
  });

  it("keeps the spend classes and the decision reasons a CLOSED vocabulary", () => {
    expect([...BUDGET_SPEND_CLASSES]).toEqual(["VARIABLE_PROVIDER_COST", "NO_VARIABLE_COST"]);
    expect([...BUDGET_DECISION_REASONS]).toEqual([
      "BUDGET_DENIED_VARIABLE_AI_EXECUTION",
      "ALLOWED_NO_VARIABLE_COST",
      "ALLOWED_ATTESTED_INCLUDED_ROUTE",
      "BUDGET_DENIED_UNCLASSIFIED",
    ]);
  });

  it("declares the attested-included-route allowance without any code able to produce it", () => {
    expect(read("src/modules/ai-workforce/policies/budget-governor.ts")).toContain("ALLOWED_ATTESTED_INCLUDED_ROUTE");
    for (const file of filesUnder("src", SOURCE_EXTENSIONS)) {
      const decisionish = /reason\s*:\s*["'`]ALLOWED_ATTESTED_INCLUDED_ROUTE["'`]/.test(strip(read(file)));
      expect(decisionish, `${file} RETURNS the attested included route`).toBe(false);
    }
  });

  it("ships exactly ONE BudgetGovernor implementation, and it is the DENY default", () => {
    const implementors = filesUnder("src", SOURCE_EXTENSIONS).filter((file) =>
      /implements\s+BudgetGovernor\b/.test(strip(read(file))),
    );
    expect(implementors).toEqual(["src/modules/ai-workforce/policies/budget-governor.ts"]);
    expect(strip(read("src/modules/ai-workforce/policies/budget-governor.ts"))).toMatch(
      /class\s+DenyVariableAiSpendBudgetGovernor\s+implements\s+BudgetGovernor/,
    );
    expect(DENY_VARIABLE_AI_SPEND_POLICY_REF).toBe("budget.deny-variable-ai-spend.v1");
  });
});

/* ══════════════════════════════════════════════════════
   3 — An unknown entitlement is treated as SPENDING
   ══════════════════════════════════════════════════════ */

describe("ADR 0002 — an unknown runtime entitlement fails closed", () => {
  it("treats every non-`false` declaration as spending", () => {
    expect(RUNTIME_VARIABLE_COST_METADATA_KEY).toBe("variableCost");
    // Absent, malformed, or an explicit claim of cost: all spending.
    for (const metadata of [undefined, null, {}, { variableCost: true }, { variableCost: "false" }, { variableCost: 0 }, { variableCost: 1 }]) {
      expect(runtimeDeclaresNoVariableCost(metadata), `${JSON.stringify(metadata)} was treated as free`).toBe(false);
    }
    // Only an explicit, literal `false` in the runtime's OWN identity metadata counts.
    expect(runtimeDeclaresNoVariableCost({ variableCost: false })).toBe(true);
  });

  it("classifies a runtime leg as VARIABLE_PROVIDER_COST unless the runtime declared otherwise", () => {
    expect(spendClassForBinding("RUNTIME")).toBe("VARIABLE_PROVIDER_COST");
    expect(spendClassForBinding("RUNTIME", { runtimeDeclaresNoVariableCost: false })).toBe("VARIABLE_PROVIDER_COST");
    expect(spendClassForBinding("RUNTIME", { runtimeDeclaresNoVariableCost: true })).toBe("NO_VARIABLE_COST");
    // Local work cannot bill per use, so it is the only thing the default permits.
    expect(spendClassForBinding("DETERMINISTIC")).toBe("NO_VARIABLE_COST");
    expect(spendClassForBinding("HUMAN")).toBe("NO_VARIABLE_COST");
  });
});

/* ══════════════════════════════════════════════════════
   4 — The shipped default refuses, and only refuses
   ══════════════════════════════════════════════════════ */

function evaluation(spend: string): BudgetEvaluationInput {
  return { capabilityId: "capability.guard", actorId: "actor_guard", spend: spend as BudgetEvaluationInput["spend"] };
}

describe("ADR 0002 — the default governor is a refusal, never a fallback", () => {
  it("denies spend-capable work and permits only work that cannot bill per use", async () => {
    const governor = denyVariableAiSpendBudgetGovernor();
    expect(governor).toBeInstanceOf(DenyVariableAiSpendBudgetGovernor);

    const denied = await governor.evaluate(evaluation("VARIABLE_PROVIDER_COST"));
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("BUDGET_DENIED_VARIABLE_AI_EXECUTION");
    expect(denied.policyRef).toBe(DENY_VARIABLE_AI_SPEND_POLICY_REF);

    const permitted = await governor.evaluate(evaluation("NO_VARIABLE_COST"));
    expect(permitted.allowed).toBe(true);
    expect(permitted.reason).toBe("ALLOWED_NO_VARIABLE_COST");
  });

  it("refuses an unrecognized spend class rather than guessing", async () => {
    const decision = await denyVariableAiSpendBudgetGovernor().evaluate(evaluation("SOME_FUTURE_CLASS"));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("BUDGET_DENIED_UNCLASSIFIED");
  });

  it("can never return the attested-included-route allowance, even for a spend-capable leg", async () => {
    const reasons = new Set<string>();
    for (const spend of ["VARIABLE_PROVIDER_COST", "NO_VARIABLE_COST", "SOME_FUTURE_CLASS"]) {
      reasons.add((await denyVariableAiSpendBudgetGovernor().evaluate(evaluation(spend))).reason);
    }
    expect(reasons.has("ALLOWED_ATTESTED_INCLUDED_ROUTE")).toBe(false);
  });

  it("is total — every path resolves to a decision instead of throwing", async () => {
    for (const spend of [undefined, "", "VARIABLE_PROVIDER_COST", "NO_VARIABLE_COST"]) {
      const governor = denyVariableAiSpendBudgetGovernor();
      const decision = await governor.evaluate({
        capabilityId: "capability.guard",
        actorId: "actor_guard",
        spend: (spend ?? undefined) as BudgetEvaluationInput["spend"],
      });
      expect(typeof decision.allowed).toBe("boolean");
      expect(BUDGET_DECISION_REASONS).toContain(decision.reason);
    }
  });

  it("hands every caller its own governor, so no module-level default can be mutated", () => {
    expect(denyVariableAiSpendBudgetGovernor()).not.toBe(denyVariableAiSpendBudgetGovernor());
  });
});

/* ══════════════════════════════════════════════════════
   5 — The local demos stay local, with zero model calls
   ══════════════════════════════════════════════════════ */

const DEMO_FILES = [
  "scripts/demo-start.mjs",
  "scripts/demo-env.mjs",
  "scripts/demo-lifecycle.mjs",
  "scripts/demo-run.sh",
] as const;

describe("ADR 0002 — the local demo path is loopback-only and makes no model call", () => {
  it("reaches nothing but 127.0.0.1 / localhost", () => {
    for (const file of DEMO_FILES) {
      const urls = read(file).match(/https?:\/\/[^\s`"')]+/gi) ?? [];
      for (const url of urls) {
        const loopback = /^http:\/\/(127\.0\.0\.1|localhost)([:/]|$)/i.test(url);
        expect(loopback, `${file} reaches a non-loopback URL: ${url}`).toBe(true);
      }
    }
  });

  it("pins the deterministic transport and a local database target, so no provider turn is possible", () => {
    const demoEnv = read("scripts/demo-env.mjs");
    expect(demoEnv).toContain('AI_WORKFORCE_TEST_TRANSPORT="deterministic"');
    expect(demoEnv).toContain('AI_WORKFORCE_DATABASE_TARGET="local"');
  });

  it("keeps the throwaway demo environment out of version control", () => {
    // `.demo/` holds a generated AUTH_SECRET and a local login; if it were ever
    // tracked, the demo would start leaking credentials instead of being one.
    expect(read(".gitignore")).toMatch(/^\.demo\/$/m);
  });
});
