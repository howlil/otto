import type { RefObject } from "react";
import agentArt from "../../assets/agent-art.svg";
import focusArt from "../../assets/focus-art.svg";
import musicArt from "../../assets/music-art.svg";
import { IconButton } from "../../shared/ui";
import { HomeCard } from "./HomeCard";

type ArtProps = {
  tilt: number;
  gradient: number;
};

export function HomeSurface({
  homeGear,
  agentSubtitle,
  musicSubtitle,
  artProps,
  onOpenSettings,
  onOpenAgent,
  onOpenMusic,
  motionClass = "",
}: {
  homeGear: RefObject<HTMLButtonElement | null>;
  agentSubtitle: string;
  musicSubtitle: string;
  artProps: ArtProps;
  onOpenSettings: () => void;
  onOpenAgent: () => void;
  onOpenMusic: () => void;
  motionClass?: string;
}) {
  return (
    <section className={`flex h-full w-full flex-col gap-2 px-[17px] py-[15px] ${motionClass}`}>
      <header className="flex h-[34px] shrink-0 items-center gap-[9px]">
        <IconButton
          icon="settings"
          label="Open Otto settings"
          variant="quiet"
          ref={homeGear}
          className="ml-auto shrink-0"
          onClick={onOpenSettings}
        />
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-3 gap-2">
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
          subtitle={musicSubtitle}
          artwork={musicArt}
          {...artProps}
          entryMotion="motion-safe:animate-otto-home-choice-2 motion-reduce:animate-none"
          onClick={onOpenMusic}
        />
        <HomeCard
          name="Focus"
          subtitle="Coming soon"
          disabled
          artwork={focusArt}
          {...artProps}
          entryMotion="motion-safe:animate-otto-home-choice-3 motion-reduce:animate-none"
        />
      </main>
    </section>
  );
}
