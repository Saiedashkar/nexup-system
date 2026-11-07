"use client";

import { useState } from "react";
import { useLocale } from "./i18n/command-locale";
import { useCommand } from "./state/command-store";
import { interpret, type MockInterpretation } from "./state/mock-intent";
import { BUSINESS_SCOPES, cycleScope, useScopeIndex } from "./state/business-scope";
import {
  IconChevronDown,
  IconChevronRight,
  IconMic,
  IconSpark,
  IconWaveform,
} from "./ui/icons";
import { EXEC_CHARACTER_HEAD } from "./state/exec-character";

/**
 * Global Command Bar.
 *
 * The affordances are real (focus, keyboard, mode cycling, voice toggle) but
 * the intelligence is not: submitting produces a *locally computed* mock
 * interpretation so the interaction language can be reviewed without an AI
 * provider. Everything the mock assumes is labelled as an assumption.
 */

const MODEL_POLICIES = ["AUTO", "FAST", "DEEP", "CODE"] as const;

export function GlobalCommandBar({ home = false }: { home?: boolean }) {
  const { notify } = useCommand();
  const { t, tc } = useLocale();
  const [value, setValue] = useState("");
  const [policy, setPolicy] = useState(0);
  const [listening, setListening] = useState(false);
  /* The scope is NOT local state: it comes from the one shared store, so this
     control and the Command home's heading can never show two different scopes. */
  const scope = useScopeIndex();
  const [result, setResult] = useState<{ input: string; mock: MockInterpretation } | null>(null);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setResult({ input: text, mock: interpret(text) });
    setValue("");
  };

  return (
    <section className="nc-cmdbar" data-home={home || undefined} aria-label={t("shell.commandBarAria")}>
      <div className="nc-cmdbar__shell" data-listening={listening}>
        <span className="nc-cmdbar__glyph">
          <IconSpark size={18} />
        </span>

        {/* The home composer names the executive it is addressed to, exactly as
            the reference does. The shell toolbar does not: it is addressed to the
            organization, and a second EXEC chip there would compete with the
            console. */}
        {home && (
          <span className="nc-cmdbar__exec" aria-hidden="true">
            <img src={EXEC_CHARACTER_HEAD} width={20} height={20} alt="" decoding="async" />
            <b>{t("cc.execEntry")}</b>
            <IconChevronDown size={12} />
          </span>
        )}

        <input
          className="nc-cmdbar__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={t("shell.commandPlaceholder")}
          aria-label={t("shell.commandPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />

        <span className="nc-cmdbar__wave" aria-hidden="true">
          <IconWaveform size={18} />
        </span>

        <button
          type="button"
          className="nc-cmdbar__voice"
          data-listening={listening}
          onClick={() => {
            setListening((v) => !v);
            notify(t("shell.commandVoiceToast"));
          }}
          aria-pressed={listening}
          aria-label={t("shell.commandVoiceAria")}
          title={t("shell.commandVoiceAria")}
        >
          <IconMic size={17} />
        </button>

        <button
          type="button"
          className="nc-cmdbar__chip nc-cmdbar__chip--mode"
          onClick={() => setPolicy((p) => (p + 1) % MODEL_POLICIES.length)}
          title={t("shell.commandModeTitle")}
        >
          <b>{MODEL_POLICIES[policy]}</b>
          <IconChevronDown size={14} />
        </button>

        <button
          type="button"
          className="nc-cmdbar__scope"
          onClick={() => {
            const next = cycleScope();
            notify(
              t("shell.scopeToast", {
                scope: next === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[next],
              }),
            );
          }}
          title={t("shell.commandScopeTitle")}
          aria-describedby="nc-scope-limitation"
        >
          {/* The scope chip: the business names are identifiers and stay as they
              are; the generic first option is copy and is translated. */}
          {scope === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[scope]}
          <IconChevronDown size={14} />
        </button>

        <button
          type="button"
          className="nc-cmdbar__send"
          onClick={submit}
          disabled={!value.trim()}
          aria-label={t("shell.commandSubmit")}
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      {/* THE SCOPE'S LIMITATION, SAID ONCE AND PERMANENTLY.
          The company selector is a demonstration control: it changes the label
          in the heading and the bar, and it does NOT filter a single record.
          A toast said so for three seconds; a reader who arrived after it faded
          saw a selector that looked like business isolation. This line sits
          beside the control in both languages so the limitation is part of the
          interface, not a transient announcement. */}
      <p className="nc-cmdbar__scope-note" id="nc-scope-limitation">
        {t("shell.scopeLimitation")}
      </p>

      {result && (
        <div className="nc-cmdbar__result">
          <div className="nc-cmdbar__quote">“{result.input}”</div>
          <div className="nc-cmdbar__tags">
            <span className="nc-cmdbar__tag">
              {t("shell.commandIntentTag")} · {t(result.mock.intent)}
            </span>
            <span className="nc-cmdbar__tag">
              {t("shell.commandRoutesTag")} · {t(result.mock.target)}
            </span>
            <span className="nc-cmdbar__tag">
              {t("shell.commandAuthorityTag")} · {t(result.mock.authority)}
            </span>
            <span className="nc-cmdbar__tag" data-mock="true">
              {t("shell.commandMockTag")}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
