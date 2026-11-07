"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "./icons";

const HEAD_SRC = "/exec-lab/exec-head.png";

type Locale = "ar" | "en";
type WorkspaceTab = "activity" | "preview" | "outputs";
type PrimaryDestination = "chat" | "plugins" | "settings";
type Message = { id: string; role: "user" | "exec"; text: string };

const COPY = {
  ar: {
    newChat: "محادثة جديدة",
    search: "ابحث في المحادثات",
    recent: "المحادثات الحديثة",
    plugins: "Plugins",
    account: "سعيد · Demo",
    temporary: "المحادثات مؤقتة",
    greeting: "إيه اللي نشتغل عليه يا سعيد؟",
    subline: "ابدأ بطلب واضح، وخلّي التفاصيل تظهر وقت الحاجة.",
    placeholder: "اكتب إلى EXEC…",
    send: "إرسال",
    attach: "إضافة",
    attachment: "إضافة ملف تجريبي",
    noUpload: "لن يُرفع أو يُحلّل في النموذج.",
    workspaceOpen: "فتح مساحة العمل",
    workspaceClose: "إغلاق مساحة العمل",
    workspace: "مساحة العمل",
    activity: "النشاط",
    preview: "المعاينة",
    outputs: "المخرجات",
    activityEmpty: "لا يوجد نشاط بعد. يظهر هنا ما حدث في النموذج فقط.",
    previewEmpty: "لا توجد معاينة متاحة قبل إنشاء مخرج.",
    outputsEmpty: "لا توجد مخرجات في هذه المحادثة.",
    menuOpen: "فتح قائمة المحادثات",
    menuClose: "إغلاق قائمة المحادثات",
    collapseSidebar: "طي قائمة المحادثات",
    expandSidebar: "توسيع قائمة المحادثات",
    reply: "نبدأ بتحديد هدف الإطلاق، ثم أحوّل القرار إلى موجز قصير قابل للمراجعة.",
    prototype: "نموذج تخطيط معزول — لا يُرسل طلبًا ولا يحفظ الرسائل.",
    review: "مساحة المراجعة",
    preferences: "التفضيلات",
    settings: "الإعدادات",
    openSettings: "فتح الإعدادات",
    language: "English",
    appearance: "المظهر الداكن",
    motion: "حركة هادئة",
    noResults: "لا توجد محادثات مطابقة.",
    back: "الرجوع للمحادثة",
    pluginsLead: "أنظمة مؤكدة فقط. لا مفاتيح ولا ربط من المتصفح.",
    connectedLocal: "متصل محليًا",
    notConnected: "غير متصل",
  },
  en: {
    newChat: "New chat",
    search: "Search conversations",
    recent: "Recent conversations",
    plugins: "Plugins",
    account: "Saeed · Demo",
    temporary: "Conversations are temporary",
    greeting: "What should we work on, Saeed?",
    subline: "Start with a clear request. Details appear only when needed.",
    placeholder: "Message EXEC…",
    send: "Send",
    attach: "Add",
    attachment: "Add a demo file",
    noUpload: "It will not be uploaded or analysed in this prototype.",
    workspaceOpen: "Open workspace",
    workspaceClose: "Close workspace",
    workspace: "Workspace",
    activity: "Activity",
    preview: "Preview",
    outputs: "Outputs",
    activityEmpty: "No activity yet. Only prototype actions appear here.",
    previewEmpty: "Nothing is available to preview before an output exists.",
    outputsEmpty: "This conversation has no outputs.",
    menuOpen: "Open conversations menu",
    menuClose: "Close conversations menu",
    collapseSidebar: "Collapse conversations sidebar",
    expandSidebar: "Expand conversations sidebar",
    reply: "First we define the launch goal, then I turn that decision into a short reviewable brief.",
    prototype: "Isolated layout prototype — no request is sent and messages are not saved.",
    review: "Review space",
    preferences: "Preferences",
    settings: "Settings",
    openSettings: "Open settings",
    language: "العربية",
    appearance: "Dark appearance",
    motion: "Calm motion",
    noResults: "No conversations match this search.",
    back: "Back to conversation",
    pluginsLead: "Confirmed systems only. No browser keys or connection flow.",
    connectedLocal: "Connected locally",
    notConnected: "Not connected",
  },
} as const;

const SESSIONS = [
  { id: "launch", ar: "خطة إطلاق الربع القادم", en: "Next-quarter launch plan", meta: "Today" },
  { id: "review", ar: "مراجعة وضع الشركة", en: "Company status review", meta: "Yesterday" },
  { id: "brief", ar: "موجز الشراكة", en: "Partnership brief", meta: "Tue" },
] as const;

const PLUGINS = [
  {
    id: "api",
    ar: "واجهة محادثة EXEC",
    en: "EXEC Conversation API",
    detailAr: "مسار اختباري على نفس الأصل.",
    detailEn: "Same-origin test route.",
    connected: true,
  },
  {
    id: "dummy",
    ar: "الموصل الوهمي المحلي",
    en: "Offline dummy connector",
    detailAr: "رد اصطناعي للاختبار، بلا موديل أو أدوات.",
    detailEn: "Synthetic test reply, with no model or tools.",
    connected: true,
  },
  {
    id: "r2",
    ar: "تخزين إيصالات R2",
    en: "R2 receipt storage",
    detailAr: "قدرة خادمية غير مربوطة بواجهة EXEC.",
    detailEn: "Server capability not bound to EXEC.",
    connected: false,
  },
] as const;

function Composer({
  locale,
  draft,
  onDraft,
  onSend,
}: {
  locale: Locale;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
}) {
  const copy = COPY[locale];
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 152)}px`;
  }, [draft]);

  return (
    <div className="nxp-composer">
      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        placeholder={copy.placeholder}
        aria-label={copy.placeholder}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      <div className="nxp-composer__bar">
        <div className="nxp-attach">
          <button
            type="button"
            className="nxp-iconbtn"
            aria-label={copy.attach}
            aria-expanded={attachOpen}
            onClick={() => setAttachOpen((value) => !value)}
          >
            <Icon name="attach" />
          </button>
          {attachOpen && (
            <div className="nxp-attach__menu">
              <button type="button" onClick={() => setAttachOpen(false)}>{copy.attachment}</button>
              <p>{copy.noUpload}</p>
            </div>
          )}
        </div>
        <span className="nxp-agent"><Image src={HEAD_SRC} alt="" width={24} height={24} unoptimized /> EXEC</span>
        <span className="nxp-composer__spacer" />
        <button type="button" className="nxp-send" aria-label={copy.send} disabled={!draft.trim()} onClick={onSend}>
          <Icon name="send" />
        </button>
      </div>
    </div>
  );
}

function StudioSidebar({
  locale,
  query,
  onQuery,
  onNew,
  onPlugins,
  onSettings,
  onLocale,
  onSession,
  onToggleCollapsed,
  collapsed = false,
  activeSessionId,
  activeDestination,
  mobile = false,
  onClose,
}: {
  locale: Locale;
  query: string;
  onQuery: (value: string) => void;
  onNew: () => void;
  onPlugins: () => void;
  onSettings: () => void;
  onLocale: () => void;
  onSession: (id: string) => void;
  onToggleCollapsed?: () => void;
  collapsed?: boolean;
  activeSessionId: string | null;
  activeDestination: PrimaryDestination;
  mobile?: boolean;
  onClose?: () => void;
}) {
  const copy = COPY[locale];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale === "ar" ? "ar" : "en");
    return SESSIONS.filter((session) => `${session[locale]} ${session.meta}`.toLocaleLowerCase().includes(needle));
  }, [locale, query]);

  return (
    <aside className={mobile ? "nxp-sidebar nxp-drawer" : "nxp-sidebar"} aria-label={copy.recent}>
      <div className="nxp-brand">
        <Image src={HEAD_SRC} alt="" width={34} height={34} unoptimized />
        <span><strong>NEXUP</strong><small>COMMAND</small></span>
        {mobile ? (
          <button type="button" className="nxp-iconbtn" aria-label={copy.menuClose} onClick={onClose}>
            <Icon name="close" />
          </button>
        ) : (
          <button
            type="button"
            className="nxp-iconbtn nxp-brand__toggle"
            aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar}
            onClick={onToggleCollapsed}
          >
            <Icon name="chevron" />
          </button>
        )}
      </div>
      <button type="button" className="nxp-new" aria-label={copy.newChat} title={copy.newChat} onClick={onNew}>
        <Icon name="chat" />
        <span>{copy.newChat}</span>
      </button>
      <label className="nxp-search">
        <Icon name="sessions" />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} />
      </label>
      <details className="nxp-recents" open>
        <summary>{copy.recent}<Icon name="chevron" /></summary>
        <div className="nxp-sessionlist">
          {filtered.map((session) => (
            <button
              key={session.id}
              type="button"
              aria-label={session[locale]}
              aria-current={activeSessionId === session.id ? "true" : undefined}
              data-active={activeSessionId === session.id ? "true" : "false"}
              onClick={() => onSession(session.id)}
            >
              <span>{session[locale]}</span><small>{session.meta}</small>
            </button>
          ))}
          {filtered.length === 0 && <p>{copy.noResults}</p>}
        </div>
      </details>
      <button type="button" className="nxp-navitem" data-active={activeDestination === "plugins" ? "true" : "false"} aria-current={activeDestination === "plugins" ? "page" : undefined} title={copy.plugins} onClick={onPlugins}>
        <Icon name="tools" /><span>{copy.plugins}</span><Icon name="chevron" />
      </button>
      <button type="button" className="nxp-navitem" data-active={activeDestination === "settings" ? "true" : "false"} aria-current={activeDestination === "settings" ? "page" : undefined} title={copy.settings} onClick={onSettings}>
        <Icon name="settings" /><span>{copy.settings}</span><Icon name="chevron" />
      </button>
      <div className="nxp-sidebar__spacer" />
      <details className="nxp-account">
        <summary>
          <span className="nxp-account__avatar">S</span>
          <span><strong>{copy.account}</strong><small>{copy.temporary}</small></span>
          <Icon name="chevron" />
        </summary>
        <div className="nxp-account__menu">
          <p>{copy.preferences}</p>
          <button type="button" onClick={onLocale}>{copy.language}</button>
          <span>{copy.appearance}</span>
          <span>{copy.motion}</span>
          <button type="button" onClick={onSettings}>{copy.openSettings}</button>
          <Link href="/command/exec/lab">{copy.review}</Link>
        </div>
      </details>
    </aside>
  );
}

function WorkspacePanel({
  locale,
  tab,
  onTab,
  onClose,
}: {
  locale: Locale;
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  onClose: () => void;
}) {
  const copy = COPY[locale];
  return (
    <aside className="nxp-workspace" aria-label={copy.workspace}>
      <header>
        <button type="button" className="nxp-workspace__back" onClick={onClose} aria-label={copy.workspaceClose}>
          <Icon name="chevron" /><span>{copy.back}</span>
        </button>
        <h2>{copy.workspace}</h2>
        <button type="button" className="nxp-iconbtn" onClick={onClose} aria-label={copy.workspaceClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="nxp-workspace__tabs" role="tablist">
        {(["activity", "preview", "outputs"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => onTab(item)}>
            {copy[item]}
          </button>
        ))}
      </div>
      <div className="nxp-workspace__body">
        <div className="nxp-empty-state"><Icon name={tab === "activity" ? "live" : tab === "preview" ? "doc" : "check"} /><p>{copy[`${tab}Empty`]}</p></div>
      </div>
    </aside>
  );
}

function PrimaryDestination({
  destination,
  locale,
  onBack,
  onLocale,
}: {
  destination: Exclude<PrimaryDestination, "chat">;
  locale: Locale;
  onBack: () => void;
  onLocale: () => void;
}) {
  const copy = COPY[locale];
  return (
    <section className="nxp-destination">
      <header>
        <button type="button" onClick={onBack}><Icon name="chevron" />{copy.back}</button>
        <div>
          <span>{destination === "plugins" ? copy.plugins : copy.preferences}</span>
          <h1>{destination === "plugins" ? copy.plugins : copy.settings}</h1>
        </div>
      </header>
      {destination === "plugins" ? (
        <div className="nxp-destination__content nxp-plugins">
          <p className="nxp-workspace__lead">{copy.pluginsLead}</p>
          {PLUGINS.map((plugin) => (
            <article key={plugin.id} className="nxp-plugin">
              <div><h3>{plugin[locale]}</h3><span data-connected={plugin.connected}>{plugin.connected ? copy.connectedLocal : copy.notConnected}</span></div>
              <p>{locale === "ar" ? plugin.detailAr : plugin.detailEn}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="nxp-destination__content nxp-settings">
          <article><div><Icon name="settings" /><span><strong>{copy.appearance}</strong><small>{locale === "ar" ? "الهوية الداكنة هي المعتمدة لهذا النموذج." : "Dark appearance is fixed for this prototype."}</small></span></div><b>{locale === "ar" ? "داكن" : "Dark"}</b></article>
          <article><div><Icon name="live" /><span><strong>{copy.motion}</strong><small>{locale === "ar" ? "الحركة قصيرة وتتوقف مع إعداد النظام." : "Motion is brief and respects the system setting."}</small></span></div><b>{locale === "ar" ? "تلقائي" : "System"}</b></article>
          <article><div><Icon name="chat" /><span><strong>{locale === "ar" ? "اللغة" : "Language"}</strong><small>{locale === "ar" ? "تبديل اتجاه الواجهة دون فقد المسودة." : "Switch direction without losing the draft."}</small></span></div><button type="button" onClick={onLocale}>{copy.language}</button></article>
        </div>
      )}
    </section>
  );
}

export function ExecStudioPrototype() {
  const [locale, setLocale] = useState<Locale>("ar");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [destination, setDestination] = useState<PrimaryDestination>("chat");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("activity");
  const copy = COPY[locale];

  const startNew = () => {
    setMessages([]);
    setDraft("");
    setActiveSessionId(null);
    setDestination("chat");
    setWorkspaceOpen(false);
    setDrawerOpen(false);
  };

  const send = () => {
    const value = draft.trim();
    if (!value) return;
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: "user", text: value },
      { id: `e-${Date.now()}`, role: "exec", text: copy.reply },
    ]);
    setDraft("");
  };

  const openSession = (id: string) => {
    const session = SESSIONS.find((item) => item.id === id);
    if (!session) return;
    setMessages([
      { id: `${id}-user`, role: "user", text: session[locale] },
      { id: `${id}-exec`, role: "exec", text: copy.reply },
    ]);
    setActiveSessionId(id);
    setDestination("chat");
    setWorkspaceOpen(false);
    setDrawerOpen(false);
  };

  const openDestination = (next: Exclude<PrimaryDestination, "chat">) => {
    setDestination(next);
    setWorkspaceOpen(false);
    setDrawerOpen(false);
  };

  return (
    <div className="nxp" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale} data-state={messages.length ? "thread" : "start"} data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}>
      <StudioSidebar
        locale={locale}
        query={query}
        onQuery={setQuery}
        onNew={startNew}
        onPlugins={() => openDestination("plugins")}
        onSettings={() => openDestination("settings")}
        onLocale={() => setLocale((value) => value === "ar" ? "en" : "ar")}
        onSession={openSession}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        collapsed={sidebarCollapsed}
        activeSessionId={activeSessionId}
        activeDestination={destination}
      />
      {drawerOpen && (
        <div className="nxp-drawerlayer">
          <button type="button" className="nxp-drawerlayer__scrim" aria-label={copy.menuClose} onClick={() => setDrawerOpen(false)} />
          <StudioSidebar
            mobile
            locale={locale}
            query={query}
            onQuery={setQuery}
            onNew={startNew}
            onPlugins={() => openDestination("plugins")}
            onSettings={() => openDestination("settings")}
            onLocale={() => setLocale((value) => value === "ar" ? "en" : "ar")}
            onSession={openSession}
            activeSessionId={activeSessionId}
            activeDestination={destination}
            onClose={() => setDrawerOpen(false)}
          />
        </div>
      )}
      <main className="nxp-main">
        <header className="nxp-topbar">
          <button type="button" className="nxp-iconbtn nxp-mobilemenu" aria-label={copy.menuOpen} onClick={() => setDrawerOpen(true)}>
            <Icon name="menu" />
          </button>
          <div className="nxp-mobilebrand"><strong>NEXUP</strong><small>COMMAND</small></div>
          <div className="nxp-identity"><Image src={HEAD_SRC} alt="EXEC" width={36} height={36} unoptimized /><span><strong>EXEC</strong><small>{copy.prototype}</small></span></div>
          {destination === "chat" && (
            <button type="button" className="nxp-workspacebtn" aria-expanded={workspaceOpen} aria-label={workspaceOpen ? copy.workspaceClose : copy.workspaceOpen} onClick={() => setWorkspaceOpen((value) => !value)}>
              <Icon name="live" /><span>{workspaceOpen ? copy.workspaceClose : copy.workspaceOpen}</span>
            </button>
          )}
        </header>
        {destination !== "chat" ? (
          <PrimaryDestination
            destination={destination}
            locale={locale}
            onBack={() => setDestination("chat")}
            onLocale={() => setLocale((value) => value === "ar" ? "en" : "ar")}
          />
        ) : messages.length === 0 ? (
          <section className="nxp-start">
            <div className="nxp-start__intro">
              <Image src={HEAD_SRC} alt="EXEC" width={88} height={88} unoptimized />
              <div><h1>{copy.greeting}</h1><p>{copy.subline}</p></div>
            </div>
            <Composer locale={locale} draft={draft} onDraft={setDraft} onSend={send} />
            <div className="nxp-suggestions">
              <button type="button" onClick={() => setDraft(locale === "ar" ? "جهّز خطة إطلاق مختصرة" : "Prepare a short launch plan")}>{locale === "ar" ? "خطّة إطلاق" : "Launch plan"}</button>
              <button type="button" onClick={() => setDraft(locale === "ar" ? "راجع وضع الشركة" : "Review company status")}>{locale === "ar" ? "راجع الوضع" : "Review status"}</button>
              <button type="button" onClick={() => setDraft(locale === "ar" ? "لخّص القرار المفتوح" : "Summarize the open decision")}>{locale === "ar" ? "قرار مفتوح" : "Open decision"}</button>
            </div>
          </section>
        ) : (
          <section className="nxp-thread">
            <div className="nxp-thread__messages">
              {messages.map((message) => (
                <article key={message.id} className="nxp-message" data-role={message.role}>
                  <span className="nxp-message__avatar">
                    {message.role === "exec" ? <Image src={HEAD_SRC} alt="" width={30} height={30} unoptimized /> : "S"}
                  </span>
                  <div><small>{message.role === "exec" ? "EXEC" : copy.account}</small><p>{message.text}</p>{message.role === "exec" && <em>{copy.prototype}</em>}</div>
                </article>
              ))}
            </div>
            <div className="nxp-thread__dock"><Composer locale={locale} draft={draft} onDraft={setDraft} onSend={send} /></div>
          </section>
        )}
      </main>
      {workspaceOpen && destination === "chat" && <WorkspacePanel locale={locale} tab={workspaceTab} onTab={setWorkspaceTab} onClose={() => setWorkspaceOpen(false)} />}
    </div>
  );
}
