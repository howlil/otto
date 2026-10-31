import type { SVGProps } from "react";

// One icon set for the whole app. Individual features used to carry their own
// copies; the paths below are the ones approved in design/home.html and
// design/agent.html, so a new surface reuses them instead of redrawing.
export type IconName =
  | "settings"
  | "back"
  | "camera"
  | "send"
  | "stop"
  | "copy"
  | "folder"
  | "alert";

const paths: Record<IconName, React.ReactNode> = {
  settings: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.8v2m0 12.4v2M20.2 12h-2M5.8 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4m0-8.8 1.4 1.4m8.8 8.8-1.4-1.4" />
    </>
  ),
  back: <path d="m15 18-6-6 6-6" />,
  camera: (
    <>
      <path d="M3 7h4l2-2h6l2 2h4v12H3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  alert: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4m0 3v.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.7,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  "name"
>) {
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
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
