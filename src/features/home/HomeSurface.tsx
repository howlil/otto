import type { RefObject } from "react";
import agentArt from "../../assets/agent-art.svg";
import focusArt from "../../assets/focus-art.svg";
import musicArt from "../../assets/music-art.svg";
import { IconButton, Text } from "../../shared/ui";
import { HomeCard } from "./HomeCard";

type ArtProps = {
  parallax: boolean;
  reduced: boolean;
  amount: number;
  tilt: number;
  gradient: number;
};

export function HomeSurface({
  notice,
  homeGear,
  agentSubtitle,
  artProps,
  onOpenSettings,
  onOpenAgent,
  onNotice,
  motionClass = "",
}: {
  notice: string;
  homeGear: RefObject<HTMLButtonElement | null>;
  agentSubtitle: string;
  artProps: ArtProps;
  onOpenSettings: () => void;
  onOpenAgent: () => void;
  onNotice: (message: string) => void;
  motionClass?: string;
}) {
  return (
    <section
      className={`flex h-full w-[452px] flex-col gap-2 px-[17px] pb-[17px] pt-3 ${motionClass}`}
    >
      <header className="flex h-[26px] shrink-0 items-center gap-[9px] pl-[37px]">
        <Text as="strong" variant="display">
          Otto
        </Text>
        <Text
          as="span"
          variant="status"
          className="ml-auto max-w-[188px] truncate text-otto-label-muted"
          role="status"
        >
          {notice}
        </Text>
        <IconButton
          icon="settings"
          label="Open Otto settings"
          variant="quiet"
          ref={homeGear}
          className="shrink-0"
          onClick={onOpenSettings}
        />
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-3 gap-[9px]">
        <HomeCard
          name="Agent"
          subtitle={agentSubtitle}
          artwork={agentArt}
          {...artProps}
          entryMotion="motion-safe:animate-otto-home-choice-1 motion-reduce:animate-none"
          onClick={onOpenAgent}
        />
        <HomeCard
          name="Music"
          subtitle="Playback"
          artwork={musicArt}
          {...artProps}
          entryMotion="motion-safe:animate-otto-home-choice-2 motion-reduce:animate-none"
          onClick={() => onNotice("Music is not available yet.")}
        />
        <HomeCard
          name="Focus"
          subtitle="Pomodoro"
          artwork={focusArt}
          {...artProps}
          entryMotion="motion-safe:animate-otto-home-choice-3 motion-reduce:animate-none"
          onClick={() => onNotice("Focus is not available yet.")}
        />
      </main>
    </section>
  );
}
