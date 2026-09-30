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
import type { DepartmentId } from "./organization-model";
import {
  buildSnapshot,
  DEFAULT_SCENARIO_ID,
  SCENARIO_ORDER,
  type CommandVisualSnapshot,
  type DemoScenarioId,
} from "./demo-scenarios";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * NEXUP COMMAND — client store (Phase UI-01)
 * ───────────────────────────────────────────
 * Local, mocked, and deliberately shallow: one scenario id in, one derived
 * visual snapshot out. There is no network call, no provider SDK and no
 * business state here — only *which* visual story we are currently telling.
 *
 * `IS_DEV` gates the Motion Lab. It is inlined at build time, so the whole
 * controller tree-shakes out of a production bundle.
 */
export const IS_DEV = process.env.NODE_ENV !== "production";

export type MotionMode = "full" | "reduced";

type CommandContextValue = {
  /* scenario → visual snapshot */
  scenario: DemoScenarioId;
  snapshot: CommandVisualSnapshot;
  revision: number;
  selectScenario: (id: DemoScenarioId) => void;
  replay: () => void;

  /* contextual zoom */
  focus: DepartmentId | null;
  focusDepartment: (id: DepartmentId) => void;
  clearFocus: () => void;

  /* dock / surface state */
  execOpen: boolean;
  setExecOpen: (open: boolean) => void;
  rightCollapsed: boolean;
  toggleRight: () => void;

  /* motion controls */
  motionMode: MotionMode;
  setMotionMode: (mode: MotionMode) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  autoCycle: boolean;
  setAutoCycle: (on: boolean) => void;
  osReducedMotion: boolean;

  /* mocked feedback */
  toast: string | null;
  notify: (message: string) => void;
};

const CommandContext = createContext<CommandContextValue | null>(null);

export function useCommand(): CommandContextValue {
  const ctx = useContext(CommandContext);
  if (!ctx) throw new Error("useCommand must be used inside <CommandProvider>");
  return ctx;
}

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [scenario, setScenario] = useState<DemoScenarioId>(DEFAULT_SCENARIO_ID);
  const [revision, setRevision] = useState(1);
  const [focus, setFocus] = useState<DepartmentId | null>(null);
  const [execOpen, setExecOpen] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [motionMode, setMotionMode] = useState<MotionMode>("full");
  const [speed, setSpeed] = useState(1);
  const [autoCycle, setAutoCycle] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const osReducedMotion = usePrefersReducedMotion();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshot = useMemo(() => buildSnapshot(scenario, revision), [scenario, revision]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, []);

  const selectScenario = useCallback((id: DemoScenarioId) => {
    setScenario(id);
    setRevision((r) => r + 1);
  }, []);

  const replay = useCallback(() => setRevision((r) => r + 1), []);

  const focusDepartment = useCallback((id: DepartmentId) => setFocus(id), []);
  const clearFocus = useCallback(() => setFocus(null), []);
  const toggleRight = useCallback(() => setRightCollapsed((v) => !v), []);

  /* Escape backs out one level: surface first, then the zoomed department. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (execOpen) setExecOpen(false);
        else if (focus) setFocus(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setExecOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [execOpen, focus]);

  /* Dev-only auto-cycle so a reviewer can watch scenarios back to back. */
  useEffect(() => {
    if (!IS_DEV || !autoCycle) return;
    const id = setInterval(() => {
      setScenario((current) => {
        const index = SCENARIO_ORDER.indexOf(current);
        return SCENARIO_ORDER[(index + 1) % SCENARIO_ORDER.length];
      });
      setRevision((r) => r + 1);
    }, 4200);
    return () => clearInterval(id);
  }, [autoCycle]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const value: CommandContextValue = {
    scenario,
    snapshot,
    revision,
    selectScenario,
    replay,
    focus,
    focusDepartment,
    clearFocus,
    execOpen,
    setExecOpen,
    rightCollapsed,
    toggleRight,
    motionMode,
    setMotionMode,
    speed,
    setSpeed,
    autoCycle,
    setAutoCycle,
    osReducedMotion,
    toast,
    notify,
  };

  /* The toast itself is rendered by <CommandShell>, inside the token scope. */
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}
