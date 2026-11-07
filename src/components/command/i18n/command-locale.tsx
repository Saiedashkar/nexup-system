"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_LABEL,
  dirFor,
  formatDate,
  formatNumber,
  formatTime,
  writeStoredLocale,
  type Locale,
} from "./locale";
import { DICTIONARIES, type Messages } from "./messages";
import { translateContent } from "./content";

/**
 * NEXUP COMMAND — LOCALE PROVIDER (Pass 2)
 * ───────────────────────────────────────
 * The one place a component asks "what language are we in, and what does this
 * sentence say". It is mounted once, inside the `/command` layout, and it owns
 * exactly two things: the current locale and the persisted preference.
 *
 * IT DELIBERATELY OWNS NO OTHER STATE. It does not know the route, the focused
 * department or the demo read state, which is precisely why switching language
 * cannot disturb them — there is no code path from here to there.
 *
 * FIRST PAINT: the server resolves the language from the `LOCALE_COOKIE`
 * before it renders, and passes it in as `initialLocale`. The provider starts
 * from that value, so the HTML the browser receives and the tree React hydrates
 * are the SAME language and direction — a returning Arabic reader sees Arabic,
 * RTL, in the first paint. There is no mount effect, no post-hydration flip and
 * no blank screen to hide the mismatch, because there is no mismatch to hide.
 *
 * The language is React state, not module state, for a second reason: a
 * module-level variable would be shared by every request in the server process,
 * so one Arabic visitor could make the next English visitor's HTML Arabic. The
 * value is per-request on the server and per-tab on the client, which is exactly
 * what a language preference is.
 */

/* ── Key types: every path to a string leaf, dotted ───────────────────── */

type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every translatable key. Passing anything else is a compile error. */
export type MessageKey = Paths<Messages>;

export type LocaleValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  isRtl: boolean;
  setLocale: (locale: Locale) => void;
  /** Move to the other supported locale — what a toggle control calls. */
  toggleLocale: () => void;
  /** Translate a key, interpolating `{name}` placeholders. */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /**
   * Translate a DEMO CONTENT string (a mission title, a decision question, an
   * activity sentence). The English source is the key; unknown strings fall
   * through unchanged. See `content.ts` for why content is not key-based.
   */
  tc: (source: string) => string;
  /** Format a figure with locale grouping and Western digits in both languages. */
  formatNumber: (value: number) => string;
  formatTime: (date?: Date) => string;
  formatDate: (date: Date) => string;
};

const LocaleContext = createContext<LocaleValue | null>(null);

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <CommandLocaleProvider>");
  return ctx;
}

/** Convenience for the common case: the translator alone. */
export function useT() {
  return useLocale().t;
}

function resolve(dictionary: Messages, key: string): string {
  const parts = key.split(".");
  let node: unknown = dictionary;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      /* A missing key is a build-time problem (the types forbid it). If one ever
         reaches runtime — a stale bundle — showing the key is more useful than
         showing nothing, and it is honest about what happened. */
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Build a translator over any dictionary.
 *
 * The provider uses it for the active language; a module that composes text
 * OUTSIDE React — the demo adapter assembling an Executive reply, for instance —
 * uses it with the English source of truth so its default output stays English
 * while a component can still pass the live `t` in. One implementation, so a
 * composed sentence cannot drift from a keyed one.
 */
export function createTranslator(dictionary: Messages): LocaleValue["t"] {
  return (key, vars) => interpolate(resolve(dictionary, key), vars);
}

/* ── The locale, as provider state seeded by the server ───────────────────
   `initialLocale` is resolved ONCE, on the server, from the request's cookie
   (see `app/command/layout.tsx`). Seeding `useState` with it is what makes the
   server HTML and the hydrating client tree agree without a suppression flag or
   an effect: React's first client state IS the server's value.

   Nothing else is in here. The provider knows the language and nothing about the
   route, the scope or the demo state — which is why switching language is
   structurally incapable of resetting them. */

export function CommandLocaleProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  /** Resolved server-side from the locale cookie. */
  initialLocale?: Locale;
  /* Optional so a caller may render the provider as a bare element (and the
     server-render test can pass its child positionally, the way the layout
     does). A provider with no children is an empty tree, not an error. */
  children?: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    /* The cookie is written here, in the event that changes the language, so
       the NEXT request — a reload, a new tab, a direct department URL — is
       rendered in this language from the server. `localStorage` is gone: one
       mechanism, and it is one the server can read. */
    writeStoredLocale(next);
  }, []);

  const value = useMemo<LocaleValue>(() => {
    const dictionary = DICTIONARIES[locale];
    return {
      locale,
      dir: dirFor(locale),
      isRtl: locale === "ar",
      setLocale,
      toggleLocale: () => setLocale(locale === "en" ? "ar" : "en"),
      t: createTranslator(dictionary),
      tc: (source) => translateContent(locale, source),
      formatNumber: (n) => formatNumber(locale, n),
      formatTime: (date) => formatTime(locale, date),
      formatDate: (date) => formatDate(locale, date),
    };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The display name of a locale, written in its own language. */
export function localeLabel(locale: Locale): string {
  return LOCALE_LABEL[locale];
}

/**
 * Translate a key in a NAMED locale, independent of the current render.
 *
 * A language switch needs this: the click handler still closes over the old
 * translator, so composing its confirmation with `t(...)` produced a toast in
 * the language the reader had just left. One lookup in the target dictionary
 * makes the confirmation agree with the state the click created.
 */
export function translateFor(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return createTranslator(DICTIONARIES[locale])(key, vars);
}

/**
 * The honest state word for a MODELLED system, derived from its own
 * `statusKind` rather than from a word that claims a live integration.
 *
 * Priority 3 in one function: a prototype may describe what something is FOR,
 * but "Online", "Running" and "Connected" are claims about a live link nobody
 * has verified. Every surface that used to print one of those words now prints
 * one of these two instead, and the original word is kept as the tooltip.
 */
export function systemStateLabel(
  t: LocaleValue["t"],
  statusKind: string | undefined,
): string {
  return statusKind === "development"
    ? t("provenance.inDevelopment")
    : t("provenance.notConnected");
}
