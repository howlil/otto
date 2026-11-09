import type { Ref } from "react";
import type { MediaSnapshot } from "../../platform/tauri/media";
import { Icon, Text, VisuallyHidden } from "../../shared/ui";
import { mediaDetail, mediaTitle } from "./view";

function Spectrum() {
  return (
    <span
      className="inline-flex h-[18px] w-[25px] shrink-0 items-center justify-center gap-[3px]"
      aria-hidden="true"
    >
      <i className="block h-[4px] w-[2px] origin-center rounded-otto-island bg-otto-text-soft-white motion-safe:animate-otto-bar-1 motion-reduce:animate-none" />
      <i className="block h-[4px] w-[2px] origin-center rounded-otto-island bg-otto-text-soft-white motion-safe:animate-otto-bar-2 motion-reduce:animate-none [animation-delay:-0.19s]" />
      <i className="block h-[4px] w-[2px] origin-center rounded-otto-island bg-otto-text-soft-white motion-safe:animate-otto-bar-3 motion-reduce:animate-none [animation-delay:-0.48s]" />
      <i className="block h-[4px] w-[2px] origin-center rounded-otto-island bg-otto-text-soft-white motion-safe:animate-otto-bar-4 motion-reduce:animate-none [animation-delay:-0.32s]" />
    </span>
  );
}

export function MusicCapsule({
  snapshot,
  buttonRef,
  onOpen,
}: {
  snapshot: MediaSnapshot;
  buttonRef: Ref<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const playing = snapshot.status === "available" && snapshot.playback === "playing";
  return (
    <button
      ref={buttonRef}
      className="flex h-full w-full items-center gap-[9px] border-0 bg-transparent px-[11px] text-left text-inherit"
      type="button"
      onClick={onOpen}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-otto-compact-icon text-otto-text-bright">
        {snapshot.artworkDataUrl ? (
          <img
            className="h-full w-full object-cover"
            src={snapshot.artworkDataUrl}
            alt=""
            draggable={false}
          />
        ) : (
          <Icon name={snapshot.status === "unsupported" ? "unavailable" : "music"} size={16} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <Text
          as="strong"
          variant="title"
          className="block overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {mediaTitle(snapshot)}
        </Text>
        <Text
          as="small"
          variant="meta"
          className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-secondary"
        >
          {mediaDetail(snapshot)}
        </Text>
      </span>
      {playing && <Spectrum />}
      <VisuallyHidden>Open Music</VisuallyHidden>
    </button>
  );
}
