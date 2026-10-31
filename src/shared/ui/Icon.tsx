import {
  Camera,
  Check,
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

const icons = {
  settings: Settings,
  back: ChevronLeft,
  camera: Camera,
  send: Send,
  stop: Square,
  copy: Copy,
  check: Check,
  folder: Folder,
  alert: TriangleAlert,
  unavailable: CircleAlert,
  terminal: Terminal,
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name, size, ...rest }: { name: IconName; size?: number } & LucideProps) {
  const Glyph = icons[name];
  return <Glyph size={size ?? 16} strokeWidth={1.7} aria-hidden focusable="false" {...rest} />;
}
