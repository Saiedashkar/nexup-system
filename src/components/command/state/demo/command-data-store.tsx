"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale } from "../../i18n/command-locale";
import { applyDecision, applyTurn, commandAdapter, type DemoState } from "./adapter";
import type { CommandDataset, ExecTurn } from "./types";

/**
 * NEXUP COMMAND — PRODUCT LAB DATA STORE
 * ──────────────────────────────────────
 * The ONLY place the UI talks to an adapter. It owns four things and nothing
 * else: the current read state, the dataset, the demo-state switch, and the two
 * local mutations the prototype needs (settle a decision, talk to EXEC).
 *
 * Step 6 replaces `commandAdapter` in `adapter.ts` and this file does not change.
 *
 * NOTHING HERE IS REAL. There is no fetch, no scheduler, no model and no write
 * path to any system. The mutations mutate a local object graph, and the UI says
 * so wherever a reader could otherwise be misled.
 *
 * READ STATE, DELIBERATELY DERIVED: the current read is identified by a key
 * (`demoState#revision`). `state` is `loading` whenever the stored result does
 * not match the current key — so entering the loading state is a consequence of
 * the key changing, not something an effect has to push. Only the resolved read
 * sets state, and it does so from a promise callback.
 */

export type ReadState = "loading" | "ready" | "empty" | "degraded" | "error";

export type CommandDataValue = {
  state: ReadState;
  dataset: CommandDataset | null;
  warning: string | null;
  error: string | null;
  /** The demo state the reviewer selected (ready · loading · empty · degraded). */
  demoState: DemoState;
  setDemoState: (state: DemoState) => void;
  reload: () => void;
  /** Local only: settles a decision and appends the audit event. */
  decide: (decisionId: string, outcome: "approved" | "rejected", note?: string) => void;
  /** Local only: sends a line to EXEC and appends its deterministic reply. */
  sendToExec: (text: string) => void;
  execThinking: boolean;
  resetConversation: () => void;
};

type ReadResult = {
  key: string;
  state: ReadState;
  dataset: CommandDataset | null;
  warning: string | null;
  error: string | null;
};

/** An in-memory mutation applied on top of the last completed read. */
type LocalEdit = { key: string; dataset: CommandDataset };

const READ_DELAY_NOTE = "Reading the organization";

function useCommandDataState(): CommandDataValue {
  /* The adapter composes its own answers from dictionary keys, so it is handed
     the live translator: an Arabic reader asking an Arabic question gets an
     Arabic answer to the same branch. */
  const { t } = useLocale();
  const [demoState, setDemoState] = useState<DemoState>("ready");
  const [revision, setRevision] = useState(1);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [local, setLocal] = useState<LocalEdit | null>(null);
  const [execThinking, setExecThinking] = useState(false);
  const turnIndex = useRef(0);

  /* The identity of the read in flight. When it changes, `state` below reports
     `loading` immediately — no effect, no cascading render. */
  const key = `${demoState}#${revision}`;

  useEffect(() => {
    let cancelled = false;

    commandAdapter
      .read(demoState)
      .then((result) => {
        if (cancelled) return;
        setRead({
          key,
          state: result.state,
          dataset: result.dataset,
          warning: result.warning ?? null,
          error: null,
        });
        /* A fresh read replaces any local edits made against the previous one. */
        setLocal(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setRead({
          key,
          state: "error",
          dataset: null,
          warning: null,
          error: cause instanceof Error ? cause.message : "The read failed.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key, demoState]);

  const current = read && read.key === key ? read : null;
  const state: ReadState = current ? current.state : "loading";
  const dataset = local && local.key === key ? local.dataset : (current?.dataset ?? null);

  const reload = useCallback(() => setRevision((r) => r + 1), []);

  const edit = useCallback(
    (next: (current: CommandDataset) => CommandDataset) => {
      if (!dataset) return;
      setLocal({ key, dataset: next(dataset) });
    },
    [dataset, key],
  );

  const decide = useCallback(
    (decisionId: string, outcome: "approved" | "rejected", note?: string) => {
      edit((currentDataset) => {
        try {
          const { decision, event } = commandAdapter.decide(
            currentDataset,
            decisionId,
            outcome,
            note,
            t,
          );
          return applyDecision(currentDataset, decision, event);
        } catch {
          /* An unknown id is a no-op rather than a crash: the prototype cannot be
             broken by a stale link. */
          return currentDataset;
        }
      });
    },
    [edit, t],
  );

  const sendToExec = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      turnIndex.current += 1;
      const founderTurn: ExecTurn = {
        id: `f-${turnIndex.current}`,
        from: "founder",
        at: "now",
        kind: "text",
        text: trimmed,
        cards: [],
        actions: [],
      };

      edit((currentDataset) => applyTurn(currentDataset, founderTurn));

      /* A short, deliberate pause before the reply: the surface has to be able to
         show that the executive is composing, and a prototype that answers in the
         same frame cannot demonstrate that state honestly. */
      setExecThinking(true);
      setTimeout(() => {
        setLocal((existing) => {
          if (!existing) return existing;
          return {
            key: existing.key,
            dataset: applyTurn(existing.dataset, commandAdapter.reply(existing.dataset, text, t)),
          };
        });
        setExecThinking(false);
      }, 520);
    },
    [edit, t],
  );

  const resetConversation = useCallback(() => {
    turnIndex.current = 0;
    setRevision((r) => r + 1);
  }, []);

  return useMemo<CommandDataValue>(
    () => ({
      state,
      dataset,
      warning: current?.warning ?? null,
      error: current?.error ?? null,
      demoState,
      setDemoState,
      reload,
      decide,
      sendToExec,
      execThinking,
      resetConversation,
    }),
    [state, dataset, current, demoState, reload, decide, sendToExec, execThinking, resetConversation],
  );
}

/** Exported so a surface can name its own read state without importing copy. */
export const READ_LABEL = READ_DELAY_NOTE;

const CommandDataContext = createContext<CommandDataValue | null>(null);

export function useCommandData(): CommandDataValue {
  const ctx = useContext(CommandDataContext);
  if (!ctx) throw new Error("useCommandData must be used inside <CommandDataProvider>");
  return ctx;
}

/**
 * Provider. Mounted INSIDE `CommandProvider` (the shell's store) so a mutation
 * here can reuse the shell's single toast surface rather than inventing a second
 * one.
 */
export function CommandDataProvider({ children }: { children: React.ReactNode }) {
  const value = useCommandDataState();
  return <CommandDataContext.Provider value={value}>{children}</CommandDataContext.Provider>;
}
