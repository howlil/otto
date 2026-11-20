import amp from "../../../assets/providers/amp.svg";
import antigravity from "../../../assets/providers/antigravity.svg";
import augment from "../../../assets/providers/augment.svg";
import claude from "../../../assets/providers/claude.svg";
import cline from "../../../assets/providers/cline.svg";
import codex from "../../../assets/providers/codex.svg";
import cursor from "../../../assets/providers/cursor.svg";
import devin from "../../../assets/providers/devin.svg";
import factoryDroid from "../../../assets/providers/factory-droid.svg";
import gemini from "../../../assets/providers/gemini.svg";
import githubCopilot from "../../../assets/providers/github-copilot.svg";
import goose from "../../../assets/providers/goose.svg";
import grok from "../../../assets/providers/grok.svg";
import junie from "../../../assets/providers/junie.svg";
import kilo from "../../../assets/providers/kilo.svg";
import mistralVibe from "../../../assets/providers/mistral-vibe.svg";
import opencode from "../../../assets/providers/opencode.svg";
import pi from "../../../assets/providers/pi.svg";
import qwen from "../../../assets/providers/qwen.svg";

export type ProviderLogo = { src: string; tinted: boolean };

const colored: Record<string, string> = {
  Codex: codex,
  Agy: antigravity,
  Pi: pi,
};

const monochrome: Record<string, string> = {
  "Claude Code": claude,
  OpenCode: opencode,
  "Gemini CLI": gemini,
  "GitHub Copilot": githubCopilot,
  "Qwen Code": qwen,
  "Cursor Agent": cursor,
  Goose: goose,
  "Mistral Vibe": mistralVibe,
  Amp: amp,
  "Kilo Code": kilo,
  Junie: junie,
  Cline: cline,
  "Augment Code": augment,
  "Factory Droid": factoryDroid,
  "Grok Build": grok,
  Devin: devin,
};

export function providerLogo(name: string): ProviderLogo | null {
  const color = colored[name];
  if (color) return { src: color, tinted: false };
  const mono = monochrome[name];
  return mono ? { src: mono, tinted: true } : null;
}
