/**
 * NEXUP COMMAND — EXEC EXPERIENCE · ICONS
 * ───────────────────────────────────────
 * The marks this surface draws. Before this file every icon was a CHARACTER —
 * `◆`, `▤`, `⌗`, `◈`, `＋` — which meant the weight, the size and the baseline of
 * the navigation were decided by whichever font happened to resolve, and the
 * Arabic and Latin stacks differ. At 13px that is what made the controls read as
 * small and weak next to their own labels.
 *
 * WHY HAND-DRAWN PATHS AND NOT A PACKAGE. The brief for this round forbids adding
 * a dependency, and the surface needs eleven marks. These are drawn on one 24px
 * grid with one stroke weight and one set of round joins, so they sit together as
 * a family — which is exactly what a mixed set of characters could not do.
 *
 * THEY INHERIT. Every icon takes `currentColor` for its stroke and `size` for its
 * box, so a control states its colour and its size once, on itself, and the mark
 * follows. Nothing here is decorative: each one is the label of a real control,
 * and every control that draws one still carries its own accessible name.
 */

export type IconName =
  /* navigation */
  | "exec"
  | "sessions"
  | "tools"
  | "settings"
  | "chat"
  /* the bar and the menus */
  | "live"
  | "menu"
  | "more"
  | "close"
  /* the composer */
  | "attach"
  | "mic"
  | "send"
  | "stop"
  | "chevron"
  /* content inside the conversation */
  | "doc"
  | "target"
  | "chart"
  | "person"
  | "copy"
  | "check"
  | "image";

const PATHS: Record<IconName, React.ReactNode> = {
  /* EXEC: the shield-hexagon the reference marks the room with, with its core. */
  exec: (
    <>
      <path d="M12 2.6 20 7.3v9.4L12 21.4 4 16.7V7.3z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  /* A session is a document: the reference uses the same mark in the rail, in the
     recent list and in Sessions itself, so one shape means one thing. */
  sessions: (
    <>
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  /* Tools: four tiles, as the reference draws them. */
  tools: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 0z" />
    </>
  ),
  chat: <path d="M20.5 12a7.5 7.5 0 0 1-11 6.6L4 20l1.5-5A7.5 7.5 0 1 1 20.5 12z" />,
  /* View live work: the reference's small connected graph — three nodes and the
     edges between them, which is what a run's steps actually are. */
  live: (
    <>
      <circle cx="12" cy="4.8" r="2.3" />
      <circle cx="5.4" cy="18.4" r="2.3" />
      <circle cx="18.6" cy="18.4" r="2.3" />
      <path d="M12 7.1v4.2M12 11.3 7.1 16.3M12 11.3l4.9 5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  attach: <path d="M20 12.5 12.3 20.2a4.6 4.6 0 0 1-6.5-6.5l7.7-7.7a3.1 3.1 0 0 1 4.4 4.4l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2l7-7" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="10" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  send: <path d="M12 19.5V5M6.2 10.8 12 5l5.8 5.8" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2.4" fill="currentColor" stroke="none" />,
  chevron: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  doc: (
    <>
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  chart: <path d="M6 19.5v-6.2M12 19.5V5.5M18 19.5v-9.4" />,
  person: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5 20.4a7 7 0 0 1 14 0" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.6" />
      <path d="M15 6.5V5.4A2.4 2.4 0 0 0 12.6 3H5.4A2.4 2.4 0 0 0 3 5.4v7.2A2.4 2.4 0 0 0 5.4 15h1.1" />
    </>
  ),
  check: <path d="M5.2 12.8 9.4 17 18.8 7" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
      <circle cx="8.6" cy="9.6" r="1.5" />
      <path d="M4 16.6 9.4 12l4.2 4 2.6-2.2 3.8 3.4" />
    </>
  ),
};

/**
 * One mark. `title` is only ever set when the icon is NOT inside a control that
 * already names itself — a labelled button would otherwise read its label twice.
 */
export function Icon({
  name,
  size = 20,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
