/**
 * NEXUP COMMAND — LOCALE CONTRACT (Pass 2)
 * ────────────────────────────────────────
 * The whole of the Command product's bilingual behaviour is decided here and in
 * `messages.ts`. Nothing else in the tree is allowed to hold a second notion of
 * language, direction, or number formatting.
 *
 * WHY IT LIVES INSIDE `/command` AND NOT AT THE APP ROOT
 * The legacy NEXUP application is Arabic and RTL at the document level
 * (`<html lang="ar" dir="rtl">`). COMMAND is an LTR-first operating surface
 * inside that document. It must therefore carry its OWN `dir`/`lang` on its own
 * root element and must never touch `<html>` — otherwise switching COMMAND to
 * Arabic would flip the legacy app's layout underneath the same session.
 *
 * THE CONTRACT (what Agent Studio can rely on):
 *   · `Locale` is exactly `"en" | "ar"`. No other value is representable.
 *   · The selected locale is persisted as a first-party COOKIE
 *     (`LOCALE_COOKIE`), so the server can read it before it renders and the
 *     first paint is already in the right language and direction. It defaults
 *     to English on first visit, when no cookie exists.
 *   · Direction is a pure function of locale: `dirFor("ar") === "rtl"`.
 *   · Switching locale changes NO application state: the route, the selected
 *     scope (`focus`), the demo read state and the in-session mutations all live
 *     in stores that this module never reads or writes. A language switch is a
 *     re-render, never a navigation.
 *   · Numbers and dates are formatted through `locale.ts` helpers so an
 *     identifier is never reformatted by accident (see `formatNumber`).
 */

export type Locale = "en" | "ar";

/** Every locale the product supports, in switcher order. */
export const LOCALES: Locale[] = ["en", "ar"];

/**
 * The persisted key. One key, one value, one mechanism.
 *
 * IT IS A COOKIE, NOT `localStorage`, AND THAT IS THE WHOLE POINT.
 * The language used to live only in `localStorage`, which the server cannot
 * read: a returning Arabic reader got an English, LTR document and watched it
 * flip after hydration. A cookie travels with the request, so the layout reads
 * it server-side and renders Arabic into the first byte — no flash, no
 * suppression, no placeholder screen.
 */
export const LOCALE_COOKIE = "nexup.command.locale";

/** One year. A language preference is not session state. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The locale used on the server and before a stored preference is read. */
export const DEFAULT_LOCALE: Locale = "en";

/** Display names, each written in its OWN language — never translated. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
};

/** Full BCP-47 tags for `Intl`. Arabic is pinned to Latin digits on purpose. */
export const LOCALE_TAG: Record<Locale, string> = {
  /* `-u-nu-latn` keeps Western digits in Arabic. A control room reads model ids,
     mission codes, percentages and quotas side by side; Arabic-Indic digits
     would make `0.9.2` and `MIS-2041` harder to scan, and identifiers must not
     change shape with language. */
  en: "en-GB",
  ar: "ar-EG-u-nu-latn",
};

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ar";
}

/** The next locale in switcher order — the one a toggle moves to. */
export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "ar" : "en";
}

/**
 * Parse a raw cookie value into a locale.
 *
 * Unknown, empty and `undefined` all fall back to the default rather than
 * throwing: a stale or hand-edited cookie must never break a page. This is the
 * function both the server layout and the client write path agree on.
 */
export function localeFromCookie(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Persist the preference. Never throws: a blocked cookie jar is not a failure.
 *
 * `path=/` so the value is sent with every Command request; `SameSite=Lax` so a
 * cross-site navigation cannot set it while normal same-site entry still sends
 * it. It carries no identity and no secret — only `en` or `ar`.
 */
export function writeStoredLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* Cookies may be unavailable (blocked origin, embedded context). The
       in-memory locale still applies for this session, which is the honest
       degradation — the preference simply does not survive a reload. */
  }
}

/* ── Formatting ────────────────────────────────────────────────────────── */

/**
 * Format a figure for display. Grouping and separators follow the locale, but
 * the DIGITS stay Western in both languages (see `LOCALE_TAG`).
 */
export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale]).format(value);
}

/** Format a clock label. */
export function formatTime(locale: Locale, date: Date = new Date()): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Format a calendar date. */
export function formatDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Wrap a Latin identifier (a mission code, a model id, a provider name, an
 * accent-bearing token) so it is isolated from surrounding Arabic text and reads
 * left-to-right even inside an RTL paragraph. The characters used are the
 * standard Unicode LRI/PDI isolates, which is the correct fix for mixed
 * direction text — not a directional override.
 */
export function isolate(text: string): string {
  return `\u2066${text}\u2069`;
}
