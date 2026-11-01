import {
  Camera,
  Check,
  CircleCheck,
  ChevronLeft,
  CircleAlert,
  Copy,
  Folder,
  Plus,
  Send,
  Settings,
  Square,
  Terminal,
  TriangleAlert,
  X,
  type LucideProps,
} from "lucide-react";

const icons = {
  settings: Settings,
  back: ChevronLeft,
  close: X,
  camera: Camera,
  send: Send,
  stop: Square,
  copy: Copy,
  check: Check,
  completed: CircleCheck,
  folder: Folder,
  alert: TriangleAlert,
  unavailable: CircleAlert,
  terminal: Terminal,
  plus: Plus,
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name, size, ...rest }: { name: IconName; size?: number } & LucideProps) {
  const Glyph = icons[name];
  return <Glyph size={size ?? 16} strokeWidth={1.7} aria-hidden focusable="false" {...rest} />;
}
