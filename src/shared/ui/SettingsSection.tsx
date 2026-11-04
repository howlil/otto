import type { ReactNode } from "react";
import { Text } from "./Text";

export function SettingsSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 ${className}`.trim()}>
      <Text as="h2" variant="heading" className="m-0 mb-[3px]">
        {title}
      </Text>
      {children}
    </section>
  );
}
