import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import agentArt from "./assets/agent-art.svg";
import musicArt from "./assets/music-art.svg";
import focusArt from "./assets/focus-art.svg";
import { AgentPanel } from "./features/agent/AgentPanel";
import { useAgent } from "./features/agent/useAgent";
import { nativeAvailable, setNotchSurface } from "./platform/tauri";

type Page = "home" | "agent" | "global-settings" | "agent-settings";
type SettingsTab = "general" | "interaction" | "motion" | "placement";
type Expression = "calm" | "curious" | "sleepy" | "happy";
type Motion = "fluid" | "gentle" | "reduced";
type Preferences = {
  expression: Expression;
  reactive: "quiet" | "alive";
  hoverExpand: boolean;
  hoverDelay: number;
  leaveDelay: number;
  clickOutside: boolean;
  motion: Motion;
  parallax: boolean;
  tilt: number;
  gradient: number;
  topOffset: number;
};
const defaults: Preferences = {
  expression: "calm",
  reactive: "quiet",
  hoverExpand: true,
  hoverDelay: 150,
  leaveDelay: 340,
  clickOutside: true,
  motion: "fluid",
  parallax: true,
  tilt: 43,
  gradient: 80,
  topOffset: 20,
};
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem("otto.preferences.v1") || "{}");
    if (!saved || typeof saved !== "object") return defaults;
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
      if (typeof saved[key] === typeof defaults[key]) {
        // The native boundary still validates top offset and screen geometry.
        (result as unknown as Record<string, unknown>)[key] = saved[key];
      }
    }
    return result;
  } catch {
    return defaults;
  }
}

function Eyes({
  expression = "calm",
  reactive = "quiet",
}: {
  expression?: Expression;
  reactive?: Preferences["reactive"];
}) {
  return (
    <span
      className={"otto-eyes " + (reactive === "alive" ? "alive" : "")}
      data-expression={expression}
      aria-hidden="true"
    >
      <i />
      <i />
    </span>
  );
}
function Icon({ name, size = 17 }: { name: "settings" | "back"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "settings" ? (
        <>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3.8v2m0 12.4v2M20.2 12h-2M5.8 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4m1.4 0-1.4-1.4M7.6 7.6 6.2 6.2" />
        </>
      ) : (
        <path d="m15 18-6-6 6-6" />
      )}
    </svg>
  );
}
function HomeCard({
  name,
  subtitle,
  artwork,
  onClick,
  prefs,
}: {
  name: string;
  subtitle: string;
  artwork: string;
  onClick: () => void;
  prefs: Preferences;
}) {
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (
      !prefs.parallax ||
      prefs.motion === "reduced" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const amount = prefs.motion === "gentle" ? 2 : 5;
    event.currentTarget.style.setProperty(
      "--dx",
      ((event.clientX - rect.left) / rect.width - 0.5) * amount + "px",
    );
    event.currentTarget.style.setProperty(
      "--dy",
      ((event.clientY - rect.top) / rect.height - 0.5) * amount * 0.7 + "px",
    );
  };
  const reset = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty("--dx", "0px");
    event.currentTarget.style.setProperty("--dy", "0px");
  };
  return (
    <button
      type="button"
      className={
        "otto-choice relative isolate block min-w-0 overflow-hidden text-left text-otto-text otto-choice-" +
        name.toLowerCase()
      }
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={reset}
      style={
        {
          "--art-tilt": prefs.tilt + "deg",
          "--shimmer": String(prefs.gradient / 100),
        } as CSSProperties
      }
    >
      <span className="otto-choice-copy pointer-events-none relative z-[3] flex h-full flex-col justify-center whitespace-nowrap">
        <strong>{name}</strong>
        <small>{subtitle}</small>
      </span>
      <img
        className="otto-choice-art pointer-events-none absolute z-0 select-none object-contain"
        src={artwork}
        alt=""
        draggable={false}
      />
    </button>
  );
}

function SettingChoices<T extends string>({
  value,
  choices,
  onChange,
}: {
  value: T;
  choices: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="otto-picks flex flex-wrap gap-[6px]">
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          aria-pressed={value === choice.value}
          className={value === choice.value ? "selected" : ""}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
function Range({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="otto-setting-range">
      <span>
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function SettingToggle({
  title,
  help,
  checked,
  onChange,
}: {
  title: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="otto-setting-toggle flex cursor-pointer items-center justify-between gap-[10px]">
      <span>
        <strong>{title}</strong>
        <small>{help}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}
function GlobalSettings({
  prefs,
  change,
  onBack,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      className="otto-global-settings flex h-full min-h-0 flex-col"
      aria-label="Otto settings"
    >
      <header className="otto-settings-head flex shrink-0 items-center gap-[10px]">
        <button
          className="otto-icon-button"
          ref={back}
          type="button"
          onClick={onBack}
          aria-label="Back to Home"
        >
          <Icon name="back" />
        </button>
        <strong>Settings</strong>
        <span className="otto-settings-meta">Otto</span>
      </header>
      <div className="otto-settings-layout grid min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="otto-settings-nav flex flex-col items-stretch gap-1"
        >
          {(["general", "interaction", "motion", "placement"] as SettingsTab[]).map((name) => (
            <button
              type="button"
              key={name}
              className={tab === name ? "selected" : ""}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
        <div className="otto-settings-content min-h-0 overflow-y-auto text-otto-text">
          {tab === "general" && (
            <>
              <h2>General</h2>
              <p>Choose how Otto feels while idle.</p>
              <div className="otto-setting-group">
                <span>Idle expression</span>
                <SettingChoices
                  value={prefs.expression}
                  onChange={(expression) => change({ expression })}
                  choices={[
                    { value: "calm", label: "Calm" },
                    { value: "curious", label: "Curious" },
                    { value: "sleepy", label: "Sleepy" },
                    { value: "happy", label: "Happy" },
                  ]}
                />
              </div>
              <div className="otto-setting-group">
                <span>Idle response</span>
                <SettingChoices
                  value={prefs.reactive}
                  onChange={(reactive) => change({ reactive })}
                  choices={[
                    { value: "quiet", label: "Quiet" },
                    { value: "alive", label: "Alive" },
                  ]}
                />
              </div>
              <button
                className="otto-settings-reset"
                type="button"
                onClick={() => change(defaults)}
              >
                Restore defaults
              </button>
            </>
          )}
          {tab === "interaction" && (
            <>
              <h2>Interaction</h2>
              <p>Decide when the island responds to your pointer.</p>
              <SettingToggle
                title="Expand on hover"
                help="Preview without stealing focus"
                checked={prefs.hoverExpand}
                onChange={(hoverExpand) => change({ hoverExpand })}
              />
              <Range
                label="Hover intent"
                value={prefs.hoverDelay}
                min={0}
                max={400}
                unit=" ms"
                onChange={(hoverDelay) => change({ hoverDelay })}
              />
              <Range
                label="Leave delay"
                value={prefs.leaveDelay}
                min={0}
                max={650}
                unit=" ms"
                onChange={(leaveDelay) => change({ leaveDelay })}
              />
              <SettingToggle
                title="Close when returning to desktop"
                help="Escape always closes the panel"
                checked={prefs.clickOutside}
                onChange={(clickOutside) => change({ clickOutside })}
              />
            </>
          )}
          {tab === "motion" && (
            <>
              <h2>Motion</h2>
              <p>Reduced motion from Windows always takes priority.</p>
              <div className="otto-setting-group">
                <span>Motion profile</span>
                <SettingChoices
                  value={prefs.motion}
                  onChange={(motion) => change({ motion })}
                  choices={[
                    { value: "fluid", label: "Fluid" },
                    { value: "gentle", label: "Subtle" },
                    { value: "reduced", label: "Reduced" },
                  ]}
                />
              </div>
              <SettingToggle
                title="Pointer depth"
                help="Subtle depth on Home illustrations"
                checked={prefs.parallax}
                onChange={(parallax) => change({ parallax })}
              />
              <Range
                label="Artwork tilt"
                value={prefs.tilt}
                min={0}
                max={65}
                unit="°"
                onChange={(tilt) => change({ tilt })}
              />
              <Range
                label="Tonal gradient"
                value={prefs.gradient}
                min={0}
                max={100}
                unit="%"
                onChange={(gradient) => change({ gradient })}
              />
            </>
          )}
          {tab === "placement" && (
            <>
              <h2>Placement</h2>
              <p>Position Otto relative to the top of the screen.</p>
              <div className="otto-placement-grid grid grid-cols-2 gap-2">
                <button type="button" aria-pressed="true" className="selected">
                  <span className="otto-place-graphic">
                    <i />
                  </span>
                  Floating
                </button>
                <button
                  type="button"
                  disabled
                  title="Attached placement needs Windows-native hit-region support"
                >
                  <span className="otto-place-graphic attached">
                    <i />
                  </span>
                  Attached
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
              <p className="otto-availability">
                Attached requires native hit-region verification and is not available in this slice.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const agent = useAgent();
  const [page, setPage] = useState<Page>("home");
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(readPreferences);
  const [notice, setNotice] = useState("");
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactButton = useRef<HTMLButtonElement>(null);
  const homeGear = useRef<HTMLButtonElement>(null);
  const previousPage = useRef<Page>(page);
  const lastStatus = useRef(agent.snapshot.status);
  const showAgentBars = ["starting", "streaming"].includes(agent.snapshot.status);
  const [eventMotion, setEventMotion] = useState("");
  const isAgent = page === "agent" || page === "agent-settings";
  const reducedMotion =
    prefs.motion === "reduced" ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const surface = !expanded
    ? isAgent
      ? "agentCompact"
      : "idle"
    : page === "global-settings"
      ? "homeSettings"
      : page === "agent-settings"
        ? "agentSettings"
        : page === "home"
          ? "home"
          : agent.installed === false || agent.error || agent.snapshot.status === "failed"
            ? "agentError"
            : agent.snapshot.status === "starting"
              ? "agentThinking"
              : agent.snapshot.status === "streaming" || agent.snapshot.status === "stopping"
                ? "agentFull"
                : agent.snapshot.messages.length === 0
                  ? "agentReady"
                  : "agentFull";

  const clearTimers = useCallback(() => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    enterTimer.current = null;
    leaveTimer.current = null;
  }, []);
  const collapse = useCallback(() => {
    clearTimers();
    setExpanded(false);
    setPinned(false);
    setPage((p) => (p === "global-settings" ? "home" : p === "agent-settings" ? "agent" : p));
  }, [clearTimers]);
  const open = (next: Page, pin = true) => {
    clearTimers();
    setPage(next);
    setExpanded(true);
    setPinned(pin);
    setNotice("");
  };
  const change = (patch: Partial<Preferences>) => setPrefs((old) => ({ ...old, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem("otto.preferences.v1", JSON.stringify(prefs));
    } catch {
      /* optional */
    }
  }, [prefs]);
  useEffect(() => {
    void setNotchSurface(surface, prefs.topOffset, !reducedMotion).catch(() => {
      setNotice("Notch resizing is unavailable in this Windows session.");
    });
  }, [surface, prefs.topOffset, reducedMotion]);
  useEffect(() => {
    if (previousPage.current === "global-settings" && page === "home")
      homeGear.current?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    if (!nativeAvailable) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => {
          if (!payload && prefs.clickOutside && pinned) collapse();
        }),
      )
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [prefs.clickOutside, pinned, collapse]);
  useEffect(() => {
    const previous = lastStatus.current;
    const current = agent.snapshot.status;
    lastStatus.current = current;
    if (previous === current) return;
    setEventMotion("");
    if (current === "completed" || current === "failed") {
      setEventMotion(current === "completed" ? "otto-completed" : "otto-failed");
      const timer = setTimeout(() => setEventMotion(""), 460);
      return () => clearTimeout(timer);
    }
  }, [agent.snapshot.status]);
  useEffect(() => () => clearTimers(), [clearTimers]);

  const handleEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (!pinned && !expanded && prefs.hoverExpand) {
      enterTimer.current = setTimeout(() => {
        setExpanded(true);
        setNotice("");
      }, prefs.hoverDelay);
    }
  };
  const handleLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (!pinned && expanded) {
      leaveTimer.current = setTimeout(() => collapse(), prefs.leaveDelay);
    }
  };
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    if (page === "agent-settings") {
      setPage("agent");
      return;
    }
    if (page === "global-settings") {
      setPage("home");
      return;
    }
    collapse();
    requestAnimationFrame(() => compactButton.current?.focus({ preventScroll: true }));
  };

  return (
    <main
      className={
        "otto-shell relative w-full h-full overflow-hidden bg-otto-surface text-otto-text " +
        (expanded ? "is-expanded " : "") +
        (reducedMotion ? "is-reduced " : "") +
        eventMotion
      }
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onKeyDown={handleEscape}
      onPointerDown={() => {
        if (expanded && !pinned) setPinned(true);
      }}
    >
      {!expanded ? (
        <button
          ref={compactButton}
          className={
            "otto-compact flex items-center justify-center w-full h-full bg-transparent text-left " +
            (isAgent ? "is-agent" : "")
          }
          type="button"
          onClick={() => open(isAgent ? "agent" : "home")}
          aria-label={isAgent ? "Open Agent" : "Open Otto"}
        >
          {isAgent ? (
            <>
              <span className="otto-agent-avatar grid place-items-center shrink-0 rounded-full">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="m7 9 3 3-3 3m6 0h4" />
                </svg>
              </span>
              <span className="otto-compact-copy min-w-0 flex-1">
                <strong>
                  {agent.installed === false
                    ? "Unavailable"
                    : agent.snapshot.status === "completed"
                      ? "Answer ready"
                      : "Codex"}
                </strong>
                <small>
                  {agent.snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() || "Local CLI"} ·{" "}
                  {agent.installed === false
                    ? "Codex not found"
                    : agent.snapshot.status === "idle"
                      ? "Ready"
                      : agent.snapshot.status}
                </small>
              </span>
              {showAgentBars ? (
                <span className="otto-bars live" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              ) : agent.snapshot.status === "completed" ? (
                <span className="otto-compact-mark">✓</span>
              ) : null}
            </>
          ) : (
            <Eyes expression={prefs.expression} reactive={prefs.reactive} />
          )}
        </button>
      ) : page === "home" ? (
        <section className="otto-home flex h-full flex-col gap-[10px]" aria-label="Otto Home">
          <header className="otto-home-head flex h-6 shrink-0 items-center gap-2">
            <button
              className="otto-eye-button grid shrink-0 place-items-center"
              type="button"
              aria-label="Collapse Otto"
              onClick={collapse}
            >
              <Eyes expression={prefs.expression} />
            </button>
            <strong>Otto</strong>
            <span className="otto-home-notice" role="status">
              {notice}
            </span>
            <button
              className="otto-gear grid shrink-0 place-items-center"
              ref={homeGear}
              type="button"
              onClick={() => open("global-settings")}
              aria-label="Open Otto settings"
            >
              <Icon name="settings" />
            </button>
          </header>
          <div className="otto-cards grid min-h-0 flex-1 grid-cols-3 gap-[9px]">
            <HomeCard
              name="Agent"
              subtitle="Ask your CLI"
              artwork={agentArt}
              prefs={prefs}
              onClick={() => open("agent")}
            />
            <HomeCard
              name="Music"
              subtitle="Playback"
              artwork={musicArt}
              prefs={prefs}
              onClick={() => setNotice("Music is not available yet.")}
            />
            <HomeCard
              name="Focus"
              subtitle="Pomodoro"
              artwork={focusArt}
              prefs={prefs}
              onClick={() => setNotice("Focus is not available yet.")}
            />
          </div>
        </section>
      ) : page === "global-settings" ? (
        <GlobalSettings prefs={prefs} change={change} onBack={() => setPage("home")} />
      ) : (
        <AgentPanel
          agent={agent}
          settings={page === "agent-settings"}
          onSettings={() => open("agent-settings")}
          onSettingsBack={() => setPage("agent")}
          onBack={() => open("home")}
          onCollapse={collapse}
        />
      )}
    </main>
  );
}
