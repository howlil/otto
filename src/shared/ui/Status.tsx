import type { ReactNode } from "react";
import { Button } from "./Button";
import { Text } from "./Text";

export type StatusTone = "info" | "warn" | "error" | "success";

const roles: Record<StatusTone, { role: "status" | "alert"; live: "polite" | "assertive" }> = {
  info: { role: "status", live: "polite" },
  success: { role: "status", live: "polite" },
  warn: { role: "status", live: "polite" },
  error: { role: "alert", live: "assertive" },
};

export function StatusMessage({
  tone = "info",
  className,
  title,
  children,
  action,
}: {
  tone?: StatusTone;
  className?: string;
  title?: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const { role, live } = roles[tone];
  return (
    <div
      className={`flex min-w-0 items-center justify-between gap-2 ${className ?? ""}`.trim()}
      role={role}
      aria-live={live}
    >
      {title ? (
        <div className="min-w-0 flex-1">
          <Text as="strong" variant="status" className="block font-semibold text-otto-text-bright">
            {title}
          </Text>
          <Text as="p" variant="status" className="m-0 mt-0.5">
            {children}
          </Text>
        </div>
      ) : (
        <Text as="span" variant="status">
          {children}
        </Text>
      )}
      {action && (
        <Button variant="primary" size="xs" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
