"use client";

import { LOCALES, type Locale } from "../i18n/locale";
import { localeLabel, useLocale } from "../i18n/command-locale";

/**
 * LANGUAGE SWITCH (Pass 2)
 * ───────────────────────
 * One persistent, keyboard-reachable control that moves the entire Command
 * product between العربية and English. It deliberately is NOT a dropdown: two
 * options, both always visible, each labelled in its own language — Arabic
 * readers should never have to find "Arabic" written in English.
 *
 * Behaviour contract:
 *   · a real `radiogroup`, so arrow keys move between the two options;
 *   · `aria-checked` reflects the active locale;
 *   · selecting one persists it (via the provider) and changes nothing else —
 *     no navigation, no state reset;
 *   · the label announces the change through the shell's toast surface.
 */
export function LocaleSwitch({
  variant = "rail",
  labels = "full",
  onChanged,
}: {
  /** `rail` is the desktop rail footer; `bar` is the phone shell. */
  variant?: "rail" | "bar";
  /** `code` shows AR/EN, as the approved home header does. */
  labels?: "full" | "code";
  onChanged?: (locale: Locale, label: string) => void;
}) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      className="nc-locale"
      data-variant={variant}
      role="radiogroup"
      aria-label={t("shell.languageAria")}
    >
      <span className="nc-locale__label" aria-hidden="true">
        {t("shell.language")}
      </span>
      <span className="nc-locale__seg">
        {LOCALES.map((option) => {
          const active = option === locale;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              className="nc-locale__opt"
              data-active={active}
              lang={option}
              /* `dir` is set per option so the Arabic option reads RTL inside an
                 LTR rail and vice versa — the one place mixed direction is
                 unavoidable and exactly where it should be explicit. */
              dir={option === "ar" ? "rtl" : "ltr"}
              aria-label={localeLabel(option)}
              onClick={() => {
                if (active) return;
                setLocale(option);
                onChanged?.(option, localeLabel(option));
              }}
            >
              {labels === "code" ? option.toUpperCase() : localeLabel(option)}
            </button>
          );
        })}
      </span>
    </div>
  );
}
