import {
  Camera,
  ChevronLeft,
  CircleAlert,
  Copy,
  Folder,
  Send,
  Settings,
  Square,
  Terminal,
  TriangleAlert,
  type LucideProps,
} from "lucide-react";

// Real icon set, not hand-drawn paths. lucide-react is pinned by the lockfile
// and supports React 19. The mapping is the only place that names an icon, so
// a surface asks for a role ("alert"), not for a vendor component.
const icons = {
  settings: Settings,
  back: ChevronLeft,
  camera: Camera,
  send: Send,
  stop: Square,
  copy: Copy,
  folder: Folder,
  alert: TriangleAlert,
  unavailable: CircleAlert,
  terminal: Terminal,
} as const;

export type IconName = keyof typeof icons;

// Icons are decorative by default: the accessible name belongs to the control
// that wraps them (see VisuallyHidden / IconButton), never to the glyph.
export function Icon({ name, size, ...rest }: { name: IconName; size?: number } & LucideProps) {
  const Glyph = icons[name];
  return <Glyph size={size ?? 16} strokeWidth={1.7} aria-hidden focusable="false" {...rest} />;
}
