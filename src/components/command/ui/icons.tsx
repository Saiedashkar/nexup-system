/**
 * NEXUP COMMAND — inline icon set.
 *
 * Hand-rolled on purpose: `lucide-react` is referenced in next.config's
 * optimizePackageImports but is NOT an installed dependency, and Phase UI-01
 * ships with zero new packages. These are 24×24 stroke icons on `currentColor`.
 */

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function svg(path: React.ReactNode, { size = 18, className, strokeWidth = 1.6 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

/* ── Global navigation ─────────────────────────────────────────────────── */

export const IconCommand = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 1.6v2.6M12 19.8v2.6M1.6 12h2.6M19.8 12h2.6" />
    </>,
    p,
  );

export const IconWork = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="3.2" y="4" width="17.6" height="16" rx="3" />
      <path d="M7.6 9.4l1.9 1.9 3.4-3.6M7.6 15.6h8.8" />
    </>,
    p,
  );

export const IconWorkforce = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="9.4" cy="8.6" r="3.1" />
      <path d="M3.6 19.4c0-3.2 2.6-5.5 5.8-5.5s5.8 2.3 5.8 5.5" />
      <path d="M16.2 6.1a3.1 3.1 0 0 1 0 5.9M17.6 14.4c2.1.6 3.4 2.4 3.4 4.6" />
    </>,
    p,
  );

export const IconSystems = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="5.4" r="2.6" />
      <circle cx="5.4" cy="17.4" r="2.6" />
      <circle cx="18.6" cy="17.4" r="2.6" />
      <path d="M10.6 7.6L6.8 15.2M13.4 7.6l3.8 7.6M8 17.4h8" />
    </>,
    p,
  );

export const IconCapabilities = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M12 2.6l1.9 5.4 5.5 1.9-5.5 1.9-1.9 5.4-1.9-5.4L4.6 9.9l5.5-1.9z" />
      <path d="M18.6 16.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>,
    p,
  );

export const IconControl = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4 7.2h16M4 12h16M4 16.8h16" />
      <circle cx="9" cy="7.2" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="7.6" cy="16.8" r="1.9" fill="currentColor" stroke="none" />
    </>,
    p,
  );

/* ── Command surfaces ──────────────────────────────────────────────────── */

export const IconSpark = (p: IconProps = {}) =>
  svg(<path d="M12 3.4l2.1 6.1 6.1 2.1-6.1 2.1L12 20l-2.1-6.4-6.1-2.1 6.1-2.1z" />, p);

export const IconMic = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="9" y="2.6" width="6" height="11.2" rx="3" />
      <path d="M5.4 11.6a6.6 6.6 0 0 0 13.2 0M12 18.2v3.2" />
    </>,
    p,
  );

export const IconSend = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4.4 11.6L20 4.4l-7.2 15.6-2.1-6.3z" />
      <path d="M10.7 13.7L20 4.4" />
    </>,
    p,
  );

export const IconChevronUp = (p: IconProps = {}) => svg(<path d="M6.6 14.6L12 9.2l5.4 5.4" />, p);
export const IconChevronDown = (p: IconProps = {}) => svg(<path d="M6.6 9.4L12 14.8l5.4-5.4" />, p);
export const IconChevronRight = (p: IconProps = {}) => svg(<path d="M9.4 6.6l5.4 5.4-5.4 5.4" />, p);
export const IconArrowLeft = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M19 12H5.4" />
      <path d="M11 5.6L4.6 12l6.4 6.4" />
    </>,
    p,
  );
export const IconClose = (p: IconProps = {}) => svg(<path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8" />, p);
export const IconPlus = (p: IconProps = {}) => svg(<path d="M12 5.4v13.2M5.4 12h13.2" />, p);

/* ── Quick actions ─────────────────────────────────────────────────────── */

export const IconProject = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M3.4 7.6a2.4 2.4 0 0 1 2.4-2.4h3.1l1.7 2.2h7.6a2.4 2.4 0 0 1 2.4 2.4v8a2.4 2.4 0 0 1-2.4 2.4H5.8a2.4 2.4 0 0 1-2.4-2.4z" />
      <path d="M12 11.4v5M9.5 13.9h5" />
    </>,
    p,
  );

export const IconWarRoom = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M12 3.2l7.4 3v6.1c0 4.2-3 7.3-7.4 8.5-4.4-1.2-7.4-4.3-7.4-8.5V6.2z" />
      <path d="M12 8.4l1.1 2.6 2.6 1.1-2.6 1.1L12 15.8l-1.1-2.6-2.6-1.1 2.6-1.1z" />
    </>,
    p,
  );

export const IconRun = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M10.2 8.6l5.4 3.4-5.4 3.4z" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const IconCallTeam = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4.2 5.6a1.6 1.6 0 0 1 1.6-1.6h3l1.5 3.6-1.9 1.5a10 10 0 0 0 4.9 4.9l1.5-1.9 3.6 1.5v3a1.6 1.6 0 0 1-1.6 1.6C10 19 4.9 13.9 4.2 5.6z" />
    </>,
    p,
  );

export const IconTool = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M14.4 6.6a3.6 3.6 0 0 0 4.9 4.7l-8.6 8.6a2.1 2.1 0 0 1-3-3z" />
      <path d="M17.4 3.6l2.9 2.9-2.3 2.3-2.9-2.9z" />
    </>,
    p,
  );

export const IconWorkflow = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="6.4" cy="6" r="2.4" />
      <circle cx="6.4" cy="18" r="2.4" />
      <circle cx="18" cy="12" r="2.4" />
      <path d="M6.4 8.4v7.2M8.8 6.6h4.6a2.2 2.2 0 0 1 2.2 2.2v1.4M8.8 17.4h4.6a2.2 2.2 0 0 0 2.2-2.2v-1.4" />
    </>,
    p,
  );

export const IconMore = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="5.6" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const IconPanel = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="3" />
      <path d="M14.6 4.4v15.2" />
    </>,
    p,
  );

/* ── Top band & rail chrome ────────────────────────────────────────────── */

export const IconBell = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M12 3.4a5.4 5.4 0 0 1 5.4 5.4c0 4 1.4 5.4 1.4 5.4H5.2s1.4-1.4 1.4-5.4A5.4 5.4 0 0 1 12 3.4z" />
      <path d="M10.2 17.4a2 2 0 0 0 3.6 0" />
    </>,
    p,
  );

export const IconGear = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 3.2v2.2M12 18.6v2.2M4.8 7.6l1.9 1.1M17.3 15.3l1.9 1.1M4.8 16.4l1.9-1.1M17.3 8.7l1.9-1.1" />
    </>,
    p,
  );

export const IconWaveform = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4 10.4v3.2M7.4 7.6v8.8M10.8 4.8v14.4M14.2 8.4v7.2M17.6 10.8v2.4M21 11.6v.8" />
    </>,
    p,
  );

export const IconCreate = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.4v7.2M8.4 12h7.2" />
    </>,
    p,
  );

export const IconList = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M8.6 6.6h11M8.6 12h11M8.6 17.4h11" />
      <circle cx="4.6" cy="6.6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="17.4" r="1.3" fill="currentColor" stroke="none" />
    </>,
    p,
  );

export const IconGraph = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="5.4" cy="6.4" r="2" />
      <circle cx="18.6" cy="6.4" r="2" />
      <circle cx="5.4" cy="17.6" r="2" />
      <circle cx="18.6" cy="17.6" r="2" />
      <path d="M10 10.2L7 8M14 10.2L17 8M10 13.8L7 16M14 13.8L17 16" />
    </>,
    p,
  );

export const IconMap = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M9.4 4.6L4.2 6.8v12.6l5.2-2.2 5.2 2.2 5.2-2.2V4.6l-5.2 2.2z" />
      <path d="M9.4 4.6v12.6M14.6 6.8v12.6" />
    </>,
    p,
  );

export const IconExpand = (p: IconProps = {}) =>
  svg(<path d="M4.6 9.6V4.6h5M19.4 14.4v5h-5M19.4 9.6v-5h-5M4.6 14.4v5h5" />, p);

export const IconCheck = (p: IconProps = {}) => svg(<path d="M5.2 12.6l4.4 4.4 9.2-10" />, p);

/* ── Department identity marks ─────────────────────────────────────────── */

export const IconDeptGrowth = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4.4 19.4h15.2" />
      <path d="M7.4 19.4v-6.2M12 19.4V8.6M16.6 19.4v-4" />
      <path d="M7.6 7.6l4-3.2 3.2 2.2 4.4-3.4" />
    </>,
    p,
  );

export const IconDeptClient = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="9.2" cy="8.4" r="3" />
      <path d="M3.6 19.2c0-3.1 2.5-5.3 5.6-5.3s5.6 2.2 5.6 5.3" />
      <path d="M16 5.9a3 3 0 0 1 0 5.7M17.4 14.2c1.9.6 3 2.3 3 4.4" />
    </>,
    p,
  );

export const IconDeptOperations = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M12 3.2l8 4-8 4-8-4z" />
      <path d="M4 12l8 4 8-4M4 16.6l8 4 8-4" />
    </>,
    p,
  );

export const IconDeptProduct = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M9 7.4L4.6 12l4.4 4.6M15 7.4l4.4 4.6-4.4 4.6" />
      <path d="M13.2 4.8l-2.4 14.4" />
    </>,
    p,
  );

export const IconDeptFinance = (p: IconProps = {}) =>
  svg(
    <>
      <ellipse cx="12" cy="6.4" rx="7.4" ry="3" />
      <path d="M4.6 6.4v11.2c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3V6.4" />
      <path d="M4.6 12c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3" />
    </>,
    p,
  );

/** Keyed lookup so department data stays serialisable (no component refs). */
export const DEPARTMENT_ICONS = {
  growth: IconDeptGrowth,
  client: IconDeptClient,
  operations: IconDeptOperations,
  product: IconDeptProduct,
  finance: IconDeptFinance,
} as const;
