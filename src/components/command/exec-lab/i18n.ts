/**
 * NEXUP COMMAND — EXEC EXPERIENCE · LOCALISATION
 * ─────────────────────────────────────────────
 * Arabic (RTL) and English (LTR), each COMPLETE. No label shows both languages
 * side by side: the reviewer picks a language and the whole surface speaks it.
 *
 * `MessageKey` is DERIVED from the English dictionary, and the Arabic
 * dictionary is typed as an exact `Record<MessageKey, string>`. A key present in
 * English but missing in Arabic is therefore a COMPILE ERROR, not a silent
 * runtime fallback. That is the only durable way to keep "Arabic is complete"
 * true as the surface grows.
 *
 * The dictionary is the ONLY place a human reads a rendered sentence. Domain
 * state (`types.ts`) carries keys, never sentences, which is what lets a
 * language change happen without touching the conversation or the task.
 */

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_DIR: Record<Locale, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };

/** The label a reviewer reads on the switch — written in the OTHER language. */
export const LOCALE_SWITCH_LABEL: Record<Locale, string> = { ar: "English", en: "العربية" };

export const DEFAULT_LOCALE: Locale = "ar";

/**
 * The founder's name, per language. Kept here rather than imported from the
 * shell's organization model: this surface renders exactly one sentence with it,
 * and reaching into another layer's state for a display name would couple the
 * two for no gain. "سعيد" in Arabic, transliterated in English.
 */
export const FOUNDER_NAME: Record<Locale, string> = { ar: "سعيد", en: "Saeed" };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return LOCALE_DIR[locale];
}

export function isRtl(locale: Locale): boolean {
  return LOCALE_DIR[locale] === "rtl";
}

/* ═══════════════════════════════════════════════════════
   English — the source of truth for the key set
   ═══════════════════════════════════════════════════════ */

const EN = {
  /* ── Chrome ─────────────────────────────────────────── */
  "app.kicker": "Executive Intelligence · NEXUP COMMAND",
  "app.role": "Chief Executive AI",
  "app.reportsTo": "Reports to the Founder",
  "app.back": "Command",
  "app.demoBadge": "Demo",
  "app.demoNote":
    "Test mode. Free messages use an offline dummy connector; no model, runtime, tool, memory store or database is connected.",
  "app.locale": "Language",
  "app.resetRun": "Reset this run",
  "app.openConsole": "Open the EXEC foundation console",
  "app.voiceUnavailable": "Voice — not available",
  "app.voiceNote": "Voice and live connection are not built yet. The control is shown disabled on purpose.",
  "app.connectUnavailable": "Live connection — not available",
  "app.portraitAlt":
    "EXEC — the approved character portrait, cropped from the approved character board.",
  "app.characterNote":
    "The EXEC portrait is the approved character art, cropped from the approved board and shown still — not a 3D model and not animated. The team sheet is a flat reference image.",

  /* ── Scope ──────────────────────────────────────────── */
  "scope.title": "Working context",
  "scope.current": "Current scope",
  "scope.company": "Company",
  "scope.client": "Client",
  "scope.project": "Project",
  "scope.change": "Change scope",
  "scope.isolated": "Client scopes are isolated. Moving to another context closes the open task and clears this conversation and any staged attachment, so nothing from one client can be visible inside another.",
  "scope.nexup": "NEXUP",
  "scope.nexup.hq": "NEXUP HQ",
  "scope.client.nexuq": "Nexuq (internal)",
  "scope.client.atlas": "Atlas Holding",
  "scope.client.dune": "Dune Studio",
  "scope.project.brandWeek": "Brand demand week",
  "scope.project.gulfLaunch": "Gulf launch",
  "scope.project.retainer": "Retainer operations",

  /* ── EXEC states ────────────────────────────────────── */
  "status.available": "Available",
  "status.planning": "Preparing the plan",
  "status.working": "Working",
  "status.waiting": "Waiting",
  "status.needs_approval": "Needs your approval",
  "status.blocked": "Blocked",
  "status.reviewing": "Reviewing the results",
  "status.completed": "Completed",
  "status.failed": "Execution failed",
  "status.offline": "Offline",
  "status.legend": "Every state carries a label and a symbol, never colour alone.",

  /* ── Task states ────────────────────────────────────── */
  "task.planned": "Planned",
  "task.working": "In progress",
  "task.waiting": "Waiting on inputs",
  "task.blocked": "Held",
  "task.review": "Under review",
  "task.completed": "Completed and verified",
  "task.failed": "Failed",
  "task.cancelled": "Cancelled (demo)",
  "task.label": "Task",

  /* ── Team ───────────────────────────────────────────── */
  "team.title": "Who EXEC routes to",
  "team.note": "Responsibilities are fixed; the five codenames are not final yet.",
  "team.exec": "Executive",
  "team.systems": "Systems & Automation",
  "team.creative": "Creative & Content",
  "team.growth": "Growth & Marketing",
  "team.operations": "Client Operations",
  "team.engineering": "Product Engineering",
  "team.exec.mandate": "Sets the outcome, the plan and the acceptance criterion; reviews the result.",
  "team.systems.mandate": "Connects tools, runs approved actions and watches integrations.",
  "team.creative.mandate": "Turns strategy into ideas, content and visual identity.",
  "team.growth.mandate": "Tests offers and channels and develops growth opportunities.",
  "team.operations.mandate": "Organises clients, projects and delivery.",
  "team.engineering.mandate": "Builds the product and the code, fixes and tests.",
  "team.active": "Engaged now",
  "team.idle": "Not engaged",

  /* ── Conversation ───────────────────────────────────── */
  "conv.general": "General conversation",
  "conv.task": "Task conversation",
  "conv.general.note": "General conversation is not attached to a task.",
  "conv.task.note": "This conversation is attached to {code}.",
  "conv.empty": "Say what you want NEXUP to do. EXEC sets the outcome, proposes a plan and brings back what needs your decision.",
  "conv.from.exec": "EXEC",
  "conv.from.you": "You",
  "conv.msg.copy": "Copy the message",
  "conv.msg.copied": "Copied",
  "conv.composer.placeholder": "Direct EXEC… e.g. prepare a content week for NEXUP on X to attract visual-identity requests, without publishing.",
  "conv.composer.send": "Send",
  "conv.composer.hint": "Write what you want done",
  "conv.composer.attach": "Attach a demo file",
  "conv.composer.voice": "Voice — unavailable",
  "conv.composer.note":
    "Free messages receive one reply from the offline dummy connector. Explicit demo scripts remain local and advance only by your actions.",
  "conv.attachments": "Attachments (demo)",
  "conv.attachment.note": "Demo attachment. Nothing is uploaded or read.",
  "conv.attachment.remove": "Remove",
  "conv.attachment.imageName": "demo-preview.png",
  "conv.attachment.docName": "demo-brief.pdf",
  "conv.demoReply":
    "This is a demo surface: no model is called and no task is created. Open the review tools to run a scripted demo scenario step by step — every move there needs an explicit action from you.",
  "conversation.testBadge": "Test reply — no real model connection",
  "conversation.ephemeral": "Messages are lost when the page is refreshed.",
  "conversation.pending": "Waiting for the test reply…",
  "conversation.error.invalidInput": "The message could not be sent. Reference: {requestId}",
  "conversation.error.unauthorized": "Your session is no longer valid. Sign in again. Reference: {requestId}",
  "conversation.error.csrfRejected": "The request was refused because it did not come from this app. Reference: {requestId}",
  "conversation.error.messageTooLarge": "The message is over the allowed limit. Reference: {requestId}",
  "conversation.error.connectorUnavailable": "The test connector is unavailable. Nothing was executed. Reference: {requestId}",
  "conversation.error.timeout": "The reply timed out. Nothing was executed. Reference: {requestId}",
  "conversation.error.internal": "The test connector failed. Nothing was executed. Reference: {requestId}",
  "conversation.error.protocol": "The server returned an invalid response. Nothing was displayed. Reference: {requestId}",
  "conversation.error.network": "The server could not be reached. Nothing was executed. Reference: {requestId}",
  "composer.demoNote":
    "No model or runtime. Free replies come from the test connector; scripted demo steps still need your click.",

  /* ── Empty screen — before the conversation starts ──── */
  "empty.greeting": "What should we work on, {name}?",
  "empty.demoNote": "Test mode: free messages reach an offline dummy connector; no model or company action runs.",
  "empty.suggest.review": "Review where the company stands",
  "empty.suggest.plan": "Plan a project",
  "empty.suggest.prepare": "Prepare a task",
  "empty.suggest.script": "Run the demo script: {name}",

  /* ── Shell chrome that only exists on this page ─────── */
  "nav.collapse": "Collapse the navigation",
  "nav.expand": "Expand the navigation",

  /* ── Whether to keep the conversation general or task-scoped ── */
  "conv.scope.general": "General",

  /* ── One collapsible execution summary ──────────────── */
  "summary.panel": "Execution details",
  "summary.progress": "Stage {done} of {total}",
  "summary.open": "Show the workflow",
  "summary.close": "Hide the workflow",
  "step.queued": "Queued",
  "step.running": "Running",
  "step.done": "Done",
  "step.blocked": "Blocked",
  "summary.review": "View the review",
  "summary.review.close": "Close the review",
  "summary.deeper": "Team and dependencies",
  "conv.approvalLead": "This one needs your decision",

  /* ── Review tools, deliberately outside the experience ─ */
  "tools.title": "Review tools",
  "tools.note": "Demo scenarios and the state vocabulary live here, out of the conversation.",
  "tools.open": "Open the review tools",
  "menu.dev": "dev",
  "lab.title": "EXEC review tools",
  "lab.note": "Demo scenarios, the state vocabulary, the reference boards and the demo history. A review instrument — not part of the EXEC conversation.",

  /* ── Panels / details ───────────────────────────────── */
  "panel.details": "Details",
  "panel.open": "Show details",
  "panel.close": "Hide details",
  "panel.team": "Team",
  "panel.timeline": "Timeline",
  "panel.dependencies": "Dependencies",
  "panel.overview": "Run overview",
  "panel.history": "Demo history",
  "panel.corrections": "Correction rounds",
  "panel.attempts": "Attempts",
  "panel.timeline.empty": "No events yet. Progress appears when a demo event happens, never on a timer.",
  "panel.dependencies.note": "Shown only while the plan is being reviewed.",
  "panel.causedByYou": "your action",
  "panel.causedByDemo": "demo setup",
  "panel.execState": "EXEC state",
  "panel.taskState": "Task state",
  "panel.stateSeparation": "EXEC's state and the task's state are separate. A step finishing does not complete the task.",

  /* ── Demo history ───────────────────────────────────── */
  "hist.brand": "Brand demand week — first pass",
  "hist.brandVoice": "Brand voice guidelines",
  "hist.gulf": "Gulf launch — asset intake",
  "hist.gulfOffer": "Gulf launch — offer review",
  "hist.retainer": "Retainer — monthly reconciliation",
  "hist.retainerAssets": "Retainer — asset refresh",

  /* ── Reference assets ───────────────────────────────── */
  "refs.title": "Reference assets",
  "refs.note": "The approved design boards, shown as flat reference images. Not a 3D model, not animated, and not redrawn here.",
  "refs.exec.alt": "EXEC character reference board: silver angular head, black face screen, blue eye, light technical jacket, grey trousers.",
  "refs.exec.caption": "EXEC — character board",
  "refs.team.alt": "NEXUP AI Workforce team sheet with six characters and their specialities.",
  "refs.team.caption": "AI Workforce — team sheet",

  /* ── Scenario picker ────────────────────────────────── */
  "scen.title": "Demo scenarios",
  "scen.note":
    "Each scenario is a scripted, deterministic run. An explicit action moves it forward — there is no timer and no invented progress.",
  "scen.start": "Run this scenario",
  "scen.restart": "Run again",
  "scen.running": "Running",
  "scen.launch_brief": "Launch brief",
  "scen.launch_brief.summary": "A short executive exchange: choose the launch goal, then review a compact demo brief.",
  "scen.content_week": "Content week for X",
  "scen.content_week.summary": "The full flow: brief, plan, delegation, review, a caught claim, correction and verified result.",
  "scen.missing_inputs": "Missing inputs",
  "scen.missing_inputs.summary": "EXEC cannot write without the brand inputs and says exactly what it needs.",
  "scen.approval": "Approval request",
  "scen.approval.summary": "A commitment inside EXEC's reach only with your approval, with the trade-off made explicit.",
  "scen.blocked_dependency": "Stuck on a dependency",
  "scen.blocked_dependency.summary": "A blocked run with the reason stated, and the two honest ways out.",
  "scen.failure_cancel": "Failure and demo cancellation",
  "scen.failure_cancel.summary": "A bounded attempt ceiling is reached; the run fails, and a demo cancellation returns EXEC to available.",
  "scen.offline": "Offline",
  "scen.offline.summary": "EXEC is unreachable. The surface says so instead of faking activity.",

  /* ── Timeline kinds ─────────────────────────────────── */
  "tl.agent": "Agent",
  "tl.mission": "Task",
  "tl.approval": "Approval",
  "tl.system": "System",
  "tl.error": "Error",
  "tl.human": "Human",

  /* ── Cards ──────────────────────────────────────────── */
  "card.brief": "Brief",
  "card.plan": "Plan",
  "card.plan.steps": "{count} steps",
  "card.plan.dependsOn": "Depends on {refs}",
  "card.plan.noDeps": "No dependency",
  "card.plan.owner": "Owner",
  "card.delegation": "Delegation",
  "card.delegation.deliverable": "Deliverable",
  "card.delegation.authority": "Authority",
  "card.delegation.due": "Expected",
  "card.gate": "Approval required",
  "card.gate.authority": "What you are authorising",
  "card.gate.cost": "Ceiling",
  "card.evidence": "Evidence",
  "card.evidence.claim": "Claim",
  "card.evidence.source": "Source",
  "card.evidence.supported": "Traceable in this run",
  "card.evidence.unsupported": "No source in this run",
  "card.correction": "Correction",
  "card.correction.before": "Before",
  "card.correction.after": "After",
  "card.correction.bound": "Bound",
  "card.verification": "Verification",
  "card.verification.traceable": "Traced to a source",
  "card.verification.untraceable": "Cannot be traced",
  "card.result": "Result",
  "card.result.verified": "Verified",
  "card.result.title": "Content week · Demo result",
  "card.result.description": "A verified, review-ready summary of the scripted output.",
  "card.result.demo": "Demo",
  "card.result.preview": "Preview",
  "card.result.edit": "Edit (demo)",
  "card.result.details": "Details and evidence",
  "card.result.preview.note": "A text preview inside this demo — no file was exported and nothing left the page.",
  "card.result.noPublish": "Nothing was published",
  "card.inputs": "Required inputs",
  "card.inputs.blocks": "Blocks: {what}",
  "card.attachment": "Attachment (demo)",

  /* ── Short launch brief ────────────────────────────── */
  "s.launch.opener": "Prepare a launch plan for NEXUP.",
  "s.launch.task.title": "NEXUP — launch brief",
  "s.launch.goal.msg": "What should this launch optimise for?",
  "s.launch.goal.leads": "Qualified leads",
  "s.launch.goal.awareness": "Brand awareness",
  "s.launch.brief.msg": "Here is the concise launch brief for review.",
  "s.launch.result.title": "Launch brief · Demo result",
  "s.launch.result.description": "A concise launch brief ready for review.",
  "s.launch.result.goal.label": "Primary goal",
  "s.launch.result.goal.leads": "Qualified leads",
  "s.launch.result.goal.awareness": "Brand awareness",
  "s.launch.result.audience.label": "Audience",
  "s.launch.result.audience.value": "Decision-makers evaluating NEXUP",
  "s.launch.result.next.label": "Next step",
  "s.launch.result.next.value": "Review positioning, audience and launch sequence",
  "s.launch.result.noPublish": "Demo only — no file was created and nothing was published",

  /* ── Main scenario · content week ───────────────────── */
  "s.content.title": "Content week on X for NEXUP",
  "s.content.opener": "Prepare a content week for NEXUP on X. The goal is to attract visual-identity requests. No publishing.",
  "s.content.task.title": "NEXUP — content week on X",
  "s.content.brief.msg":
    "Understood. I set the scope before anything is written. If the outcome below is not what you meant, correct it now — changing it later re-does the work under it.",
  "s.content.brief.goal.label": "Outcome",
  "s.content.brief.goal.value": "Inbound visual-identity requests from X",
  "s.content.brief.deliverables.label": "Deliverables",
  "s.content.brief.deliverables.value": "7 drafts, 1 visual direction, 1 message-angle set",
  "s.content.brief.success.label": "Success criterion",
  "s.content.brief.success.value": "Qualified requests, not impressions",
  "s.content.brief.constraint.label": "Constraint",
  "s.content.brief.constraint.value": "No publishing at any step of this run",
  "s.content.plan.msg":
    "Four steps, one review gate, one bounded correction round. Explicit assumptions: the audience already knows it needs a brand, and the offer is a fixed-scope visual identity.",
  "s.content.plan.step.angles": "Message angles for X",
  "s.content.plan.step.visual": "Visual direction",
  "s.content.plan.step.drafts": "The 7-draft set",
  "s.content.plan.step.verify": "Verification against the brief",
  "s.content.plan.revised.msg":
    "Noted. I kept the plan to four steps and changed only what you asked. The gate stays where it is, because the drafting work sits under it.",
  "s.content.gate.title": "Approve the plan",
  "s.content.gate.body":
    "Growth and Creative start only after you approve. I am not starting them on an unapproved plan, and I am not publishing anything either way.",
  "s.content.gate.authority": "Approve the plan and the drafting work under it",
  "s.content.del.growth.deliverable": "Message angles for X, grounded in the visual-identity offer",
  "s.content.del.growth.authority": "Propose only — no publishing, no spend",
  "s.content.del.growth.due": "Before drafting starts",
  "s.content.del.creative.deliverable": "One visual direction: composition, type, colour, examples",
  "s.content.del.creative.authority": "Propose only — no external assets to be licensed",
  "s.content.del.creative.due": "Before drafting starts",
  "s.content.delegate.msg":
    "Routing now. Growth owns the message angles and Creative owns the visual direction. They run in parallel because neither depends on the other; I own the review.",
  "s.content.await.msg":
    "Both assignments are out. I am waiting on their inputs before any drafting starts — I will not draft against missing angles.",
  "s.content.await.ev.growth": "Growth delivered the message-angle set",
  "s.content.await.ev.creative": "Creative delivered the visual direction",
  "s.content.draft.msg":
    "Inputs are in, so drafting can start. The drafts stay inside this run: no post leaves this environment at any point.",
  "s.content.draft.attach": "draft-set-preview.png",
  "s.content.review.msg": "Reviewing the drafts against the brief and against the evidence I hold.",
  "s.content.review.ev.start": "Review started against the brief and its success criterion",
  "s.content.find.msg":
    "I found one unsupported claim. Draft 3 states the work \"doubled engagement\" for a comparable client. Nothing in this run supports that number: it is not in the brief, not in the angle set and not in the visual direction. I am holding the draft. Because the claim is about results, I will not soften it by guessing — either a source exists and goes in, or the line is rewritten.",
  "s.content.find.reason": "One draft carries a number with no source inside this run.",
  "s.content.ev.claim": "Draft 3: \"doubled engagement for a comparable client\"",
  "s.content.ev.source": "No source inside this run — not in the brief, the angles or the direction",
  "s.content.correct.msg":
    "Correction round one of one. The number is out. The line now states what the visual direction actually changes, which I can trace. One more round of this would mean the brief is wrong, not the draft — so this is the only round I am spending.",
  "s.content.corr.before": "Doubled engagement for a comparable client",
  "s.content.corr.after": "One clear identity, applied consistently across the profile and the campaign set",
  "s.content.corr.bound": "One round only",
  "s.content.verify.msg": "Re-running verification on the corrected set.",
  "s.content.verify.item.brief": "Every claim traces to the brief or to an input delivered in this run",
  "s.content.verify.item.deliverables": "All four deliverables exist and match the brief",
  "s.content.verify.item.noPublish": "No publishing step ran or was reached",
  "s.content.verify.item.cancel": "No external spend or licence was created",
  "s.content.result.msg":
    "Result verified, so this run is complete. I checked the outcome against the success criterion you set, not against the volume of work produced.",
  "s.content.result.drafts.label": "Drafts",
  "s.content.result.drafts.value": "7, all traceable",
  "s.content.result.visual.label": "Visual direction",
  "s.content.result.visual.value": "1, delivered",
  "s.content.result.angles.label": "Message-angle set",
  "s.content.result.angles.value": "1, delivered",
  "s.content.result.claims.label": "Unsupported claims",
  "s.content.result.claims.value": "0 remaining — 1 caught and corrected",
  "s.content.result.next.label": "Status",
  "s.content.result.next.value": "Ready for you to publish, when you decide to",
  "s.content.choice.showPlan": "Show the plan",
  "s.content.choice.draft": "Start drafting",
  "s.content.choice.approve": "Approve the plan",
  "s.content.choice.requestChange": "Request a change",
  "s.content.choice.run": "Start the work",
  "s.content.choice.review": "Review the drafts",
  "s.content.choice.inspect": "Inspect the evidence",
  "s.content.choice.correct": "Correct the claim",
  "s.content.choice.reverify": "Re-verify",
  "s.content.choice.result": "Show the result",
  "s.content.ev.planApproved": "Plan approved; drafting authorised",
  "s.content.ev.changeRequested": "Change requested on the plan",
  "s.content.ev.routed": "Growth and Creative engaged in parallel",
  "s.content.ev.draftStart": "Drafting started on delivered inputs",
  "s.content.ev.found": "Unsupported claim found and the draft held",
  "s.content.ev.corrected": "Claim corrected in one bounded round",
  "s.content.ev.verified": "Result verified against the brief",
  "s.content.ev.completed": "Run completed; nothing published",

  /* ── Missing inputs ─────────────────────────────────── */
  "s.inputs.title": "Brand assets are missing",
  "s.inputs.opener": "Turn the visual direction into a full content week for Atlas Holding.",
  "s.inputs.task.title": "Atlas Holding — content week",
  "s.inputs.msg":
    "I cannot start this one. Three inputs are missing and each of them changes the output rather than just filling it in.",
  "s.inputs.item.logo": "The primary logo, in vector form",
  "s.inputs.item.palette": "The approved colour values",
  "s.inputs.item.voice": "Two examples of the brand's own writing",
  "s.inputs.blocks": "Blocked: drafting cannot start, and I will not invent brand assets",
  "s.inputs.choice.provide": "Add the inputs (demo)",
  "s.inputs.received.msg": "Inputs received. The plan is unchanged from the standard content-week shape, so I will not re-litigate it.",
  "s.inputs.done.msg": "Deliverables produced against the supplied assets. Nothing was published.",
  "s.inputs.ev.provided": "Three brand inputs supplied in this run",
  "s.inputs.result.label": "Status",
  "s.inputs.result.value": "Drafts ready against real brand inputs",

  /* ── Approval ───────────────────────────────────────── */
  "s.approval.title": "Commitment above EXEC's reach",
  "s.approval.opener": "Push the Gulf launch harder this month.",
  "s.approval.task.title": "Gulf launch — paid reach",
  "s.approval.msg":
    "I can do this, but not on my own authority. It commits spend, so it stops here until you decide.",
  "s.approval.gate.title": "Authorise paid reach for the Gulf launch",
  "s.approval.gate.body":
    "Estimated reach is under the ceiling below. I cannot yet prove the conversion rate, so treat the return as an assumption, not a forecast.",
  "s.approval.gate.authority": "Spend up to the ceiling, and a stop when it is reached",
  "s.approval.choice.approve": "Approve the spend",
  "s.approval.choice.reject": "Decline",
  "s.approval.approved.msg":
    "Approved, inside the ceiling. I am tracking it as bounded spend and I will stop at the limit rather than come back for more.",
  "s.approval.rejected.msg":
    "Declined. I am not running it, and I am recording the decision with its reason so it is not re-proposed by accident.",
  "s.approval.blocked.why": "The commitment is above EXEC's authority, so it needs your decision.",
  "s.approval.ev.approved": "Spend authorised with a hard ceiling",
  "s.approval.ev.rejected": "Spend declined by the owner",
  "s.approval.failed.why": "Execution stopped: the required approval was declined.",
  "s.approval.running.msg": "Running inside the approved ceiling. Nothing above the limit can be spent.",
  "s.approval.result.label": "Spend",
  "s.approval.result.value": "Inside the approved ceiling",

  /* ── Blocked on a dependency ────────────────────────── */
  "s.blocked.title": "Stuck on an external dependency",
  "s.blocked.opener": "Finish the Dune Studio retainer deck.",
  "s.blocked.task.title": "Dune Studio — retainer deck",
  "s.blocked.msg":
    "Dune Studio has not returned the approved figures. I am blocked: I will not publish numbers a client has not confirmed, and I will not use last quarter's numbers as if they were this quarter's.",
  "s.blocked.reason": "Waiting on Dune Studio to confirm the figures. I cannot proceed without them and I will not substitute a guess.",
  "s.blocked.choice.substitute": "Continue with a marked placeholder",
  "s.blocked.choice.hold": "Keep it held",
  "s.blocked.substituted.msg":
    "Moving with a marked placeholder: every unconfirmed figure is flagged in the deck itself and in this run's log. If the client sees it, they see exactly what is unconfirmed.",
  "s.blocked.held.msg": "Holding. Nothing is produced and nothing moves until the figures arrive.",
  "s.blocked.held.task": "Held until the client confirms the figures",
  "s.blocked.ev.substituted": "Continued with unconfirmed figures flagged",
  "s.blocked.ev.held": "Kept held; no output produced",
  "s.blocked.done.msg": "Deck produced with the unconfirmed figures flagged. Nothing was sent to the client.",
  "s.blocked.result.label": "Unconfirmed figures",
  "s.blocked.result.value": "Flagged in the deck and in the log",

  /* ── Failure and cancellation ───────────────────────── */
  "s.fail.title": "Failure and demo cancellation",
  "s.fail.opener": "Reconcile the September delivery ledger.",
  "s.fail.task.title": "September delivery reconciliation",
  "s.fail.msg":
    "I have run this reconciliation and it will not close. The ledger and the delivery record disagree on four entries, and the discrepancy is not a rounding difference — it is a missing record.",
  "s.fail.reason":
    "Reconciliation failed: four entries disagree and the source record is missing. I will not adjust a ledger to make it balance.",
  "s.fail.choice.retry": "Retry once",
  "s.fail.choice.cancel": "Cancel this demo run",
  "s.fail.retry.msg":
    "Retried. Same four entries, same missing records. That is the ceiling: a further retry would spend effort without changing the answer, so I am stopping.",
  "s.fail.cancelled.msg":
    "Cancelled at your instruction. I am available again, and the task is closed as cancelled — the run did not complete and I am not calling it a success.",
  "s.fail.ev.failed": "Reconciliation failed and the run was stopped",
  "s.fail.ev.ceiling": "Attempt ceiling reached; further retries refused",
  "s.fail.ev.cancelled": "Demo run cancelled by the owner",
  "s.fail.result.label": "Ledger",
  "s.fail.result.value": "Unreconciled — no adjustment was applied",
  "s.fail.retryUsed": "1 retry used, ceiling reached",

  /* ── Offline ────────────────────────────────────────── */
  "s.offline.title": "EXEC is not reachable",
  "s.offline.opener": "Prepare next week's plan.",
  "s.offline.task.title": "Next week's plan",
  "s.offline.msg":
    "I am not connected, so I cannot plan or delegate anything. I would rather say that than show you work that is not happening.",
  "s.offline.reason": "The runtime behind EXEC is unreachable, so no task can start or continue.",
  "s.offline.hint": "Nothing is queued and nothing will start on its own.",

  /* ── The header: history, identity, context, workspace, one menu ────── */
  "head.history": "Conversations",
  "head.workspace": "Workspace",
  "head.more": "More options",
  "head.agent": "Change agent",
  "head.agent.only": "EXEC is the only agent in this build.",
  "head.agent.later":
    "The rest of the team becomes selectable here later. No other agent, codename or role exists yet, so none is offered.",

  "menu.options": "Options",
  "menu.new": "New conversation",
  "menu.voice": "Voice conversation",
  "menu.future": "Not built yet",
  "menu.console": "EXEC foundation console",
  "menu.lab": "Review tools and scenarios",
  "menu.reset": "Reset the open run",
  "menu.navCollapse": "Collapse the navigation",
  "menu.navExpand": "Expand the navigation",
  "menu.language": "Language",

  /* ── The one panel ───────────────────────────────────────────── */
  "side.workspace": "Workspace",
  "side.history": "Conversations",
  "side.close": "Close the panel",
  "side.work": "Work",
  "side.session": "Session",
  "side.settings": "EXEC settings",
  "side.plan": "Plan",
  "side.progress": "Progress",
  "side.outputs": "Outputs",
  "side.evidence": "Evidence",
  "side.noTask":
    "No task is open in this conversation. When one is, its plan, progress, outputs and evidence appear here.",
  "side.progress.value": "{done} of {total} steps in this run's script",
  "side.outputs.none": "No output yet.",
  "side.evidence.none": "No evidence recorded yet.",
  "side.evidence.supported": "Traceable to this run",
  "side.evidence.unsupported": "Not traceable",
  "side.conversation": "This conversation",
  "side.conversation.value": "{count} lines · {tab}",
  "side.scope": "Context",
  "side.participants": "Participants",
  "side.participants.value": "You and EXEC. A call with named participants is not built yet.",
  "side.call": "Call",
  "side.call.note":
    "A call with participants, a record and decisions is not built yet. No microphone is requested and nothing is recorded.",
  "side.identity": "Identity",
  "side.identity.value": "Executive Intelligence · reports to the Founder",
  "side.capabilities": "Capabilities",
  "side.capabilities.value":
    "Plan, delegate, review and report. Skills and tools are not connected in this build.",
  "side.memory": "Memory",
  "side.memory.value":
    "No memory store is connected. Nothing said here is remembered after the page is left.",
  "side.connections": "Connections",
  "side.connections.value": "No provider, model or runtime is connected in this build.",
  "side.settings.note":
    "Shown for review only. There is no switch, key or connection behind any of these yet.",
  "side.view": "Open the workspace panel",

  /* ── Conversations ──────────────────────────────────────────── */
  "history.new": "New conversation",
  "history.open": "Open now",
  "history.lines": "{count} lines",
  "history.task": "Task",
  "history.general": "General",
  "history.empty": "No conversation is parked yet. Starting a new one parks this one here.",
  "history.unfinished": "Run not finished",
  "history.isolation":
    "History is kept inside the current context only. Changing the context clears it, so nothing from one client can be read inside another.",
  "history.restore": "Open this conversation",

  /* ── What a change did, said out loud ────────────────────────── */
  "notice.parked":
    "The open conversation was parked in Conversations with its run. Nothing was deleted.",
  "notice.draftKept": "Your draft was kept.",
  "notice.attachmentsKept": "Staged attachments were kept.",
  "notice.script":
    "A scripted demo run started. It moves one step at a time, and only when you choose what comes next.",
  "notice.scriptBusy":
    "A run is already open, so nothing was sent. Finish it or reset it from the tools below before starting another script.",
  "notice.scopeCleared":
    "Context changed. The open task, this conversation and the previous context's history were cleared, so nothing from the previous context carries over.",
  "notice.dismiss": "Dismiss",

  /* ── The composer's own controls ─────────────────────────────── */
  "composer.attach": "Add an attachment",
  "composer.attach.file": "File",
  "composer.attach.image": "Image",
  "composer.attach.local": "Local pick (demo)",
  "composer.attach.note":
    "In this demo the name and a preview stand in for the file: nothing is read, uploaded or analysed, and no path leaves your machine.",
  "composer.dictate": "Dictation",
  "composer.dictate.note":
    "Not built yet. Nothing is recorded and no microphone permission is asked for.",
  "composer.send.note": "Enter sends · Shift+Enter starts a new line",

  /* ── The composer's inner rail ───────────────────────────────────
     Everything the rail says about itself: the two pickers it holds, the one
     primary action, and the two things that are stated as NOT available rather
     than dressed up as working controls. */
  "composer.tools": "Writing tools",
  "composer.agent": "Who works on this",
  "composer.agent.current": "EXEC — the agent on this conversation",
  "composer.brain": "Brain",
  "composer.brain.none": "Not connected",
  "composer.brain.note":
    "No model or provider is connected. Free messages use the same-origin offline dummy connector; explicit scripts remain local.",
  "composer.send.tip": "Send · Enter",
  "composer.stop": "Stop the task",
  "composer.stop.note":
    "Stops the open run at this step and marks the task cancelled. What was already done stays readable.",
  "menu.effects.off": "Reduce effects",
  "menu.effects.on": "Reduced effects: on",
  "menu.effects.note":
    "Turns the glass and the pointer motion off. The layout, the text and every control stay exactly as they are.",
  "menu.preferences": "Account and preferences",
  "menu.review": "Review and development",
  "menu.reviewNote": "Scripted scenarios and review routes. They are not everyday EXEC capabilities.",
  "notice.effects": "Effects setting changed. No task, message or draft was touched.",

  "scroll.newest": "Back to the newest message",
  "card.attachment.local": "Stand-in for a file you picked. Not uploaded and not analysed.",

  /* ── The navigation this surface owns ───────────────── */
  "nav.aria": "EXEC navigation — the conversation, the sessions and the tools",
  "nav.sessions": "Sessions",
  "nav.tools": "Tools",
  "nav.plugins": "Plugins",
  "nav.chat": "Chat",
  "nav.recent": "Recent sessions",
  "nav.untitledSession": "New conversation",
  "nav.newSession": "New session",
  "nav.sessionSearch": "Search conversations",
  "nav.sessionNoResults": "No conversations match this search.",
  "nav.account": "Demo account",
  "nav.accountDemo": "Saeed · Demo",
  "nav.appearance": "Appearance",
  "nav.appearanceDark": "Dark",
  "nav.memoryOnly": "Temporary session",
  "nav.settings": "Settings",
  "nav.settingsUnavailable": "Settings — unavailable",
  "nav.toolsLead": "What this build actually wires up, and what it deliberately does not.",
  "nav.toolsNone":
    "No tool, model or provider is connected. Only the same-origin offline dummy conversation connector is enabled for test replies.",

  /* ── Live work — one control, one view ──────────────── */
  "live.open": "Open workspace",
  "live.close": "Close workspace",
  "live.title": "Workspace",
  "live.hint": "Activity, previews and outputs beside the conversation.",
  "live.none":
    "No task is open, so there is no live work to show. Start one and its steps, progress and dependencies appear here.",
  "live.demo": "Demo activity — no model and no runtime are running behind this.",

  /* ── Structured workspace and confirmed local systems ─ */
  "workspace.title": "Workspace",
  "workspace.activity": "Activity",
  "workspace.preview": "Preview",
  "workspace.outputs": "Outputs",
  "workspace.back": "Back to the conversation",
  "workspace.preview.empty": "Nothing is available to preview yet.",
  "workspace.outputs.empty": "No demo output has been created in this conversation.",
  "plugins.title": "Plugins",
  "plugins.lead": "Confirmed systems and their current EXEC access. No key is stored in this browser.",
  "plugins.connectedLocal": "Connected locally",
  "plugins.notConnected": "Not connected",
  "plugins.access": "Access",
  "plugins.execApi.name": "EXEC Conversation API",
  "plugins.execApi.detail": "Same-origin test route used by free conversation in this integration build.",
  "plugins.execApi.access": "One message and one synthetic reply",
  "plugins.dummy.name": "Offline dummy connector",
  "plugins.dummy.detail": "Returns a controlled test response. It is not a language model.",
  "plugins.dummy.access": "Test-only, no tools",
  "plugins.r2.name": "Cloudflare R2 receipt storage",
  "plugins.r2.detail": "A server-side project capability; this EXEC surface has no binding to it.",
  "plugins.r2.access": "None from EXEC",
  "plugins.provider.name": "External model provider",
  "plugins.provider.detail": "No provider is connected in this integration build.",
  "plugins.provider.access": "None",

  /* ── The composer's second choice ───────────────────── */
  "composer.model": "Model",
} as const;

export type MessageKey = keyof typeof EN;

/* ═══════════════════════════════════════════════════════
   Arabic — must cover every key, enforced at compile time
   ═══════════════════════════════════════════════════════ */

const AR: Record<MessageKey, string> = {
  /* ── Chrome ─────────────────────────────────────────── */
  "app.kicker": "العقل التنفيذي · NEXUP COMMAND",
  "app.role": "الرئيس التنفيذي الذكي",
  "app.reportsTo": "يرفع مباشرةً إلى المؤسس",
  "app.back": "غرفة القيادة",
  "app.demoBadge": "تجريبي",
  "app.demoNote":
    "وضع اختباري. الرسائل الحرة تستخدم موصلًا وهميًا محليًا؛ لا يوجد موديل أو runtime أو أداة أو ذاكرة أو قاعدة بيانات موصولة.",
  "app.locale": "اللغة",
  "app.resetRun": "إعادة تعيين هذا التشغيل",
  "app.openConsole": "افتح لوحة EXEC التوطيرية",
  "app.voiceUnavailable": "الصوت — غير متاح",
  "app.voiceNote": "الصوت والاتصال المباشر لم يُبنَيا بعد. الزر معطَّل عن قصد.",
  "app.connectUnavailable": "الاتصال المباشر — غير متاح",
  "app.portraitAlt":
    "EXEC — صورة الشخصية المعتمدة، مقصوصة من لوحة الشخصية المعتمدة.",
  "app.characterNote":
    "صورة EXEC في الأعلى هي فن الشخصية المعتمد، مقصوصة من اللوحة المعتمدة وتُعرض ثابتة — وليست نموذجًا ثلاثي الأبعاد ولا متحركة. ولوحة الفريق صورة مرجعية ثابتة.",

  /* ── Scope ──────────────────────────────────────────── */
  "scope.title": "سياق العمل",
  "scope.current": "النطاق الحالي",
  "scope.company": "الشركة",
  "scope.client": "العميل",
  "scope.project": "المشروع",
  "scope.change": "تغيير النطاق",
  "scope.isolated": "سياقات العملاء معزولة. الانتقال إلى سياق آخر يُغلق المهمة المفتوحة ويمسح هذه المحادثة وأي مرفق مُجهَّز، فلا يظهر شيء من عميل داخل سياق عميل آخر.",
  "scope.nexup": "NEXUP",
  "scope.nexup.hq": "مقر NEXUP",
  "scope.client.nexuq": "Nexuq (داخلي)",
  "scope.client.atlas": "أطلس القابضة",
  "scope.client.dune": "ديون ستوديو",
  "scope.project.brandWeek": "أسبوع طلب الهوية",
  "scope.project.gulfLaunch": "إطلاق الخليج",
  "scope.project.retainer": "تشغيل العقود الشهرية",

  /* ── EXEC states ────────────────────────────────────── */
  "status.available": "متاح",
  "status.planning": "يجهّز الخطة",
  "status.working": "قيد التنفيذ",
  "status.waiting": "في الانتظار",
  "status.needs_approval": "يحتاج موافقتك",
  "status.blocked": "متعثر",
  "status.reviewing": "يراجع النتائج",
  "status.completed": "مكتمل",
  "status.failed": "فشل التنفيذ",
  "status.offline": "غير متصل",
  "status.legend": "كل حالة لها نص ورمز؛ لا يُعتمد على اللون وحده.",

  /* ── Task states ────────────────────────────────────── */
  "task.planned": "مخطَّط",
  "task.working": "قيد العمل",
  "task.waiting": "بانتظار المدخلات",
  "task.blocked": "موقوفة مؤقتًا",
  "task.review": "تحت المراجعة",
  "task.completed": "مكتملة ومتحقَّق منها",
  "task.failed": "فشلت",
  "task.cancelled": "ملغاة (تجريبي)",
  "task.label": "المهمة",

  /* ── Team ───────────────────────────────────────────── */
  "team.title": "من يوجّه إليهم EXEC العمل",
  "team.note": "المسؤوليات مثبَّتة، وأسماء الخمسة لم تُحسم بعد.",
  "team.exec": "التنفيذي",
  "team.systems": "الأنظمة والأتمتة",
  "team.creative": "الإبداع والمحتوى",
  "team.growth": "النمو والتسويق",
  "team.operations": "عمليات العملاء",
  "team.engineering": "هندسة المنتج",
  "team.exec.mandate": "يحدد النتيجة والخطة ومعيار القبول، ويراجع النتيجة.",
  "team.systems.mandate": "يربط الأدوات، ويشغّل الإجراءات المعتمدة، ويراقب التكاملات.",
  "team.creative.mandate": "يحوّل الاستراتيجية إلى أفكار ومحتوى وهوية بصرية.",
  "team.growth.mandate": "يختبر العروض والقنوات ويطوّر فرص النمو.",
  "team.operations.mandate": "ينظّم العملاء والمشاريع والتسليم.",
  "team.engineering.mandate": "يبني المنتج والكود، ويصلح ويختبر.",
  "team.active": "مشارك الآن",
  "team.idle": "غير مشارك",

  /* ── Conversation ───────────────────────────────────── */
  "conv.general": "محادثة عامة",
  "conv.task": "محادثة المهمة",
  "conv.general.note": "المحادثة العامة غير مرتبطة بأي مهمة.",
  "conv.task.note": "هذه المحادثة مرتبطة بـ{code}.",
  "conv.empty": "قل ما تريد أن يفعله NEXUP. EXEC يحدد النتيجة، ويقترح خطة، ويعيد إليك ما يحتاج قرارك.",
  "conv.from.exec": "EXEC",
  "conv.from.you": "أنت",
  "conv.msg.copy": "انسخ الرسالة",
  "conv.msg.copied": "تم النسخ",
  "conv.composer.placeholder":
    "وجّه EXEC… مثال: جهّز أسبوع محتوى لـNEXUP على X يجذب طلبات هوية بصرية، من غير نشر.",
  "conv.composer.send": "إرسال",
  "conv.composer.hint": "اكتب ما تريد إنجازه",
  "conv.composer.attach": "أضف ملفًا تجريبيًا",
  "conv.composer.voice": "الصوت — غير متاح",
  "conv.composer.note":
    "الرسائل الحرة تتلقى ردًا واحدًا من الموصل الوهمي المحلي. سيناريوهات Demo الصريحة تظل محلية وتتقدم فقط بإجراءاتك.",
  "conv.attachments": "المرفقات (تجريبي)",
  "conv.attachment.note": "مرفق تجريبي. لا يتم رفع أو قراءة أي شيء.",
  "conv.attachment.remove": "إزالة",
  "conv.attachment.imageName": "معاينة-تجريبية.png",
  "conv.attachment.docName": "موجز-تجريبي.pdf",
  "conv.demoReply":
    "هذه واجهة تجريبية: لا يُستدعى أي موديل ولا تُنشأ أي مهمة. افتح أدوات المعاينة لتشغيل سيناريو تجريبي خطوة بخطوة — وكل انتقال هناك يحتاج إجراءً صريحًا منك.",
  "conversation.testBadge": "رد اختباري — لا يوجد اتصال بنموذج حقيقي",
  "conversation.ephemeral": "الرسائل تُفقد عند تحديث الصفحة.",
  "conversation.pending": "في انتظار الرد الاختباري…",
  "conversation.error.invalidInput": "تعذّر إرسال الرسالة. المرجع: {requestId}",
  "conversation.error.unauthorized": "انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى. المرجع: {requestId}",
  "conversation.error.csrfRejected": "رُفض الطلب لأنه لم يأتِ من هذا التطبيق. المرجع: {requestId}",
  "conversation.error.messageTooLarge": "الرسالة تتجاوز الحد المسموح. المرجع: {requestId}",
  "conversation.error.connectorUnavailable": "الموصل الاختباري غير متاح. لم يُنفَّذ شيء. المرجع: {requestId}",
  "conversation.error.timeout": "انتهت مهلة الرد. لم يُنفَّذ شيء. المرجع: {requestId}",
  "conversation.error.internal": "فشل الموصل الاختباري. لم يُنفَّذ شيء. المرجع: {requestId}",
  "conversation.error.protocol": "أعاد الخادم ردًا غير صالح. لم يُعرض شيء. المرجع: {requestId}",
  "conversation.error.network": "تعذّر الوصول إلى الخادم. لم يُنفَّذ شيء. المرجع: {requestId}",
  "composer.demoNote":
    "لا موديل ولا runtime. الردود الحرة تأتي من الموصل الاختباري، وخطوات Demo المكتوبة تحتاج ضغطتك.",

  /* ── شاشة ما قبل المحادثة ───────────────────────────── */
  "empty.greeting": "إيه اللي نشتغل عليه يا {name}؟",
  "empty.demoNote": "وضع اختباري: الرسائل الحرة تصل إلى موصل وهمي محلي، ولا يعمل أي موديل أو إجراء للشركة.",
  "empty.suggest.review": "راجع وضع الشركة",
  "empty.suggest.plan": "خطّط لمشروع",
  "empty.suggest.prepare": "جهّز مهمة",
  "empty.suggest.script": "شغّل السيناريو التجريبي: {name}",

  /* ── عناصر الهيكل التي تظهر في هذه الصفحة فقط ───────── */
  "nav.collapse": "طيّ التنقل",
  "nav.expand": "توسيع التنقل",

  /* ── عام أو مرتبط بمهمة ─────────────────────────────── */
  "conv.scope.general": "عامة",

  /* ── ملخص تنفيذ واحد قابل للتوسيع ───────────────────── */
  "summary.panel": "تفاصيل التنفيذ",
  "summary.progress": "المرحلة {done} من {total}",
  "summary.open": "عرض مسار العمل",
  "summary.close": "إخفاء مسار العمل",
  "step.queued": "في الانتظار",
  "step.running": "قيد التنفيذ",
  "step.done": "مكتمل",
  "step.blocked": "متعثر",
  "summary.review": "عرض المراجعة",
  "summary.review.close": "إغلاق المراجعة",
  "summary.deeper": "الفريق والتبعيات",
  "conv.approvalLead": "هذا يحتاج قرارك",

  /* ── أدوات المعاينة، خارج التجربة عن قصد ────────────── */
  "tools.title": "أدوات المعاينة",
  "tools.note": "سيناريوهات العرض وشرح الحالات هنا، خارج المحادثة.",
  "tools.open": "افتح أدوات المعاينة",
  "menu.dev": "تطوير",
  "lab.title": "أدوات مراجعة EXEC",
  "lab.note": "سيناريوهات العرض، وشرح الحالات، ولوحات المرجع، وسجل التشغيل التجريبي. أداة مراجعة — وليست جزءًا من محادثة EXEC.",

  /* ── Panels / details ───────────────────────────────── */
  "panel.details": "التفاصيل",
  "panel.open": "إظهار التفاصيل",
  "panel.close": "إخفاء التفاصيل",
  "panel.team": "الفريق",
  "panel.timeline": "الخط الزمني",
  "panel.dependencies": "الاعتماديات",
  "panel.overview": "نظرة على التشغيل",
  "panel.history": "سجل تجريبي",
  "panel.corrections": "جولات التصحيح",
  "panel.attempts": "المحاولات",
  "panel.timeline.empty": "لا أحداث بعد. يظهر التقدم عند حدوث حدث تجريبي، وليس بمؤقّت.",
  "panel.dependencies.note": "تظهر فقط أثناء مراجعة الخطة.",
  "panel.causedByYou": "إجراؤك",
  "panel.causedByDemo": "تهيئة تجريبية",
  "panel.execState": "حالة EXEC",
  "panel.taskState": "حالة المهمة",
  "panel.stateSeparation": "حالة EXEC وحالة المهمة منفصلتان. انتهاء خطوة لا يُنهي المهمة.",

  /* ── Demo history ───────────────────────────────────── */
  "hist.brand": "أسبوع طلب الهوية — النسخة الأولى",
  "hist.brandVoice": "إرشادات صوت العلامة",
  "hist.gulf": "إطلاق الخليج — استلام الأصول",
  "hist.gulfOffer": "إطلاق الخليج — مراجعة العرض",
  "hist.retainer": "الاتفاق الشهري — المطابقة الشهرية",
  "hist.retainerAssets": "الاتفاق الشهري — تحديث الأصول",

  /* ── Reference assets ───────────────────────────────── */
  "refs.title": "الأصول المرجعية",
  "refs.note": "لوحات التصميم المعتمدة، تُعرض كصور مرجعية ثابتة. ليست نموذجًا ثلاثي الأبعاد، ولا متحركة، ولم يُعد رسمها هنا.",
  "refs.exec.alt": "لوحة مرجعية لشخصية EXEC: رأس فضي هندسي، شاشة وجه سوداء، عين زرقاء، جاكيت تقني فاتح وبنطلون رمادي.",
  "refs.exec.caption": "EXEC — لوحة الشخصية",
  "refs.team.alt": "لوحة فريق NEXUP AI Workforce بست شخصيات وتخصصاتها.",
  "refs.team.caption": "فريق الـAI — لوحة الفريق",

  /* ── Scenario picker ────────────────────────────────── */
  "scen.title": "السيناريوهات التجريبية",
  "scen.note":
    "كل سيناريو تشغيل مكتوب ومحدَّد سلفًا. الانتقال يتم بإجراء صريح — لا مؤقّت ولا تقدّم مصطنع.",
  "scen.start": "شغّل هذا السيناريو",
  "scen.restart": "شغّله مرة أخرى",
  "scen.running": "قيد التشغيل",
  "scen.launch_brief": "موجز إطلاق",
  "scen.launch_brief.summary": "محادثة تنفيذية قصيرة: اختر هدف الإطلاق، ثم راجع موجزًا تجريبيًا مختصرًا.",
  "scen.content_week": "أسبوع محتوى على X",
  "scen.content_week.summary": "التدفق الكامل: تحديد النطاق، الخطة، التفويض، المراجعة، ادعاء مكشوف، تصحيح، ثم نتيجة متحقَّق منها.",
  "scen.missing_inputs": "مدخلات ناقصة",
  "scen.missing_inputs.summary": "EXEC لا يكتب بدون مدخلات الهوية، ويحدد بالضبط ما ينقصه.",
  "scen.approval": "طلب موافقة",
  "scen.approval.summary": "التزام لا يملك EXEC سلطته، والمقايضة معروضة بوضوح.",
  "scen.blocked_dependency": "تعثر باعتماد خارجي",
  "scen.blocked_dependency.summary": "تشغيل متعثر مع ذكر السبب، وطريقتان صادقتان للخروج.",
  "scen.failure_cancel": "فشل وإلغاء تجريبي",
  "scen.failure_cancel.summary": "الوصول إلى سقف المحاولات؛ يفشل التشغيل، والإلغاء التجريبي يعيد EXEC إلى «متاح».",
  "scen.offline": "غير متصل",
  "scen.offline.summary": "EXEC غير قابل للوصول. الواجهة تقول ذلك بدل أن تتظاهر بالنشاط.",

  /* ── Timeline kinds ─────────────────────────────────── */
  "tl.agent": "وكيل",
  "tl.mission": "مهمة",
  "tl.approval": "موافقة",
  "tl.system": "نظام",
  "tl.error": "خطأ",
  "tl.human": "إنسان",

  /* ── Cards ──────────────────────────────────────────── */
  "card.brief": "الموجز",
  "card.plan": "الخطة",
  "card.plan.steps": "{count} خطوات",
  "card.plan.dependsOn": "يعتمد على {refs}",
  "card.plan.noDeps": "بلا اعتماد",
  "card.plan.owner": "المسؤول",
  "card.delegation": "تفويض",
  "card.delegation.deliverable": "المخرج",
  "card.delegation.authority": "الصلاحية",
  "card.delegation.due": "المتوقع",
  "card.gate": "موافقة مطلوبة",
  "card.gate.authority": "ما تصادق عليه",
  "card.gate.cost": "الحد الأقصى",
  "card.evidence": "الدليل",
  "card.evidence.claim": "الادعاء",
  "card.evidence.source": "المصدر",
  "card.evidence.supported": "موثَّق داخل هذا التشغيل",
  "card.evidence.unsupported": "لا مصدر داخل هذا التشغيل",
  "card.correction": "تصحيح",
  "card.correction.before": "قبل",
  "card.correction.after": "بعد",
  "card.correction.bound": "الحد",
  "card.verification": "التحقق",
  "card.verification.traceable": "مُتتبَّع إلى مصدر",
  "card.verification.untraceable": "غير قابل للتتبع",
  "card.result": "النتيجة",
  "card.result.verified": "متحقَّق منها",
  "card.result.title": "أسبوع المحتوى · نتيجة تجريبية",
  "card.result.description": "ملخص متحقَّق منه وجاهز للمراجعة لمخرجات السيناريو المكتوب.",
  "card.result.demo": "تجريبي",
  "card.result.preview": "معاينة",
  "card.result.edit": "تعديل تجريبي",
  "card.result.details": "التفاصيل والأدلة",
  "card.result.preview.note": "معاينة نصية داخل هذا العرض التجريبي — لم يُصدَّر ملف ولم يخرج شيء من الصفحة.",
  "card.result.noPublish": "لم يُنشر أي شيء",
  "card.inputs": "المدخلات المطلوبة",
  "card.inputs.blocks": "يعطّل: {what}",
  "card.attachment": "مرفق (تجريبي)",

  /* ── Short launch brief ────────────────────────────── */
  "s.launch.opener": "جهّز خطة إطلاق لـNEXUP.",
  "s.launch.task.title": "NEXUP — موجز الإطلاق",
  "s.launch.goal.msg": "ما الهدف الأساسي من الإطلاق؟",
  "s.launch.goal.leads": "عملاء محتملون مؤهلون",
  "s.launch.goal.awareness": "الوعي بالعلامة",
  "s.launch.brief.msg": "هذا موجز الإطلاق المختصر للمراجعة.",
  "s.launch.result.title": "موجز الإطلاق · نتيجة تجريبية",
  "s.launch.result.description": "موجز إطلاق مختصر وجاهز للمراجعة.",
  "s.launch.result.goal.label": "الهدف الأساسي",
  "s.launch.result.goal.leads": "عملاء محتملون مؤهلون",
  "s.launch.result.goal.awareness": "الوعي بالعلامة",
  "s.launch.result.audience.label": "الجمهور",
  "s.launch.result.audience.value": "صنّاع القرار الذين يقيّمون NEXUP",
  "s.launch.result.next.label": "الخطوة التالية",
  "s.launch.result.next.value": "مراجعة التموضع والجمهور وتسلسل الإطلاق",
  "s.launch.result.noPublish": "عرض تجريبي فقط — لم يُنشأ ملف ولم يُنشر شيء",

  /* ── Main scenario · content week ───────────────────── */
  "s.content.title": "أسبوع محتوى على X لـNEXUP",
  "s.content.opener":
    "جهّز أسبوع محتوى لـNEXUP على X، هدفه يجذب طلبات هوية بصرية، من غير نشر.",
  "s.content.task.title": "NEXUP — أسبوع محتوى على X",
  "s.content.brief.msg":
    "واضح. أحدد النطاق قبل أن يُكتب أي شيء. لو كانت النتيجة بالأسفل غير ما تقصده، صحّحها الآن — تغييرها لاحقًا يُعيد العمل الذي يقع تحتها.",
  "s.content.brief.goal.label": "النتيجة",
  "s.content.brief.goal.value": "طلبات هوية بصرية واردة من X",
  "s.content.brief.deliverables.label": "المخرجات",
  "s.content.brief.deliverables.value": "٧ مسودات، اتجاه بصري واحد، ومجموعة زوايا رسائل",
  "s.content.brief.success.label": "معيار النجاح",
  "s.content.brief.success.value": "طلبات مؤهَّلة، لا مجرد وصول",
  "s.content.brief.constraint.label": "القيد",
  "s.content.brief.constraint.value": "لا نشر في أي خطوة من هذا التشغيل",
  "s.content.plan.msg":
    "أربع خطوات، وبوابة مراجعة واحدة، وجولة تصحيح محدودة واحدة. الافتراضات صريحة: الجمهور يعرف أصلًا أنه يحتاج هوية، والعرض نطاق ثابت لهوية بصرية.",
  "s.content.plan.step.angles": "زوايا الرسائل على X",
  "s.content.plan.step.visual": "الاتجاه البصري",
  "s.content.plan.step.drafts": "مجموعة المسودات السبع",
  "s.content.plan.step.verify": "التحقق مقابل الموجز",
  "s.content.plan.revised.msg":
    "تمام. أبقيت الخطة على أربع خطوات وغيّرت ما طلبته فقط. البوابة تبقى مكانها لأن عمل المسودات يقع تحتها.",
  "s.content.gate.title": "اعتماد الخطة",
  "s.content.gate.body":
    "Growth وCreative يبدآن بعد اعتمادك فقط. لا أبدأهما على خطة غير معتمدة، ولا أنشر أي شيء في الحالتين.",
  "s.content.gate.authority": "اعتماد الخطة وعمل المسودات الذي يقع تحتها",
  "s.content.del.growth.deliverable": "زوايا رسائل على X مرتبطة بعرض الهوية البصرية",
  "s.content.del.growth.authority": "اقتراح فقط — لا نشر ولا إنفاق",
  "s.content.del.growth.due": "قبل بدء المسودات",
  "s.content.del.creative.deliverable": "اتجاه بصري واحد: التكوين والخط واللون وأمثلة",
  "s.content.del.creative.authority": "اقتراح فقط — بلا شراء أصول خارجية",
  "s.content.del.creative.due": "قبل بدء المسودات",
  "s.content.delegate.msg":
    "أوجّه العمل الآن. Growth مسؤول عن زوايا الرسائل وCreative عن الاتجاه البصري. يعملان بالتوازي لأن كلًا منهما لا يعتمد على الآخر، والمراجعة مسؤوليتي.",
  "s.content.await.msg":
    "التكليفان صادران. أنتظر مدخلاتهما قبل بدء أي مسودة — لن أكتب مسودات بزوايا ناقصة.",
  "s.content.await.ev.growth": "Growth سلّم مجموعة زوايا الرسائل",
  "s.content.await.ev.creative": "Creative سلّم الاتجاه البصري",
  "s.content.draft.msg":
    "المدخلات وصلت، فيبدأ عمل المسودات. تبقى المسودات داخل هذا التشغيل: لا يخرج أي منشور من هذه البيئة في أي خطوة.",
  "s.content.draft.attach": "معاينة-المسودات.png",
  "s.content.review.msg": "أراجع المسودات مقابل الموجز ومقابل الأدلة المتاحة عندي.",
  "s.content.review.ev.start": "بدأت المراجعة مقابل الموجز ومعيار نجاحه",
  "s.content.find.msg":
    "وجدت ادعاءً واحدًا غير موثَّق. المسودة الثالثة تقول إن العمل «ضاعف التفاعل» لعميل مشابه. لا شيء في هذا التشغيل يدعم هذا الرقم: ليس في الموجز، ولا في زوايا الرسائل، ولا في الاتجاه البصري. أوقفت المسودة. ولأن الادعاء عن نتيجة، لن أخففه بالتخمين — إما يوجد مصدر ويدخل، أو يُعاد كتابة السطر.",
  "s.content.find.reason": "مسودة واحدة تحمل رقمًا بلا مصدر داخل هذا التشغيل.",
  "s.content.ev.claim": "المسودة ٣: «ضاعف التفاعل لعميل مشابه»",
  "s.content.ev.source": "لا مصدر داخل هذا التشغيل — ليس في الموجز ولا الزوايا ولا الاتجاه",
  "s.content.correct.msg":
    "جولة تصحيح واحدة من واحدة. الرقم خرج. السطر الآن يوضّح ما يغيّره الاتجاه البصري فعلًا، وهذا أستطيع تتبعه. جولة أخرى تعني أن الموجز خطأ، لا المسودة — لذلك هذه الجولة الوحيدة التي أصرفها.",
  "s.content.corr.before": "ضاعف التفاعل لعميل مشابه",
  "s.content.corr.after": "هوية واحدة واضحة، مطبَّقة بثبات على الملف والحملة",
  "s.content.corr.bound": "جولة واحدة فقط",
  "s.content.verify.msg": "أعيد التحقق على المجموعة المصحّحة.",
  "s.content.verify.item.brief": "كل ادعاء متتبَّع إلى الموجز أو إلى مدخل سُلِّم في هذا التشغيل",
  "s.content.verify.item.deliverables": "المخرجات الأربعة موجودة ومطابقة للموجز",
  "s.content.verify.item.noPublish": "لم تُشغَّل أو تُبلَغ أي خطوة نشر",
  "s.content.verify.item.cancel": "لم يُنشأ أي إنفاق أو شراء خارجي",
  "s.content.result.msg":
    "النتيجة متحقَّق منها، فالتشغيل مكتمل. راجعت النتيجة مقابل معيار النجاح الذي حددته، لا مقابل حجم العمل المنتَج.",
  "s.content.result.drafts.label": "المسودات",
  "s.content.result.drafts.value": "٧، كلها قابلة للتتبع",
  "s.content.result.visual.label": "الاتجاه البصري",
  "s.content.result.visual.value": "١، مُسلَّم",
  "s.content.result.angles.label": "مجموعة زوايا الرسائل",
  "s.content.result.angles.value": "١، مُسلَّمة",
  "s.content.result.claims.label": "ادعاءات غير موثَّقة",
  "s.content.result.claims.value": "لا شيء متبقٍ — واحد مكشوف ومصحَّح",
  "s.content.result.next.label": "الحالة",
  "s.content.result.next.value": "جاهز لنشره عندما تقرر أنت",
  "s.content.choice.showPlan": "اعرض الخطة",
  "s.content.choice.draft": "ابدأ كتابة المسودات",
  "s.content.choice.approve": "اعتمد الخطة",
  "s.content.choice.requestChange": "اطلب تعديلًا",
  "s.content.choice.run": "ابدأ التنفيذ",
  "s.content.choice.review": "راجع المسودات",
  "s.content.choice.inspect": "افحص الدليل",
  "s.content.choice.correct": "صحّح الادعاء",
  "s.content.choice.reverify": "أعد التحقق",
  "s.content.choice.result": "اعرض النتيجة",
  "s.content.ev.planApproved": "اعتُمدت الخطة وأُذن بعمل المسودات",
  "s.content.ev.changeRequested": "طُلب تعديل على الخطة",
  "s.content.ev.routed": "Growth وCreative بدآ بالتوازي",
  "s.content.ev.draftStart": "بدأ عمل المسودات على مدخلات مُسلَّمة",
  "s.content.ev.found": "اكتُشف ادعاء غير موثَّق وأُوقفت المسودة",
  "s.content.ev.corrected": "صُحّح الادعاء في جولة واحدة محدودة",
  "s.content.ev.verified": "النتيجة متحقَّق منها مقابل الموجز",
  "s.content.ev.completed": "اكتمل التشغيل ولم يُنشر أي شيء",

  /* ── Missing inputs ─────────────────────────────────── */
  "s.inputs.title": "أصول الهوية ناقصة",
  "s.inputs.opener": "حوّل الاتجاه البصري إلى أسبوع محتوى كامل لأطلس القابضة.",
  "s.inputs.task.title": "أطلس القابضة — أسبوع محتوى",
  "s.inputs.msg":
    "لا أستطيع البدء في هذا. ثلاثة مدخلات ناقصة، وكل واحد منها يغيّر المخرج لا أنه يكمله فقط.",
  "s.inputs.item.logo": "الشعار الأساسي بصيغة متجهية",
  "s.inputs.item.palette": "قيم الألوان المعتمدة",
  "s.inputs.item.voice": "مثالان من كتابة العلامة نفسها",
  "s.inputs.blocks": "متعطل: لا يمكن بدء المسودات، ولن أخترع أصول هوية",
  "s.inputs.choice.provide": "أضف المدخلات (تجريبي)",
  "s.inputs.received.msg": "المدخلات وصلت. الخطة كما هي على شكل أسبوع المحتوى المعتاد، فلا أعيد فتحها.",
  "s.inputs.done.msg": "أُنتجت المخرجات على الأصول المورَّدة. لم يُنشر أي شيء.",
  "s.inputs.ev.provided": "وُرِّدت ثلاثة مدخلات هوية في هذا التشغيل",
  "s.inputs.result.label": "الحالة",
  "s.inputs.result.value": "مسودات جاهزة على مدخلات هوية حقيقية",

  /* ── Approval ───────────────────────────────────────── */
  "s.approval.title": "التزام خارج سلطة EXEC",
  "s.approval.opener": "ادفع إطلاق الخليج بقوة أكبر هذا الشهر.",
  "s.approval.task.title": "إطلاق الخليج — وصول مدفوع",
  "s.approval.msg":
    "أقدر على هذا، لكن ليس بسلطتي وحدي. فيه التزام بإنفاق، فيتوقف هنا حتى تقرر.",
  "s.approval.gate.title": "صادق على الوصول المدفوع لإطلاق الخليج",
  "s.approval.gate.body":
    "الوصول المتوقع أقل من الحد الأقصى بالأسفل. لا أستطيع إثبات معدل التحويل بعد، فاعتبر العائد افتراضًا لا توقّعًا.",
  "s.approval.gate.authority": "إنفاق حتى الحد الأقصى، وتوقف عنده",
  "s.approval.choice.approve": "اعتمد الإنفاق",
  "s.approval.choice.reject": "ارفض",
  "s.approval.approved.msg":
    "معتمد داخل الحد الأقصى. أتابعه كإنفاق محدود وسأتوقف عند الحد بدل أن أعود لطلب المزيد.",
  "s.approval.rejected.msg":
    "مرفوض. لن أشغّله، وأسجّل القرار مع سببه حتى لا يُعاد طرحه بالخطأ.",
  "s.approval.blocked.why": "الالتزام فوق سلطة EXEC، فيحتاج قرارك.",
  "s.approval.ev.approved": "أُذن بالإنفاق مع حد أقصى صارم",
  "s.approval.ev.rejected": "رُفض الإنفاق من المالك",
  "s.approval.failed.why": "توقف التنفيذ: الموافقة المطلوبة رُفضت.",
  "s.approval.running.msg": "التشغيل داخل الحد المعتمد. لا يمكن صرف شيء فوقه.",
  "s.approval.result.label": "الإنفاق",
  "s.approval.result.value": "داخل الحد المعتمد",

  /* ── Blocked on a dependency ────────────────────────── */
  "s.blocked.title": "تعثر باعتماد خارجي",
  "s.blocked.opener": "أنهِ عرض الدفعة الشهرية لديون ستوديو.",
  "s.blocked.task.title": "ديون ستوديو — عرض الدفعة",
  "s.blocked.msg":
    "ديون ستوديو لم ترجع الأرقام المعتمدة. أنا متعطل: لن أنشر أرقامًا لم يؤكدها العميل، ولن أستخدم أرقام الربع الماضي كأنها أرقام هذا الربع.",
  "s.blocked.reason":
    "بانتظار تأكيد ديون ستوديو للأرقام. لا أستطيع المتابعة بدونها ولن أضع تخمينًا بدلًا منها.",
  "s.blocked.choice.substitute": "تابع ببديل مُعلَّم",
  "s.blocked.choice.hold": "أبقِه موقوفًا",
  "s.blocked.substituted.msg":
    "أتابع ببديل مُعلَّم: كل رقم غير مؤكد مُعلَّم داخل العرض نفسه وفي سجل هذا التشغيل. لو رآه العميل، يرى بالضبط ما لم يُؤكَّد.",
  "s.blocked.held.msg": "موقوف. لا يُنتَج شيء ولا يتحرك شيء حتى تصل الأرقام.",
  "s.blocked.held.task": "موقوفة حتى يؤكد العميل الأرقام",
  "s.blocked.ev.substituted": "متابعة مع تعليم الأرقام غير المؤكدة",
  "s.blocked.ev.held": "بقي موقوفًا؛ لم يُنتج أي مخرج",
  "s.blocked.done.msg": "أُنتج العرض مع تعليم الأرقام غير المؤكدة. لم يُرسل شيء إلى العميل.",
  "s.blocked.result.label": "أرقام غير مؤكدة",
  "s.blocked.result.value": "مُعلَّمة داخل العرض وفي السجل",

  /* ── Failure and cancellation ───────────────────────── */
  "s.fail.title": "فشل وإلغاء تجريبي",
  "s.fail.opener": "طابِق دفتر تسليم سبتمبر.",
  "s.fail.task.title": "مطابقة تسليم سبتمبر",
  "s.fail.msg":
    "شغّلت هذه المطابقة ولن تُقفل. الدفتر وسجل التسليم مختلفان في أربعة قيود، والفرق ليس فرق تقريب — إنه سجل مفقود.",
  "s.fail.reason":
    "فشلت المطابقة: أربعة قيود متخالفة والسجل المصدر مفقود. لن أعدّل دفترًا ليوازن.",
  "s.fail.choice.retry": "أعد المحاولة مرة",
  "s.fail.choice.cancel": "ألغِ هذا التشغيل التجريبي",
  "s.fail.retry.msg":
    "أعدت المحاولة. نفس القيود الأربعة، ونفس السجلات المفقودة. هذا هو السقف: محاولة أخرى تصرف جهدًا بلا تغيير في الجواب، فأتوقف.",
  "s.fail.cancelled.msg":
    "أُلغي بأمرك. أنا متاح مرة أخرى، والمهمة مغلقة كملغاة — التشغيل لم يكتمل ولن أسمّيه نجاحًا.",
  "s.fail.ev.failed": "فشلت المطابقة وأُوقف التشغيل",
  "s.fail.ev.ceiling": "وُصل إلى سقف المحاولات؛ ورُفضت محاولات إضافية",
  "s.fail.ev.cancelled": "أُلغى التشغيل التجريبي بواسطة المالك",
  "s.fail.result.label": "الدفتر",
  "s.fail.result.value": "غير مطابَق — لم يُطبَّق أي تعديل",
  "s.fail.retryUsed": "استُخدمت محاولة واحدة، ووُصل السقف",

  /* ── Offline ────────────────────────────────────────── */
  "s.offline.title": "EXEC غير قابل للوصول",
  "s.offline.opener": "جهّز خطة الأسبوع القادم.",
  "s.offline.task.title": "خطة الأسبوع القادم",
  "s.offline.msg":
    "لست متصلًا، فلا أستطيع التخطيط ولا التفويض. أفضّل أن أقول ذلك بدل أن أعرض عليك عملًا لا يحدث.",
  "s.offline.reason": "الـruntime الذي يشغّل EXEC غير قابل للوصول، فلا يمكن بدء مهمة أو متابعتها.",
  "s.offline.hint": "لا شيء في الانتظار، ولن يبدأ شيء من تلقاء نفسه.",

  /* ── The header: history, identity, context, workspace, one menu ────── */
  "head.history": "سجل المحادثات",
  "head.workspace": "مساحة العمل",
  "head.more": "خيارات أخرى",
  "head.agent": "تغيير الموظف",
  "head.agent.only": "EXEC هو الموظف الوحيد في هذا الإصدار.",
  "head.agent.later":
    "بقية الفريق يصبح قابلًا للاختيار هنا لاحقًا. لا يوجد اليوم موظف آخر ولا اسم ولا دور، فلا يُعرض أي منها.",

  "menu.options": "الخيارات",
  "menu.new": "محادثة جديدة",
  "menu.voice": "محادثة صوتية",
  "menu.future": "لم تُبنَ بعد",
  "menu.console": "لوحة EXEC التوطيرية",
  "menu.lab": "أدوات المعاينة والسيناريوهات",
  "menu.reset": "إعادة تعيين التشغيل المفتوح",
  "menu.navCollapse": "طيّ التنقل",
  "menu.navExpand": "توسيع التنقل",
  "menu.language": "اللغة",

  /* ── اللوحة الواحدة ─────────────────────────────────────────── */
  "side.workspace": "مساحة العمل",
  "side.history": "سجل المحادثات",
  "side.close": "إغلاق اللوحة",
  "side.work": "العمل",
  "side.session": "الجلسة",
  "side.settings": "إعدادات EXEC",
  "side.plan": "الخطة",
  "side.progress": "التقدم",
  "side.outputs": "المخرجات",
  "side.evidence": "الأدلة",
  "side.noTask":
    "لا توجد مهمة مفتوحة في هذه المحادثة. عندما تفتح واحدة، تظهر هنا خطتها وتقدمها ومخرجاتها وأدلتها.",
  "side.progress.value": "{done} من {total} خطوات في سيناريو هذا التشغيل",
  "side.outputs.none": "لا مخرجات بعد.",
  "side.evidence.none": "لا أدلة مسجلة بعد.",
  "side.evidence.supported": "قابلة للتتبع داخل هذا التشغيل",
  "side.evidence.unsupported": "غير قابلة للتتبع",
  "side.conversation": "هذه المحادثة",
  "side.conversation.value": "{count} سطرًا · {tab}",
  "side.scope": "النطاق",
  "side.participants": "المشاركون",
  "side.participants.value": "أنت وEXEC. المكالمة بمشاركين محددين لم تُبنَ بعد.",
  "side.call": "المكالمة",
  "side.call.note":
    "المكالمة بمشاركين وسجل وقرارات لم تُبنَ بعد. لا يُطلب إذن الميكروفون ولا يُسجّل شيء.",
  "side.identity": "الهوية",
  "side.identity.value": "العقل التنفيذي · يرفع مباشرةً إلى المؤسس",
  "side.capabilities": "القدرات",
  "side.capabilities.value":
    "التخطيط والتفويض والمراجعة والتقرير. المهارات والأدوات غير موصولة في هذا الإصدار.",
  "side.memory": "الذاكرة",
  "side.memory.value":
    "لا يوجد مخزن ذاكرة موصول. لا شيء يُحفظ بعد مغادرة الصفحة.",
  "side.connections": "الاتصالات",
  "side.connections.value": "لا مزود ولا موديل ولا runtime موصول في هذا الإصدار.",
  "side.settings.note":
    "معروضة للمراجعة فقط. لا يوجد مفتاح تفعيل ولا مفتاح API ولا اتصال خلف أي منها بعد.",
  "side.view": "افتح لوحة مساحة العمل",

  /* ── سجل المحادثات ──────────────────────────────────────────── */
  "history.new": "محادثة جديدة",
  "history.open": "مفتوحة الآن",
  "history.lines": "{count} سطرًا",
  "history.task": "مهمة",
  "history.general": "عامة",
  "history.empty": "لا توجد محادثة موقوفة بعد. ابدأ محادثة جديدة ليُوقف الحالية هنا.",
  "history.unfinished": "تشغيل غير مكتمل",
  "history.isolation":
    "السجل محفوظ داخل النطاق الحالي فقط. تغيير النطاق يمسحه، فلا يمكن قراءة شيء من عميل داخل نطاق عميل آخر.",
  "history.restore": "افتح هذه المحادثة",

  /* ── ما فعله التغيير، مقولًا بوضوح ──────────────────────────── */
  "notice.parked":
    "المحادثة المفتوحة أُوقفت في سجل المحادثات ومعها تشغيلها. لم يُحذف شيء.",
  "notice.draftKept": "مسودتك محفوظة.",
  "notice.attachmentsKept": "المرفقات المُجهزة محفوظة.",
  "notice.script":
    "بدأ سيناريو تجريبي مكتوب. يتقدم خطوة واحدة في كل مرة، وفقط عندما تختار أنت الخطوة التالية.",
  "notice.scriptBusy":
    "هناك تشغيل مفتوح بالفعل، فلم يُرسل شيء. أكمله أو أعد ضبطه من الأدوات بالأسفل قبل تشغيل سيناريو آخر.",
  "notice.scopeCleared":
    "تغيّر النطاق. أُغلقت المهمة المفتوحة ومسحت هذه المحادثة وسجل النطاق السابق، فلا شيء من النطاق السابق ينتقل معك.",
  "notice.dismiss": "إخفاء",

  /* ── أدوات المحرر ───────────────────────────────────────────── */
  "composer.attach": "أضف مرفقًا",
  "composer.attach.file": "ملف",
  "composer.attach.image": "صورة",
  "composer.attach.local": "اختيار محلي (تجريبي)",
  "composer.attach.note":
    "في هذا العرض يمثل الاسم ومعاينة بسيطة الملف: لا يُقرأ شيء ولا يُرفع ولا يُحلَّل، وأي مسار يبقى على جهازك.",
  "composer.dictate": "إملاء",
  "composer.dictate.note": "لم يُبنَ بعد. لا يُسجَّل شيء ولا يُطلب إذن الميكروفون.",
  "composer.send.note": "Enter يرسل · Shift+Enter سطر جديد",

  /* ── صف الأدوات داخل الـcomposer ─────────────────────────────── */
  "composer.tools": "أدوات الكتابة",
  "composer.agent": "من ينفّذ هذا",
  "composer.agent.current": "EXEC — الوكيل في هذه المحادثة",
  "composer.brain": "العقل",
  "composer.brain.none": "غير موصول",
  "composer.brain.note": "لا يوجد موديل أو مزوّد موصول. الرسائل الحرة تستخدم الموصل الوهمي المحلي على نفس الأصل، والسيناريوهات الصريحة تظل محلية.",
  "composer.send.tip": "إرسال · Enter",
  "composer.stop": "أوقف المهمة",
  "composer.stop.note": "يوقف التشغيل عند هذه الخطوة ويعلّم المهمة كملغاة. ما تم إنجازه يبقى مقروءًا.",
  "menu.effects.off": "تقليل المؤثرات",
  "menu.effects.on": "تقليل المؤثرات: مُفعَّل",
  "menu.effects.note": "يوقف الزجاج وحركة المؤشر. التكوين والنص وكل ضابط يبقون كما هم.",
  "menu.preferences": "الحساب والتفضيلات",
  "menu.review": "المراجعة والتطوير",
  "menu.reviewNote": "سيناريوهات مبرمجة ومسارات مراجعة، وليست قدرات EXEC اليومية.",
  "notice.effects": "تم تغيير إعداد المؤثرات. لم تُمس أي مهمة أو رسالة أو مسودة.",

  "scroll.newest": "رجوع إلى أحدث رسالة",
  "card.attachment.local": "بديل عن ملف اخترته. لم يُرفع ولم يُحلَّل.",

  "nav.aria": "تنقل EXEC — المحادثة والجلسات والأدوات",
  "nav.sessions": "الجلسات",
  "nav.tools": "الأدوات",
  "nav.plugins": "الإضافات",
  "nav.chat": "المحادثة",
  "nav.recent": "أحدث الجلسات",
  "nav.untitledSession": "محادثة جديدة",
  "nav.newSession": "جلسة جديدة",
  "nav.sessionSearch": "ابحث في المحادثات",
  "nav.sessionNoResults": "لا توجد محادثات تطابق البحث.",
  "nav.account": "حساب Demo",
  "nav.accountDemo": "سعيد · Demo",
  "nav.appearance": "المظهر",
  "nav.appearanceDark": "داكن",
  "nav.memoryOnly": "جلسة مؤقتة",
  "nav.settings": "الإعدادات",
  "nav.settingsUnavailable": "الإعدادات — غير متاحة",
  "nav.toolsLead": "ما يوصله هذا الإصدار فعلًا، وما لا يوصله عن قصد.",
  "nav.toolsNone": "لا توجد أداة أو موديل أو مزوّد موصول. المفعّل فقط هو موصل المحادثة الوهمي المحلي للردود الاختبارية.",

  "live.open": "فتح مساحة العمل",
  "live.close": "إغلاق مساحة العمل",
  "live.title": "مساحة العمل",
  "live.hint": "النشاط والمعاينة والمخرجات بجانب المحادثة.",
  "live.none": "لا مهمة مفتوحة، فلا عمل مباشر لعرضه. ابدأ مهمة لتظهر خطواتها وتقدّمها وتبعياتها هنا.",
  "live.demo": "نشاط تجريبي — لا موديل ولا مشغّل يعمل خلف هذا.",

  "workspace.title": "مساحة العمل",
  "workspace.activity": "النشاط",
  "workspace.preview": "المعاينة",
  "workspace.outputs": "المخرجات",
  "workspace.back": "العودة إلى المحادثة",
  "workspace.preview.empty": "لا يوجد شيء متاح للمعاينة بعد.",
  "workspace.outputs.empty": "لم يُنشأ مخرج تجريبي في هذه المحادثة.",
  "plugins.title": "الأنظمة الخارجية",
  "plugins.lead": "الأنظمة المؤكدة ووصول EXEC الحالي إليها. لا يُخزَّن أي مفتاح في المتصفح.",
  "plugins.connectedLocal": "متصل محليًا",
  "plugins.notConnected": "غير متصل",
  "plugins.access": "الوصول",
  "plugins.execApi.name": "واجهة محادثة EXEC",
  "plugins.execApi.detail": "مسار اختباري على نفس الأصل تستخدمه المحادثة الحرة في نسخة التكامل.",
  "plugins.execApi.access": "رسالة واحدة ورد اصطناعي واحد",
  "plugins.dummy.name": "الموصل الوهمي دون اتصال",
  "plugins.dummy.detail": "يعيد ردًا اختباريًا مضبوطًا، وليس نموذجًا لغويًا.",
  "plugins.dummy.access": "للاختبار فقط، بلا أدوات",
  "plugins.r2.name": "تخزين إيصالات Cloudflare R2",
  "plugins.r2.detail": "قدرة على الخادم في المشروع، ولا يوجد ربط لها بواجهة EXEC.",
  "plugins.r2.access": "لا وصول من EXEC",
  "plugins.provider.name": "مزوّد نموذج خارجي",
  "plugins.provider.detail": "لا يوجد مزوّد متصل في نسخة التكامل هذه.",
  "plugins.provider.access": "لا يوجد",

  "composer.model": "الموديل",
};

/* ═══════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════ */

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en: EN, ar: AR };

export type MessageVars = Record<string, string | number>;

/**
 * Renders a message. `{name}` placeholders are replaced from `vars`.
 * Missing keys are impossible by type, so the fallback exists only for the
 * benefit of callers holding an untyped string.
 */
export function t(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const template: string | undefined = DICTIONARIES[locale][key] ?? EN[key];
  if (template === undefined) return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Latin digits in BOTH languages, on purpose: a technical surface with mixed
 * Arabic/Latin content and code-like identifiers (MIS-2041, 7 drafts, 18%) is
 * far more legible with one numeral system than with two.
 */
const NUMBER_FORMAT: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat("ar-u-nu-latn", { numberingSystem: "latn" }),
  en: new Intl.NumberFormat("en"),
};

export function formatNumber(locale: Locale, value: number): string {
  return NUMBER_FORMAT[locale].format(value);
}

/**
 * Wrap user- or data-derived text so it cannot reorder the surrounding
 * sentence: first-strong isolate (U+2068) … pop directional isolate (U+2069).
 * Combined with `unicode-bidi: plaintext` in CSS, this is what makes mixed
 * Arabic + Latin content render correctly in both directions.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

export const DICTIONARY_KEYS = Object.keys(EN) as MessageKey[];
export { EN as EN_DICTIONARY, AR as AR_DICTIONARY };
