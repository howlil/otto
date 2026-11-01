import { Range, Text } from "../../shared/ui";
import type { Preferences } from "./preferences";

export function PlacementSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  return (
    <>
      <Text as="h2" variant="heading" className="m-0 mb-[3px]">
        Placement
      </Text>
      <div className="mb-[15px] grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={prefs.placement === "floating"}
          className={`flex flex-col items-center gap-[7px] rounded-otto-card border px-[7px] py-[10px] text-otto-text-paper ${prefs.placement === "floating" ? "border-otto-slider-outline bg-otto-raised-deep" : "border-otto-line-strong bg-otto-field-deep"}`}
          onClick={() => change({ placement: "floating" })}
        >
          <span className="relative block h-[42px] w-[77px] rounded-[5px] border border-otto-slider-border bg-otto-ink-deep">
            <i className="absolute left-5 top-2 h-[10px] w-[35px] rounded-[20px] bg-otto-slider-thumb" />
          </span>
          <Text as="span" variant="meta" className="leading-[1.2]">
            Floating
          </Text>
        </button>
        <button
          type="button"
          aria-pressed={false}
          disabled
          className="flex flex-col items-center gap-[7px] rounded-otto-card border border-otto-line-strong bg-otto-field-deep px-[7px] py-[10px] text-otto-text-paper disabled:opacity-[0.43]"
        >
          <span className="relative block h-[42px] w-[77px] rounded-[5px] border border-otto-slider-border bg-otto-ink-deep">
            <i className="absolute left-[17px] top-0 h-[13px] w-[41px] rounded-[0_0_12px_12px] bg-otto-slider-thumb" />
          </span>
          <Text as="span" variant="meta" className="leading-[1.2]">
            Attached
          </Text>
        </button>
      </div>
      <Range
        label="Top offset"
        value={prefs.topOffset}
        min={0}
        max={64}
        unit=" px"
        onChange={(topOffset) => change({ topOffset })}
      />
      <Text as="p" variant="meta" className="mt-3 text-otto-label-muted">
        Attached requires native hit-region verification and is not available in this slice.
      </Text>
    </>
  );
}
