/* ═══════════════════════════════════════════════════════
   EXEC chrome — the header menu, the composer and the side panel
   ═══════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  conversationRows,
  conversationRowTitle,
  currentScopeOptionId,
  filterConversationRows,
} from "./engine";
import { Icon } from "./icons";
import { SCOPE_OPTIONS } from "./catalog";
import { SCENARIO_LIST } from "./scenarios";
import { t, type Locale, type MessageKey } from "./i18n";
import type { DemoAttachment, ExperienceState } from "./types";
import { DependenciesPanel, TimelinePanel } from "./panels";

/** Escape closes any disclosure the surface opened, restoring focus. */
export function useEscapeClosesDisclosures(onEscape: (() => void) | null = null) {
  const closeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    closeRef.current = onEscape;
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (closeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return closeRef;
}

/** Small reusable pieces that other parts of the surface import. */

export type Notice = { id: number; keys: Array<MessageKey> };
export type PanelKind = "history" | "plugins" | "workspace";
export type PanelTarget = "activity" | "preview" | "outputs";

export function HeaderIdentity({
  tone,
  locale,
  avatarSrc,
}: {
  tone: string;
  locale: Locale;
  avatarSrc: string;
}) {
  return (
    <span className="nce-top__identity" data-tone={tone}>
      <span className="nce-face nce-face--small" data-tone={tone}>
        <Image
          className="nce-face__img"
          src={avatarSrc}
          alt={t(locale, "app.portraitAlt")}
          width={36}
          height={36}
          unoptimized
        />
      </span>
      <span className="nce-top__brand" aria-label="NEXUP COMMAND">
        <span>NEXUP</span>
        <small>COMMAND</small>
      </span>
      <span className="nce-top__name">{t(locale, "app.role")}</span>
    </span>
  );
}

export function HeaderMenu({
  locale,
  navCollapsed,
  onToggleNav,
  onToggleLocale,
  effects,
  onToggleEffects,
  onNewConversation,
  canResetRun,
  onResetRun,
  onStartScenario,
  runningId,
  labsHref,
  consoleHref,
}: {
  locale: Locale;
  navCollapsed: boolean;
  onToggleNav: () => void;
  onToggleLocale: () => void;
  effects: string;
  onToggleEffects: () => void;
  onNewConversation: () => void;
  canResetRun: boolean;
  onResetRun: () => void;
  onStartScenario: (id: string) => void;
  runningId: string | null;
  labsHref: string;
  consoleHref: string;
}) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const close = () => {
    setOpen(false);
    summaryRef.current?.focus();
  };
  useEscapeClosesDisclosures(open ? close : null);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || detailsRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [open]);

  /* Every item closes the menu first, then does its one thing. */
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <details
      ref={detailsRef}
      className="nce-menu"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        ref={summaryRef}
        className="nce-menu__btn"
        aria-label={t(locale, "menu.options")}
        title={t(locale, "menu.options")}
      >
        <Icon name="menu" className="nce-menu__icon" title={t(locale, "menu.options")} />
      </summary>

      <div className="nce-menu__list" role="menu">
        <p className="nce-menu__title">{t(locale, "menu.preferences")}</p>

        <button type="button" role="menuitem" className="nce-menu__item" onClick={pick(onNewConversation)}>
          {t(locale, "menu.new")}
        </button>
        <button
          type="button"
          role="menuitem"
          className="nce-menu__item"
          onClick={pick(onToggleLocale)}
          lang={locale === "ar" ? "en" : "ar"}
        >
          {t(locale, "menu.language")}
        </button>
        <button type="button" role="menuitem" className="nce-menu__item" onClick={pick(onToggleEffects)}>
          {t(locale, effects === "calm" ? "menu.effects.on" : "menu.effects.off")}
        </button>
        <button type="button" role="menuitem" className="nce-menu__item" onClick={pick(onToggleNav)}>
          {t(locale, navCollapsed ? "menu.navExpand" : "menu.navCollapse")}
        </button>
        <p className="nce-account__static">
          <span>{t(locale, "nav.appearance")}</span>
          <strong>{t(locale, "nav.appearanceDark")}</strong>
        </p>

        <details className="nce-review">
          <summary>{t(locale, "menu.review")}</summary>
          <p className="nce-note nce-note--tight">{t(locale, "menu.reviewNote")}</p>
          <button
            type="button"
            role="menuitem"
            className="nce-menu__item"
            disabled={!canResetRun}
            onClick={pick(onResetRun)}
          >
            {t(locale, "menu.reset")}
          </button>
          {SCENARIO_LIST.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              role="menuitem"
              className="nce-menu__item"
              aria-current={runningId === scenario.id ? "true" : undefined}
              onClick={pick(() => onStartScenario(scenario.id))}
            >
              {t(locale, scenario.labelKey)}
            </button>
          ))}
          <a role="menuitem" className="nce-menu__item" href={labsHref} onClick={() => setOpen(false)}>
            {t(locale, "menu.lab")}
          </a>
          <a role="menuitem" className="nce-menu__item" href={consoleHref} onClick={() => setOpen(false)}>
            {t(locale, "menu.console")}
          </a>
        </details>
      </div>
    </details>
  );
}

export function NoticeBar({
  notice,
  locale,
  onDismiss,
}: {
  notice: Notice;
  locale: Locale;
  onDismiss: () => void;
}) {
  return (
    <div className="nce-notice" role="status">
      <p>{notice.keys.map((k) => t(locale, k)).join(" ")}</p>
      <button type="button" className="nce-notice__dismiss" onClick={onDismiss}>
        <Icon name="close" className="nce-notice__icon" title={t(locale, "summary.close")} />
      </button>
    </div>
  );
}

export function ScopeMenu({
  state,
  locale,
  onScope,
}: {
  state: ExperienceState;
  locale: Locale;
  onScope: (id: string) => void;
}) {
  const currentId = currentScopeOptionId(state.scope);
  const current = SCOPE_OPTIONS.find((option) => option.id === currentId);
  const [open, setOpen] = useState(false);
  useEscapeClosesDisclosures(open ? () => setOpen(false) : null);

  return (
    <details className="nce-scope" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="nce-scope__trigger">
        <span className="nce-scope__label">{t(locale, "scope.title")}</span>
        <span className="nce-scope__sep" aria-hidden="true">·</span>
        <span className="nce-scope__value">
          {current ? t(locale, current.labelKey) : t(locale, "scope.current")}
        </span>
      </summary>
      <div className="nce-scope__menu" role="menu">
        <p className="nce-scope__head">{t(locale, "scope.change")}</p>
        {SCOPE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitem"
            className="nce-menu__item"
            aria-current={option.id === currentId ? "true" : undefined}
            onClick={() => {
              setOpen(false);
              onScope(option.id);
            }}
          >
            {t(locale, option.labelKey)}
          </button>
        ))}
        <p className="nce-note nce-note--tight">{t(locale, "scope.isolated")}</p>
      </div>
    </details>
  );
}

export function ScrollToNewest({
  locale,
  onClick,
}: {
  locale: Locale;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="nce-newest"
      aria-label={t(locale, "summary.open")}
      title={t(locale, "summary.open")}
      onClick={onClick}
    >
      <Icon name="chevron" className="nce-newest__icon" title={t(locale, "summary.open")} />
    </button>
  );
}

export function SidePanel({
  kind,
  state,
  locale,
  target,
  closing,
  onClose,
  onNewConversation,
  onOpenConversation,
  onTarget,
}: {
  kind: PanelKind;
  state: ExperienceState;
  locale: Locale;
  target: PanelTarget;
  closing: boolean;
  onClose: () => void;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onTarget: (target: PanelTarget) => void;
}) {
  const rows = conversationRows(state);
  const [query, setQuery] = useState("");
  const visibleRows = filterConversationRows(rows, query, locale);
  const outputs = state.run?.messages.flatMap((message) => message.cards).filter((card) => card.kind === "result") ?? [];

  return (
    <aside
      className={`nce-side nce-side--${kind}${closing ? " is-closing" : ""}`}
      data-kind={kind}
      aria-label={t(locale, "panel.details")}
    >
      <header className="nce-side__head">
        <h2 className="nce-side__title">
          {t(locale, kind === "history" ? "nav.sessions" : kind === "plugins" ? "plugins.title" : "workspace.title")}
        </h2>
        <button type="button" className="nce-side__close" onClick={onClose} aria-label={t(locale, "workspace.back")}>
          <Icon name="close" className="nce-side__close__icon" title={t(locale, "workspace.back")} />
        </button>
      </header>

      <div className="nce-side__body">
        {kind === "history" && (
          <section className="nce-hist">
            <label className="nce-panel-search">
              <span className="nce-sr-only">{t(locale, "nav.sessionSearch")}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(locale, "nav.sessionSearch")}
              />
            </label>
            <ul className="nce-hist__list">
              {visibleRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="nce-hist__row"
                    data-open={row.isOpen ? "true" : "false"}
                    aria-current={row.isOpen ? "true" : undefined}
                    onClick={() => !row.isOpen && onOpenConversation(row.id)}
                  >
                    <span>{conversationRowTitle(row, locale)}</span>
                    <small dir="ltr">{row.taskCode ?? row.code}</small>
                  </button>
                </li>
              ))}
            </ul>
            {visibleRows.length === 0 && <p className="nce-empty">{t(locale, "nav.sessionNoResults")}</p>}
            <button type="button" className="nce-btn nce-btn--primary" onClick={onNewConversation}>
              {t(locale, "history.new")}
            </button>
          </section>
        )}

        {kind === "plugins" && (
          <section className="nce-plugins">
            <p className="nce-note">{t(locale, "plugins.lead")}</p>
            {(["execApi", "dummy", "r2", "provider"] as const).map((plugin) => {
              const connected = plugin === "execApi" || plugin === "dummy";
              return (
                <article key={plugin} className="nce-plugin" data-connected={connected ? "true" : "false"}>
                  <div className="nce-plugin__head">
                    <h3>{t(locale, `plugins.${plugin}.name`)}</h3>
                    <span>{t(locale, connected ? "plugins.connectedLocal" : "plugins.notConnected")}</span>
                  </div>
                  <p>{t(locale, `plugins.${plugin}.detail`)}</p>
                  <small>{t(locale, "plugins.access")}: {t(locale, `plugins.${plugin}.access`)}</small>
                </article>
              );
            })}
          </section>
        )}

        {kind === "workspace" && (
          <section className="nce-workspace">
            <div className="nce-workspace__tabs" role="tablist" aria-label={t(locale, "workspace.title")}>
              {(["activity", "preview", "outputs"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={target === item}
                  className="nce-workspace__tab"
                  onClick={() => onTarget(item)}
                >
                  {t(locale, `workspace.${item}`)}
                </button>
              ))}
            </div>
            <div className="nce-workspace__view" role="tabpanel">
              {target === "activity" && <TimelinePanel run={state.run} locale={locale} />}
              {target === "preview" && (
                state.run ? <DependenciesPanel run={state.run} locale={locale} /> : <p className="nce-empty">{t(locale, "workspace.preview.empty")}</p>
              )}
              {target === "outputs" && (
                outputs.length > 0 ? (
                  <div className="nce-output-list">
                    {outputs.map((output) => (
                      <article key={output.id} className="nce-output-mini">
                        <h3>{t(locale, output.titleKey ?? "panel.details")}</h3>
                        <p>{t(locale, output.descriptionKey ?? output.noPublishKey)}</p>
                        <span>{t(locale, "app.demoBadge")}</span>
                      </article>
                    ))}
                  </div>
                ) : <p className="nce-empty">{t(locale, "workspace.outputs.empty")}</p>
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

export function Composer({
  locale,
  draft,
  onDraft,
  onSend,
  pending,
  attachments,
  onAttach,
  onRemoveAttachment,
  variant,
  choices,
  onChoose,
  stopChoice,
  onStop,
  agentTone,
  effects,
  avatarSrc,
}: {
  locale: Locale;
  draft: string;
  onDraft: (next: string) => void;
  onSend: () => void;
  pending: boolean;
  attachments: DemoAttachment[];
  onAttach: (kind: string, name?: string) => void;
  onRemoveAttachment: (id: string) => void;
  variant: "hero" | "thread";
  choices: unknown[];
  onChoose: (id: string) => void;
  stopChoice: unknown | null;
  onStop: (id: string) => void;
  agentTone: string;
  effects: string;
  avatarSrc: string;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  useEscapeClosesDisclosures(attachOpen ? () => setAttachOpen(false) : null);

  const railRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? "auto" : "hidden";
  }, [draft]);

  /* Tools lean toward a hovering pointer. Touch never triggers it, even on hybrid screens. */
  const magnetise = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    railRef.current?.querySelectorAll<HTMLElement>(".nce-tool").forEach((tool) => {
      const box = tool.getBoundingClientRect();
      const distance = Math.hypot(
        event.clientX - (box.left + box.width / 2),
        event.clientY - (box.top + box.height / 2),
      );
      tool.style.setProperty("--nce-mag", Math.max(0, 1 - distance / 64).toFixed(3));
    });
  };
  const release = () => {
    railRef.current?.querySelectorAll<HTMLElement>(".nce-tool").forEach((tool) => {
      tool.style.removeProperty("--nce-mag");
    });
  };

  const canSend = !pending && draft.trim().length > 0;
  const attachFile = (kind: "doc" | "image") => {
    setAttachOpen(false);
    onAttach(kind);
  };

  return (
    <div className="nce-write" data-variant={variant} data-effects={effects} aria-busy={pending}>
      <div className="nce-write__input">
        {attachments.length > 0 && (
          <div className="nce-write__files">
            {attachments.map((file) => (
              <span key={file.id} className="nce-write__file" data-kind={file.fileKind}>
                <span dir="auto">{file.name ?? t(locale, file.nameKey)}</span>
                <button
                  type="button"
                  className="nce-write__filedrop"
                  aria-label={t(locale, "panel.close")}
                  onClick={() => onRemoveAttachment(file.id)}
                >
                  <Icon name="close" className="nce-write__fileicon" title={t(locale, "panel.close")} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={pending}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={t(locale, "conv.composer.placeholder")}
          aria-label={t(locale, "conv.composer.placeholder")}
          title={t(locale, "composer.send.note")}
        />
      </div>

      {choices.length > 0 && (
        <div className="nce-suggest">
          {(choices as Array<{ id: string; labelKey: MessageKey }>).map((choice) => (
            <button key={choice.id} type="button" className="nce-suggest__chip" onClick={() => onChoose(choice.id)}>
              {t(locale, choice.labelKey)}
            </button>
          ))}
        </div>
      )}

      <div
        ref={railRef}
        className="nce-write__rail"
        data-pointer="off"
        onPointerMove={magnetise}
        onPointerLeave={release}
      >
        <span className="nce-pop" data-kind="tool" data-open={attachOpen ? "true" : "false"}>
          <button
            type="button"
            className="nce-tool"
            aria-label={t(locale, "composer.attach")}
            aria-expanded={attachOpen}
            title={t(locale, "composer.attach")}
            onClick={() => setAttachOpen((current) => !current)}
          >
            <span className="nce-tool__face" aria-hidden="true">
              ＋
            </span>
          </button>
          {attachOpen && (
            <div className="nce-pop__menu" role="menu">
              <p className="nce-pop__title">{t(locale, "composer.attach")}</p>
              <button type="button" role="menuitem" className="nce-menu__item" onClick={() => attachFile("doc")}>
                {t(locale, "composer.attach.file")}
              </button>
              <button type="button" role="menuitem" className="nce-menu__item" onClick={() => attachFile("image")}>
                {t(locale, "composer.attach.image")}
              </button>
              <p className="nce-note nce-note--tight">{t(locale, "composer.attach.note")}</p>
              <p className="nce-write__narrowonly">
                {t(locale, "composer.model")}: {t(locale, "composer.brain.none")}
              </p>
            </div>
          )}
        </span>

        <span className="nce-write__wideonly nce-write__identity">
          <span className="nce-chip" data-tone={agentTone} title={t(locale, "composer.agent.current")}>
            <Image src={avatarSrc} alt="" width={22} height={22} unoptimized />
            <span>EXEC</span>
          </span>
        </span>

        <span className="nce-write__spacer" aria-hidden="true" />

        {stopChoice ? (
          <button
            type="button"
            className="nce-tool"
            data-tone="stop"
            aria-label={t(locale, "composer.stop")}
            title={t(locale, "composer.stop")}
            onClick={() => onStop(String((stopChoice as { id?: string }).id ?? ""))}
          >
            <Icon name="stop" className="nce-tool__face" title={t(locale, "composer.stop")} />
          </button>
        ) : null}

        <button
          type="button"
          className="nce-tool"
          data-tone="primary"
          disabled={!canSend}
          aria-label={t(locale, pending ? "conversation.pending" : "composer.send.tip")}
          title={t(locale, pending ? "conversation.pending" : "composer.send.tip")}
          onClick={onSend}
        >
          <Icon name="send" className="nce-tool__face" title={t(locale, "composer.send.tip")} />
        </button>
      </div>
    </div>
  );
}
