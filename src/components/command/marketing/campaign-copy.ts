/**
 * NEXUP COMMAND — MARKETING ROOM · bilingual copy
 * ────────────────────────────────────────────────────────────────────────────
 * The room's own words, in both languages, in one marketing-owned file.
 *
 * WHY NOT `i18n/messages.ts`: this pass is scoped to the marketing room, and
 * that dictionary is a shared Product file owned by the shell work. Keeping the
 * room's copy here means the room can ship without editing a file another
 * builder is changing — and it still gets the same guarantee, because `ar` is
 * typed as `typeof en`, so a missing Arabic line is a compile error.
 *
 * Arabic is written first as the reference reading and then mirrored into
 * English, not the other way round. Figures stay Western in both languages
 * (280, 7, 5), and identifiers (Salla, Zid, X, NEXUP) are not translated.
 */

import type { Locale } from "../i18n/locale";
import type { RoomStep, SlotId, StationVisualState, TeamRoleId } from "./campaign-model";

const en = {
  breadcrumbRoot: "Leadership",
  breadcrumbHere: "Marketing & sales",
  breadcrumbAria: "Location in Command",
  kicker: "Marketing room",
  title: "Marketing room",
  subtitle:
    "One campaign, worked in place: the brief, the draft, the approval and the scheduling request.",
  demoBadge: "Demo preview",
  reset: "Reset the demo",
  resetHint: "Returns the campaign to its first state",
  campaignLabel: "Active project",
  campaignName: "Salla & Zid store design campaign",
  campaignMeta: "Client work · 21 days · 30 store packages",

  decisions: {
    title: "Your decisions",
    subtitle: "One decision moves this campaign forward.",
    aria: "Your decisions for this campaign",
    missionLabel: "Selected mission",
    mission: "Salla & Zid store design campaign",
    ownerLabel: "Owner",
    nextLabel: "Next step",
    review: "Review the draft",
    reviewHint: "Opens the publish review station",
    manual: "Finish it manually",
    manualHint: "Opens the content draft to edit by hand",
  },

  stationsAria: "Campaign stations",
  stations: {
    strategy: {
      name: "Strategy",
      role: "Strategy agent",
      hint: "Brief, audience, offer",
      open: "Open the strategy station",
    },
    content: {
      name: "Content",
      role: "Content agent",
      hint: "Draft the X post",
      open: "Open the content station",
    },
    publish: {
      name: "Publish review",
      role: "Publishing agent",
      hint: "Approve, slot, request",
      open: "Open the publish review station",
    },
  },

  states: {
    done: "Done",
    active: "In progress",
    waiting: "Waiting",
    attention: "Needs you",
  },

  analysis: {
    label: "Analysis",
    brief: "First read: the outcome is measurable, the audience is narrow, and no price is claimed.",
    draft: "First read: the hook names both platforms, the promise has a date, and the draft is inside the limit.",
    /* First pass: nothing has been approved yet, so nothing has changed. */
    approve:
      "The draft is ready for review. Nothing is scheduled until this exact version is approved.",
    /* Only reachable after an approved version was edited. */
    stale: "The text changed after approval, so the approval has to be renewed before scheduling.",
    schedule: "Draft approved. Choose a slot, then send the request to the local demo connector.",
    scheduled: "The demo connector accepted the schedule. Nothing was published on X.",
  },

  stepNames: {
    brief: "Approve the campaign brief",
    draft: "Write the X draft by hand",
    approve: "Review and approve this version",
    schedule: "Choose a slot and request scheduling",
    scheduled: "Scheduling accepted by the demo connector",
  } satisfies Record<RoomStep, string>,

  work: {
    tabsAria: "Campaign stations",
    panelAria: "Campaign work panel",
    stepLabel: "Owned by {role}",
  },

  strategy: {
    title: "Strategy",
    lead: "The brief this campaign is judged against.",
    approve: "Approve the brief",
    approved: "Brief approved",
    locked: "The draft and the review unlock once the brief is approved.",
    approvedNote: "The content agent may now finish the draft.",
    fields: [
      { label: "Outcome", value: "30 store design requests in 21 days" },
      { label: "Audience", value: "Early Salla and Zid merchants: under a year old, 5–20 products" },
      { label: "Offer", value: "Storefront design ready in 7 days, plus a conversion review" },
      { label: "Channels", value: "X (one post), then follow-up on WhatsApp Business" },
      { label: "Guardrails", value: "No prices, no unverified performance numbers, NEXUP identity only" },
      { label: "Acceptance", value: "An approved post of 280 characters or fewer, with a chosen slot" },
    ],
  },

  content: {
    title: "Content · X post",
    lead: "Edit the draft by hand. Any change after approval sends it back for approval.",
    draftLabel: "X draft",
    counter: "{count} / 280",
    overLimit: "Over the X limit — shorten it before approving",
    generate: "Draft another version",
    seedDraft:
      "Your Salla or Zid store deserves a storefront that sells before it explains. We design it in seven days: product page, cart and offers page, plus a conversion review after handover. Five stores this month — send your store link.",
    alternateDraft:
      "On Salla or Zid, the storefront is your first salesperson. We design it in seven days: a clear product page, a fast cart and an offers page, then a conversion review. Five places this month — send your store link.",
    previewLabel: "How it reads",
    saveHint: "Edits live in this tab only and reset when the page reloads.",
    editedTag: "Edited by hand",
    approvedTag: "Approved text",
  },

  publish: {
    title: "Publish review",
    lead: "Approve this exact version, choose a slot, then request scheduling.",
    version: "Version {version}",
    approvalLabel: "Approval",
    approvalNone: "Not approved yet",
    approvalApproved: "Approved",
    approvalStale: "Approval expired — re-approve",
    approve: "Approve this version",
    reapprove: "Re-approve this version",
    approvalLocked: "Approve the brief first, then this version.",
    approvalTooLong: "The draft is over 280 characters, so it cannot be approved.",
    slotLabel: "Schedule slot",
    slotAria: "Choose a scheduling slot",
    slots: {
      "today-evening": "Today · 6:00 PM",
      "tomorrow-morning": "Tomorrow · 9:30 AM",
      "thursday-night": "Thursday · 9:00 PM · demo refusal",
    } satisfies Record<SlotId, string>,
    request: "Request scheduling",
    retry: "Retry the request",
    requesting: "Sending the request…",
    connectorLabel: "Connector",
    connectorNote:
      "A replaceable seam: no account, no credentials, no network call. Swap it for a real connector to go live.",
    publishLabel: "Publication",
    publishNever: "Not published. An accepted schedule is a request, not a publication.",
    publishAfterAccept:
      "Scheduling accepted for {slot}. The post is still not published on X.",
    historyLabel: "Requests in this session",
    historyEmpty: "No request sent in this session yet.",
    successTitle: "Scheduling accepted",
    successBody: "Receipt {receipt}. Simulated — nothing was sent to X.",
    failureTitle: "The demo connector refused the request",
    failureBody: "{message} ({code})",
    duplicateTitle: "Already requested",
    duplicateBody:
      "This exact text and slot were already submitted in this session. Nothing was sent again.",
    blockedTitle: "The request was not sent",
    blocked: {
      brief: "Approve the brief first.",
      approval: "This version needs approval before it can be scheduled.",
      slot: "Choose a schedule slot first.",
      empty: "The draft is empty.",
      limit: "The post is over 280 characters.",
    } satisfies Record<"brief" | "approval" | "slot" | "empty" | "limit", string>,
    requestStatus: {
      pending: "Pending",
      accepted: "Accepted",
      failed: "Refused",
    } satisfies Record<"pending" | "accepted" | "failed", string>,
    attempt: "attempt {attempt}",
  },

  team: {
    title: "Department team",
    subtitle: "Who works on this campaign, and who owns the current step.",
    aria: "The campaign team",
    ownerTag: "Step owner",
    statusWords: {
      working: "Working",
      available: "Available",
      waiting: "Waiting",
    } satisfies Record<"working" | "available" | "waiting", string>,
    members: {
      manager: { name: "Marketing manager", role: "Department lead" },
      strategy: { name: "Strategy agent", role: "Brief and audience" },
      content: { name: "Content agent", role: "Draft and revisions" },
      publish: { name: "Publishing agent", role: "Approval and scheduling" },
    } satisfies Record<TeamRoleId, { name: string; role: string }>,
  },

  notes: {
    title: "What this room is",
    local: "Every value on this page is local demo state, computed in the browser.",
    fixedCampaign:
      "One campaign is wired into this pass and the room always opens on it; creating or switching campaigns is not part of this demo.",
    reset:
      "Refreshing or leaving the page returns the campaign to its first state: the brief approval, your edits, the approval and the request history are not saved.",
    noProvider:
      "No X account, no AI provider, no database and no publishing path is connected to this room.",
    openRequest: "The same request is not sent twice; a refused request can be retried.",
  },

  stationSummary: {
    done: "Done",
    active: "In progress",
    waiting: "Waiting",
    attention: "Needs you",
  } satisfies Record<StationVisualState, string>,
};

export type CampaignCopy = typeof en;

const ar: CampaignCopy = {
  breadcrumbRoot: "القيادة",
  breadcrumbHere: "التسويق والمبيعات",
  breadcrumbAria: "الموقع داخل COMMAND",
  kicker: "غرفة التسويق",
  title: "غرفة التسويق",
  subtitle: "حملة واحدة تُنفَّذ في مكانها: البريف، المسودة، الاعتماد، ثم طلب الجدولة.",
  demoBadge: "معاينة تجريبية",
  reset: "إعادة ضبط العرض التجريبي",
  resetHint: "ترجع الحملة إلى حالتها الأولى",
  campaignLabel: "المشروع النشط",
  campaignName: "حملة تصميم متاجر سلة وزد",
  campaignMeta: "عمل لعميل · 21 يومًا · 30 طلب تصميم",

  decisions: {
    title: "قراراتك",
    subtitle: "قرار واحد يدفع الحملة للأمام.",
    aria: "قراراتك في هذه الحملة",
    missionLabel: "المهمة المحددة",
    mission: "حملة تصميم متاجر سلة وزد",
    ownerLabel: "المسؤول",
    nextLabel: "الخطوة التالية",
    review: "راجع المسودة",
    reviewHint: "تفتح محطة مراجعة النشر",
    manual: "أكمل يدويًا",
    manualHint: "تفتح مسودة المحتوى للتعديل اليدوي",
  },

  stationsAria: "محطات الحملة",
  stations: {
    strategy: {
      name: "الاستراتيجية",
      role: "وكيل الاستراتيجية",
      hint: "البريف والجمهور والعرض",
      open: "افتح محطة الاستراتيجية",
    },
    content: {
      name: "المحتوى",
      role: "وكيل المحتوى",
      hint: "اكتب مسودة X",
      open: "افتح محطة المحتوى",
    },
    publish: {
      name: "مراجعة النشر",
      role: "وكيل النشر",
      hint: "الاعتماد والموعد والطلب",
      open: "افتح محطة مراجعة النشر",
    },
  },

  states: {
    done: "منتهي",
    active: "قيد العمل",
    waiting: "بانتظار الدور",
    attention: "يحتاجك",
  },

  analysis: {
    label: "حالة التحليل",
    brief: "قراءة أولى: النتيجة قابلة للقياس، الجمهور محدد، ولا يوجد أي ادعاء سعري.",
    draft: "قراءة أولى: الافتتاحية تسمّي المنصتين، والوعد محدد بمدة، والمسودة داخل الحد.",
    approve: "المسودة جاهزة للمراجعة. لا جدولة قبل اعتماد هذه النسخة تحديدًا.",
    stale: "النص تغيّر بعد الاعتماد، فلم يبقَ الاعتماد صالحًا ويجب تجديده قبل الجدولة.",
    schedule: "المسودة معتمدة. اختر الموعد ثم أرسل الطلب إلى الموصل التجريبي المحلي.",
    scheduled: "الموصل التجريبي قبل الجدولة. ولم يُنشر أي شيء على X.",
  },

  stepNames: {
    brief: "اعتماد بريف الحملة",
    draft: "كتابة مسودة X يدويًا",
    approve: "مراجعة النسخة واعتمادها",
    schedule: "اختيار الموعد وطلب الجدولة",
    scheduled: "الجدولة مقبولة من الموصل التجريبي",
  },

  work: {
    tabsAria: "محطات الحملة",
    panelAria: "لوحة عمل الحملة",
    stepLabel: "المسؤول: {role}",
  },

  strategy: {
    title: "الاستراتيجية",
    lead: "البريف الذي تُقاس عليه هذه الحملة.",
    approve: "اعتماد البريف",
    approved: "البريف معتمد",
    locked: "تُفتح المسودة والمراجعة بعد اعتماد البريف.",
    approvedNote: "يمكن لوكيل المحتوى الآن إكمال المسودة.",
    fields: [
      { label: "النتيجة المطلوبة", value: "30 طلب تصميم متجر خلال 21 يومًا" },
      { label: "الجمهور", value: "تجار سلة وزد الناشئون: متجر أقل من سنة، من 5 إلى 20 منتجًا" },
      { label: "العرض", value: "تصميم واجهة متجر جاهزة خلال 7 أيام مع جلسة تحسين تحويل" },
      { label: "القنوات", value: "X (منشور واحد) ثم متابعة على واتساب الأعمال" },
      { label: "القيود", value: "لا أسعار، لا أرقام أداء غير موثقة، هوية NEXUP فقط" },
      { label: "معيار القبول", value: "منشور معتمد بطول 280 حرفًا أو أقل، مع موعد محدد" },
    ],
  },

  content: {
    title: "المحتوى · منشور X",
    lead: "عدّل المسودة يدويًا. أي تغيير بعد الاعتماد يعيدها إلى الاعتماد مرة أخرى.",
    draftLabel: "مسودة X",
    counter: "{count} / 280",
    overLimit: "تجاوزت حد X — اختصر النص قبل الاعتماد",
    generate: "اقترح نسخة أخرى",
    seedDraft:
      "متجرك على سلة أو زد يستحق واجهة تبيع قبل أن تشرح. نصمّم واجهة متجرك في 7 أيام: صفحة منتج، سلة، وصفحة عروض، مع جلسة تحسين تحويل بعد التسليم. نستقبل 5 متاجر هذا الشهر — أرسل رابط متجرك.",
    alternateDraft:
      "واجهة متجرك هي أول بائع عندك. على سلة أو زد نصمّم خلال 7 أيام: صفحة منتج واضحة، سلة سريعة، وصفحة عروض، ثم جلسة تحسين تحويل. 5 مقاعد فقط هذا الشهر — أرسل رابط متجرك.",
    previewLabel: "كما سيقرأها القارئ",
    saveHint: "التعديلات تعيش في هذه التبويبة فقط وتُصفَّر عند تحديث الصفحة.",
    editedTag: "معدّلة يدويًا",
    approvedTag: "النص المعتمد",
  },

  publish: {
    title: "مراجعة النشر",
    lead: "اعتمد هذه النسخة تحديدًا، اختر الموعد، ثم اطلب الجدولة.",
    version: "النسخة {version}",
    approvalLabel: "الاعتماد",
    approvalNone: "لم تُعتمد بعد",
    approvalApproved: "معتمدة",
    approvalStale: "انتهى الاعتماد — أعد الاعتماد",
    approve: "اعتماد هذه النسخة",
    reapprove: "إعادة اعتماد النسخة",
    approvalLocked: "اعتمد البريف أولًا، ثم هذه النسخة.",
    approvalTooLong: "المسودة أطول من 280 حرفًا ولا يمكن اعتمادها.",
    slotLabel: "موعد الجدولة",
    slotAria: "اختر موعد الجدولة",
    slots: {
      "today-evening": "اليوم · 6:00 م",
      "tomorrow-morning": "غدًا · 9:30 ص",
      "thursday-night": "الخميس · 9:00 م · رفض تجريبي",
    },
    request: "طلب الجدولة",
    retry: "إعادة إرسال الطلب",
    requesting: "جارٍ إرسال الطلب…",
    connectorLabel: "الموصل",
    connectorNote:
      "منفذ قابل للاستبدال: لا حساب، لا مفاتيح، ولا نداء شبكة. استبدله بموصل حقيقي عند الإنتاج.",
    publishLabel: "النشر",
    publishNever: "لم يُنشر. الجدولة المقبولة طلب، وليست نشرًا.",
    publishAfterAccept: "الجدولة مقبولة للموعد {slot}. ولم يُنشر المنشور على X.",
    historyLabel: "الطلبات في هذه الجلسة",
    historyEmpty: "لم يُرسل أي طلب في هذه الجلسة بعد.",
    successTitle: "الجدولة مقبولة",
    successBody: "رقم الإيصال {receipt}. محاكاة — لم يُرسل أي شيء إلى X.",
    failureTitle: "الموصل التجريبي رفض الطلب",
    failureBody: "الموصل التجريبي رفض هذا الموعد عن قصد، لعرض مسار الفشل. ({code})",
    duplicateTitle: "طلب مكرّر",
    duplicateBody: "هذا النص وهذا الموعد أُرسلا بالفعل في هذه الجلسة، ولم يُرسل شيء مرة أخرى.",
    blockedTitle: "لم يُرسل الطلب",
    blocked: {
      brief: "اعتمد البريف أولًا.",
      approval: "هذه النسخة تحتاج اعتمادًا قبل الجدولة.",
      slot: "اختر موعد الجدولة أولًا.",
      empty: "المسودة فارغة.",
      limit: "المنشور أطول من 280 حرفًا.",
    },
    requestStatus: {
      pending: "قيد الإرسال",
      accepted: "مقبول",
      failed: "مرفوض",
    },
    attempt: "المحاولة {attempt}",
  },

  team: {
    title: "فريق القسم",
    subtitle: "من يعمل على هذه الحملة، ومن يملك الخطوة الحالية.",
    aria: "فريق الحملة",
    ownerTag: "مسؤول الخطوة",
    statusWords: {
      working: "يعمل",
      available: "متاح",
      waiting: "بانتظار اعتماد",
    },
    members: {
      manager: { name: "مدير التسويق", role: "مدير القسم" },
      strategy: { name: "وكيل الاستراتيجية", role: "البريف والجمهور" },
      content: { name: "وكيل المحتوى", role: "المسودة والتعديلات" },
      publish: { name: "وكيل النشر", role: "الاعتماد والجدولة" },
    },
  },

  notes: {
    title: "ما هذه الغرفة",
    local: "كل قيمة في هذه الصفحة حالة تجريبية محلية تُحسب في المتصفح.",
    fixedCampaign:
      "الحملة المربوطة بهذه الجولة واحدة، والغرفة تفتح عليها دائمًا؛ إنشاء حملات جديدة أو التبديل بينها ليس جزءًا من هذا العرض التجريبي.",
    reset:
      "تحديث الصفحة أو مغادرتها يعيد الحملة إلى حالتها الأولى: اعتماد البريف، وتعديلاتك، والاعتماد، وسجل الطلبات لا تُحفظ.",
    noProvider: "لا حساب X، ولا مزوّد ذكاء اصطناعي، ولا قاعدة بيانات، ولا مسار نشر مرتبط بهذه الغرفة.",
    openRequest: "الطلب نفسه لا يُرسل مرتين، والطلب المرفوض يمكن إعادة إرساله.",
  },

  stationSummary: {
    done: "منتهي",
    active: "قيد العمل",
    waiting: "بانتظار الدور",
    attention: "يحتاجك",
  },
};

export const MARKETING_COPY: Record<Locale, CampaignCopy> = { en, ar };

/** Interpolate `{name}` placeholders. Unknown names stay visible. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
