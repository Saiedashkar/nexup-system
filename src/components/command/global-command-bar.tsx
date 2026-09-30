"use client";

import { useState } from "react";
import { useCommand } from "./state/command-store";
import { interpret, type MockInterpretation } from "./state/mock-intent";
import {
  IconChevronDown,
  IconChevronRight,
  IconMic,
  IconSpark,
  IconWaveform,
} from "./ui/icons";

/**
 * Global Command Bar.
 *
 * The affordances are real (focus, keyboard, mode cycling, voice toggle) but
 * the intelligence is not: submitting produces a *locally computed* mock
 * interpretation so the interaction language can be reviewed without an AI
 * provider. Everything the mock assumes is labelled as an assumption.
 */

const MODEL_POLICIES = ["AUTO", "FAST", "DEEP", "CODE"] as const;

export function GlobalCommandBar() {
  const { notify } = useCommand();
  const [value, setValue] = useState("");
  const [policy, setPolicy] = useState(0);
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<{ input: string; mock: MockInterpretation } | null>(null);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setResult({ input: text, mock: interpret(text) });
    setValue("");
  };

  return (
    <section className="nc-cmdbar" aria-label="Global command bar">
      <div className="nc-cmdbar__shell" data-listening={listening}>
        <span className="nc-cmdbar__glyph">
          <IconSpark size={18} />
        </span>

        <input
          className="nc-cmdbar__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder="Ask, command, or make it happen..."
          aria-label="Ask, command, or make it happen"
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
            notify("Voice is a placeholder in UI-01 — no audio is captured or processed.");
          }}
          aria-pressed={listening}
          aria-label="Voice input (mock)"
          title="Voice input (mock)"
        >
          <IconMic size={17} />
        </button>

        <button
          type="button"
          className="nc-cmdbar__chip nc-cmdbar__chip--mode"
          onClick={() => setPolicy((p) => (p + 1) % MODEL_POLICIES.length)}
          title="Model policy — mocked. A real Model Router arrives in a later phase."
        >
          <b>{MODEL_POLICIES[policy]}</b>
          <IconChevronDown size={14} />
        </button>

        <button
          type="button"
          className="nc-cmdbar__send"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Send"
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      {result && (
        <div className="nc-cmdbar__result">
          <div className="nc-cmdbar__quote">“{result.input}”</div>
          <div className="nc-cmdbar__tags">
            <span className="nc-cmdbar__tag">intent · {result.mock.intent}</span>
            <span className="nc-cmdbar__tag">routes to · {result.mock.target}</span>
            <span className="nc-cmdbar__tag">authority · {result.mock.authority}</span>
            <span className="nc-cmdbar__tag" data-mock="true">
              mocked interpretation · nothing executed
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
