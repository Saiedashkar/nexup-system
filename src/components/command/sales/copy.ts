/**
 * NEXUP COMMAND — MARKETING & SALES COPY (bilingual, demo)
 * ───────────────────────────────────────────────────────
 * The gateway and the sales room are ONE product surface with ONE vocabulary, so
 * their words live in one typed file instead of being scattered through two
 * components. The shape is declared once and both languages are typed as that
 * shape: a missing Arabic sentence is a compile error, not a blank line.
 *
 * WHY NOT `messages.ts`? That dictionary is the product's CHROME dictionary and
 * every surface reads it; the sales work is a new, self-contained addition whose
 * copy changes with it. Keeping it here means this pass touches one dictionary
 * and no existing key, which is also what keeps the other eleven surfaces exactly
 * as they were. It still reads the SAME locale store (`useLocale`) through
 * `use-sales-copy.ts`, so there is never a second answer to "what language".
 *
 * TRANSLATION RULES (the product's own): professional Arabic, not word-for-word;
 * brand and role identifiers stay as written; digits stay Western; every state is
 * a word, never only a colour.
 */

export type SalesLocale = "en" | "ar";

/** The three stations the room draws on its stage. */
export type StationId = "qualify" | "follow" | "offer";

/** The four roles that hold the work. Role-based, never a person's name. */
export type RoleId = "sales-manager" | "opportunity-scout" | "follow-up-agent" | "offer-manager";

/** The five steps of the one demo journey this room runs. */
export type JourneyStepId = "qualify" | "assign" | "offer" | "accept" | "deliver";

/** Every state word the room can print next to a station or a person. */
export type StatusWord = "working" | "ready" | "waiting" | "approval" | "done" | "blocked";

type StationCopy = { label: string; role: string; place: string };

type StepCopy = { title: string; owner: string; action: string; note: string };

export type SalesCopy = {
  kicker: string;
  badge: string;
  common: { openRoom: string; backToGateway: string; demoOnly: string; notTransferable: string };
  gateway: {
    title: string;
    blurb: string;
    doorsTitle: string;
    room: { title: string; body: string; cta: string };
    marketing: { title: string; body: string; cta: string; team: string };
    summary: { stations: string; steps: string; roles: string; team: string };
    summaryLabel: string;
    department: { cta: string };
    footLine: string;
    footPill: string;
    refCta: string;
    homeCta: string;
  };
  room: {
    title: string;
    blurb: string;
    stageLabel: string;
    taskLabel: string;
    taskTitle: string;
    decisionsTitle: string;
    decisionsNote: string;
    ownerLabel: string;
    nextLabel: string;
    reviewDraft: string;
    finishManually: string;
    inspectNote: string;
    backToCurrent: string;
    teamTitle: string;
    teamNote: string;
    journeyTitle: string;
    journeyNote: string;
    stepPanelTitle: string;
    gateLabel: string;
    askTitle: string;
    askPlaceholder: string;
    askSend: string;
    askNote: string;
    reset: string;
    resetNote: string;
    deliveryTitle: string;
    deliveryExisting: string;
    deliveryNew: string;
    deliveryClient: string;
    deliveryClientPlaceholder: string;
    deliveryProject: string;
    deliveryProjectPlaceholder: string;
    deliveryPreview: string;
    deliveryNote: string;
    deliveryClients: string;
    deliveryProjects: string;
    offerDraft: string;
  };
  fields: {
    followUpAt: string;
    offerText: string;
    owner: string;
    save: string;
    advance: string;
    markReviewed: string;
    reviewed: string;
    recordAcceptance: string;
    accepted: string;
    planDelivery: string;
    journeyDone: string;
    offeredDraft: string;
    manualDone: string;
    gateBlocked: string;
  };
  status: Record<StatusWord, string>;
  stations: Record<StationId, StationCopy>;
  roles: Record<RoleId, string>;
  steps: Record<JourneyStepId, StepCopy>;
};

export const SALES_COPY: Record<SalesLocale, SalesCopy> = {
  en: {
    kicker: "Leadership / Marketing & Sales",
    badge: "Demo preview",
    common: {
      openRoom: "Open the room",
      backToGateway: "Back to the gateway",
      demoOnly: "Demo only — nothing is written, sent or deployed",
      notTransferable: "Nothing here is a record",
    },
    gateway: {
      title: "Marketing & Sales",
      blurb:
        "Two doors, one department: marketing builds the demand, sales turns it into revenue. Both rooms are open as a demo — nothing here is published or sent.",
      doorsTitle: "Two doors",
      room: {
        title: "Sales",
        body: "Turning opportunities into revenue that can grow.",
        cta: "Enter the department",
      },
      marketing: {
        title: "Marketing",
        body: "Building demand and extending the brand's presence.",
        cta: "Enter the department",
        team: "Strategy · Content · Publish review",
      },
      summary: { stations: "Stations", steps: "Steps", roles: "Roles", team: "Team" },
      summaryLabel: "Department summary",
      department: { cta: "The full department workspace" },
      footLine: "From a campaign to a sales opportunity",
      footPill: "Demo data",
      refCta: "Open systems",
      homeCta: "Back to Command",
    },
    room: {
      title: "Sales operating room",
      blurb: "Qualify, follow up, offer — and the hand-off to the client and the project.",
      stageLabel: "Sales stage: three stations and the hand-off gate",
      taskLabel: "Selected task",
      taskTitle: "Storefront request",
      decisionsTitle: "Your decisions",
      decisionsNote: "Directing the critical work in sales.",
      ownerLabel: "Owner",
      nextLabel: "Next step",
      reviewDraft: "Review the draft",
      finishManually: "Complete manually",
      inspectNote: "You are inspecting this station; the task itself has not moved.",
      backToCurrent: "Back to the current step",
      teamTitle: "Department team",
      teamNote: "Every person here is a role, not a name.",
      journeyTitle: "Demo journey",
      journeyNote: "Five steps, one opportunity. The room keeps this in memory only; a reload starts it again.",
      stepPanelTitle: "Step",
      gateLabel: "To clients and projects",
      askTitle: "Ask the department manager",
      askPlaceholder: "Ask the department manager…",
      askSend: "Send",
      askNote: "This room is a demo: the message is not sent anywhere and no provider is called.",
      reset: "Restart the journey",
      resetNote: "Resets the five steps in this tab. Nothing stored is touched, because nothing is stored.",
      deliveryTitle: "Hand-off preview",
      deliveryExisting: "An existing client",
      deliveryNew: "A new client",
      deliveryClient: "Client",
      deliveryClientPlaceholder: "Client name",
      deliveryProject: "Project",
      deliveryProjectPlaceholder: "Project name",
      deliveryPreview: "Preview the hand-off",
      deliveryNote:
        "Preview only: this opens Clients and Projects so you can see where the work would land. No client, project or record is created.",
      deliveryClients: "See it in Clients",
      deliveryProjects: "See it in Projects",
      offerDraft:
        "Storefront request — scope: catalogue, checkout, one payment path.\nPrice band: 18,000–24,000. Timeline: 5 weeks.\nIncluded: setup, content migration for 120 products, a two-week support window.",
    },
    fields: {
      followUpAt: "Follow-up date",
      offerText: "Offer draft",
      owner: "Owner",
      save: "Save",
      advance: "Complete this step",
      markReviewed: "Mark as reviewed",
      reviewed: "Reviewed",
      recordAcceptance: "Record a demo acceptance",
      accepted: "Demo acceptance recorded",
      planDelivery: "Plan the hand-off",
      journeyDone: "The demo journey is complete",
      offeredDraft: "Draft saved in this tab",
      manualDone: "Step completed manually — the demo moved on, nothing was recorded.",
      gateBlocked: "This step needs its own input before it can be completed.",
    },
    status: {
      working: "Working",
      ready: "Available",
      waiting: "Waiting",
      approval: "Awaiting approval",
      done: "Done",
      blocked: "Blocked",
    },
    stations: {
      qualify: { label: "Opportunity qualification", role: "Opportunity scout", place: "Intake" },
      follow: { label: "Follow-up", role: "Follow-up agent", place: "Cadence" },
      offer: { label: "Offer", role: "Offer manager", place: "Review" },
    },
    roles: {
      "sales-manager": "Sales manager",
      "opportunity-scout": "Opportunity scout",
      "follow-up-agent": "Follow-up agent",
      "offer-manager": "Offer manager",
    },
    steps: {
      qualify: {
        title: "Qualify the opportunity",
        owner: "Opportunity scout",
        action: "Read the request and confirm it is a real opportunity",
        note: "Category, budget band and timing come from the inbound storefront request. Nothing is created here.",
      },
      assign: {
        title: "Name the owner and the follow-up date",
        owner: "Sales manager",
        action: "Pick who moves it next, and when they follow up",
        note: "A pipeline without a named owner and a date is a wish. Both are required before this step closes.",
      },
      offer: {
        title: "Edit the offer by hand, then review it",
        owner: "Offer manager",
        action: "Write the price and the scope, then read it once as the client would",
        note: "The draft is edited in this room only. It is not sent, and no offer record is written.",
      },
      accept: {
        title: "Record the demo acceptance",
        owner: "Sales manager",
        action: "Log a demo acceptance so the journey can continue",
        note: "A demo acceptance is a rehearsal of the real one: it is not a signature and it is not stored.",
      },
      deliver: {
        title: "Preview the hand-off to a client and a project",
        owner: "Sales manager",
        action: "Choose an existing client or a new one, then name the project",
        note: "The hand-off is a preview: it points at Clients and Projects and creates neither.",
      },
    },
  },
  ar: {
    kicker: "القيادة / التسويق والمبيعات",
    badge: "معاينة تجريبية",
    common: {
      openRoom: "افتح الغرفة",
      backToGateway: "رجوع للبوابة",
      demoOnly: "تجريبي فقط — لا يُكتب شيء ولا يُرسل ولا يُنشر",
      notTransferable: "لا شيء هنا يُعد سجلًا",
    },
    gateway: {
      title: "التسويق والمبيعات",
      blurb:
        "بابان لقسم واحد: التسويق يبني الطلب، والمبيعات تحوّله إلى إيراد. الغرفتان مفتوحتان كمعاينة تجريبية — لا نشر ولا إرسال.",
      doorsTitle: "بابان",
      room: {
        title: "المبيعات",
        body: "تحويل الفرص إلى إيرادات قابلة للنمو.",
        cta: "ادخل القسم",
      },
      marketing: {
        title: "التسويق",
        body: "بناء الطلب وتعزيز حضور العلامة.",
        cta: "ادخل القسم",
        team: "الاستراتيجية · المحتوى · مراجعة النشر",
      },
      summary: { stations: "المحطات", steps: "الخطوات", roles: "الأدوار", team: "الفريق" },
      summaryLabel: "ملخص القسم",
      department: { cta: "مساحة القسم الكاملة" },
      footLine: "من الحملة إلى فرصة بيع",
      footPill: "بيانات تجريبية",
      refCta: "افتح الأنظمة",
      homeCta: "رجوع إلى COMMAND",
    },
    room: {
      title: "غرفة تشغيل المبيعات",
      blurb: "تأهيل، متابعة، عرض — ثم التسليم للعميل والمشروع.",
      stageLabel: "منصة المبيعات: ثلاث محطات وبوابة التسليم",
      taskLabel: "المهمة المحددة",
      taskTitle: "طلب متجر إلكتروني",
      decisionsTitle: "قراراتك",
      decisionsNote: "توجيه وتشغيل المهام الحرجة في المبيعات.",
      ownerLabel: "المسؤول",
      nextLabel: "الخطوة التالية",
      reviewDraft: "راجع المسودة",
      finishManually: "أكمل يدويًا",
      inspectNote: "أنت تستعرض هذه المحطة؛ المهمة نفسها لم تتحرك.",
      backToCurrent: "رجوع للخطوة الحالية",
      teamTitle: "فريق القسم",
      teamNote: "كل من هنا دور وظيفي، وليس اسم شخص.",
      journeyTitle: "الرحلة التجريبية",
      journeyNote: "خمس خطوات لفرصة واحدة. الغرفة تحتفظ بها في الذاكرة فقط؛ إعادة التحميل تبدأها من جديد.",
      stepPanelTitle: "الخطوة",
      gateLabel: "إلى العملاء والمشاريع",
      askTitle: "اسأل مدير القسم",
      askPlaceholder: "اسأل مدير القسم…",
      askSend: "إرسال",
      askNote: "هذه الغرفة تجريبية: الرسالة لا تُرسل ولا يُستدعى أي مزوّد.",
      reset: "ابدأ الرحلة من جديد",
      resetNote: "تصفير الخطوات الخمس في هذا التاب. لا يُمَس أي مخزون، لأن لا شيء مخزَّن.",
      deliveryTitle: "معاينة التسليم",
      deliveryExisting: "عميل قائم",
      deliveryNew: "عميل جديد",
      deliveryClient: "العميل",
      deliveryClientPlaceholder: "اسم العميل",
      deliveryProject: "المشروع",
      deliveryProjectPlaceholder: "اسم المشروع",
      deliveryPreview: "اعرض معاينة التسليم",
      deliveryNote: "معاينة فقط: بتفتح العملاء والمشاريع عشان تشوف الشغل هيروح فين. ما يتم إنشاء عميل ولا مشروع ولا سجل.",
      deliveryClients: "شوفها في العملاء",
      deliveryProjects: "شوفها في المشاريع",
      offerDraft:
        "طلب متجر إلكتروني — النطاق: كتالوج، دفع، مسار سداد واحد.\nشريحة السعر: ‎18,000–24,000‎. المدة: خمسة أسابيع.\nيشمل: التجهيز، نقل محتوى 120 منتجًا، نافذة دعم أسبوعين.",
    },
    fields: {
      followUpAt: "موعد المتابعة",
      offerText: "مسودة العرض",
      owner: "المسؤول",
      save: "حفظ",
      advance: "أكمل هذه الخطوة",
      markReviewed: "علّمها كمراجَعة",
      reviewed: "تمت المراجعة",
      recordAcceptance: "سجّل قبولًا تجريبيًا",
      accepted: "تم تسجيل القبول التجريبي",
      planDelivery: "خطّط التسليم",
      journeyDone: "اكتملت الرحلة التجريبية",
      offeredDraft: "المسودة محفوظة في هذا التاب",
      manualDone: "أُكملت الخطوة يدويًا — الرحلة تحركت، ولم يُسجَّل شيء.",
      gateBlocked: "الخطوة دي محتاجة مدخلاتها قبل ما تكتمل.",
    },
    status: {
      working: "يعمل",
      ready: "متاح",
      waiting: "بانتظار",
      approval: "بانتظار اعتماد",
      done: "خلصت",
      blocked: "متوقف",
    },
    stations: {
      qualify: { label: "تأهيل الفرص", role: "مستكشف الفرص", place: "الاستقبال" },
      follow: { label: "المتابعة", role: "وكيل المتابعة", place: "الإيقاع" },
      offer: { label: "العرض", role: "مدير العرض", place: "المراجعة" },
    },
    roles: {
      "sales-manager": "مدير المبيعات",
      "opportunity-scout": "مستكشف الفرص",
      "follow-up-agent": "وكيل المتابعة",
      "offer-manager": "مدير العرض",
    },
    steps: {
      qualify: {
        title: "تأهيل الفرصة",
        owner: "مستكشف الفرص",
        action: "اقرأ الطلب واتأكد إنها فرصة حقيقية",
        note: "الفئة وشريحة الميزانية والتوقيت جايين من طلب المتجر الوارد. لا يتم إنشاء أي شيء هنا.",
      },
      assign: {
        title: "تحديد المسؤول وموعد المتابعة",
        owner: "مدير المبيعات",
        action: "اختار مين يحرّكها بعد كده، وأمتى يتابع",
        note: "خط بيع بدون مسؤول محدد وموعد هو مجرد أمنية. الاتنين مطلوبين قبل ما الخطوة دي تقفل.",
      },
      offer: {
        title: "تعديل العرض يدويًا ومراجعته",
        owner: "مدير العرض",
        action: "اكتب السعر والنطاق، وبعدها اقرأه مرة كأنك العميل",
        note: "المسودة تتعدل في الغرفة دي بس. ما تتبعتش، وما يتكتبش سجل عرض.",
      },
      accept: {
        title: "تسجيل القبول التجريبي",
        owner: "مدير المبيعات",
        action: "سجّل قبولًا تجريبيًا عشان الرحلة تكمل",
        note: "القبول التجريبي تدريب على الحقيقي: مش توقيع ومش محفوظ.",
      },
      deliver: {
        title: "معاينة التسليم لعميل ومشروع",
        owner: "مدير المبيعات",
        action: "اختار عميل قائم أو جديد، وسمّي المشروع",
        note: "التسليم معاينة: بيشاور على العملاء والمشاريع وما ينشئ أي منهما.",
      },
    },
  },
};

/** Resolve the copy for a locale. Unknown locales fall back to English. */
export function salesCopy(locale: string): SalesCopy {
  return locale === "ar" ? SALES_COPY.ar : SALES_COPY.en;
}
