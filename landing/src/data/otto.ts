export const releaseUrl = "https://github.com/howlil/otto/releases/latest";
export const repoUrl = "https://github.com/howlil/otto";
export const changelogUrl = "https://github.com/howlil/otto/blob/master/CHANGELOG.md";

export const engines = [
  "Codex",
  "Claude Code",
  "OpenCode",
  "Pi",
  "Agy",
  "Goose",
  "Cline",
  "Gemini CLI",
  "Mistral Vibe",
  "Augment Code",
  "GitHub Copilot",
  "Amp",
  "Factory Droid",
  "Qwen Code",
  "Kilo Code",
  "Grok Build",
  "Cursor Agent",
  "Junie",
  "Devin",
];

export const stats = [
  { value: 19, label: "local AI CLI engines" },
  { value: 6, label: "learning modes" },
  { value: 5, label: "ways to capture context" },
  { value: 0, label: "extra API keys or subscriptions" },
];

export const principles = [
  {
    title: "Keep your focus",
    body: "Hover previews never take keyboard focus. Finished answers show as a quiet status you open when you are ready.",
  },
  {
    title: "Learn, don't just copy",
    body: "Mentor asks guiding questions, Solve checks its work, and Practice quizzes you until the idea sticks.",
  },
  {
    title: "Your tools, your login",
    body: "Otto reuses the CLIs you already signed in to. No new API keys, no hosted model gateway, no extra account.",
  },
  {
    title: "You stay in control",
    body: "Capture starts only when you trigger it. Permission requests are never approved for you, and Stop keeps the partial answer, marked as stopped.",
  },
];

export const modes = [
  {
    name: "Direct",
    slash: "/direct",
    summary: "Clear, concise answers without filler.",
    answer: "Ice floats because it is less dense than liquid water. As water freezes, its molecules lock into an open lattice that takes up more room.",
  },
  {
    name: "Solve",
    slash: "/solve",
    summary: "Math, logic, and competitive programming, with verification.",
    answer: "Ice has a density of about 0.92 g/cm³ and water about 1.00 g/cm³. Ice floats with roughly 92% of its volume under the surface, since 0.92 ÷ 1.00 ≈ 0.92.",
  },
  {
    name: "Mentor",
    slash: "/mentor",
    summary: "Step-by-step guidance with Socratic questions.",
    answer: "Let's reason it out. When molecules pack more loosely, does the substance get heavier or lighter for the same volume? Now compare ice with liquid water. Which one would sink?",
  },
  {
    name: "Simple",
    slash: "/simple",
    summary: "Plain-language breakdowns and everyday analogies.",
    answer: "Picture the water molecules holding hands in a neat, spread-out pattern as they freeze. That pattern takes up more room, so ice is lighter for its size and floats, the way a foam float does.",
  },
  {
    name: "Write & Translate",
    slash: "/write",
    summary: "Drafting, rewriting, tone polish, and translation.",
    answer: "Rewritten: Ice floats because it is less dense than liquid water. Indonesian: Es mengapung karena massa jenisnya lebih kecil daripada air.",
  },
  {
    name: "Practice",
    slash: "/practice",
    summary: "Short recall drills and comprehension checks.",
    answer: "Quick check: 1) Is ice more or less dense than water? 2) Why can a sealed bottle of water crack when it freezes? Answer each in one sentence.",
  },
];

export const demo = {
  context: "Region snip · 1 image",
  question: "Explain this step like I'm new to it.",
  answer: "Think of the derivative as the slope of a curve at one exact point. The formula zooms in: it measures the rise over a tiny run h, then lets h shrink toward zero.",
  followUps: [
    {
      label: "Simpler",
      answer: "The derivative tells you how fast something changes right now. A steeper line means a faster change.",
    },
    {
      label: "Give an example",
      answer: "If your position is x(t) = t², your speed at t = 3 is 2 × 3 = 6 units per second.",
    },
    {
      label: "Quiz me",
      answer: "Quick check: what is the derivative of x³? Work it out, then ask me for the answer.",
    },
    {
      label: "Go deeper",
      answer: "Next up: the derivative of sums and products, then the chain rule for a function sitting inside another function.",
    },
  ],
};

export const alsoIncluded = [
  "Retry, Regenerate, and Edit prompt & re-run",
  "Queue one follow-up while the answer streams",
  "Stop that keeps partial text, marked Stopped",
  "Switch engine, model, or thinking effort from the header",
  "Live PATH refresh after you install a new CLI",
  "Paste or drop images with Ctrl+V",
  "Optional Instant auto-send for one-keystroke submit",
  "Profile & Learning Style for your language and level",
  "Export a conversation as Markdown to your clipboard",
];

export const shortcuts = [
  { keys: ["Ctrl", "Alt", "O"], action: "Expand or collapse Otto from anywhere" },
  { keys: ["Ctrl", "Shift", "O"], action: "Visual capture: region, window, scrolling window, or full screen" },
  { keys: ["Ctrl", "Shift", "T"], action: "Selected text capture through Windows UI Automation" },
  { keys: ["Ctrl", "V"], action: "Stage an image from the clipboard into the composer" },
  { keys: ["Enter"], action: "Send, or queue a follow-up while the answer streams" },
  { keys: ["Esc"], action: "Close a popover, cancel a snip, or collapse to compact" },
];

export const steps = [
  {
    title: "Install Otto",
    body: "Download Otto_1.0.0_x64-setup.exe from GitHub Releases. It installs for your Windows user account, so there is no admin prompt.",
    commands: [] as string[],
  },
  {
    title: "Sign in to an AI CLI you already use",
    body: "Otto detects supported CLIs on your PATH. Sign in to any one of them, for example with these commands.",
    commands: ["codex login", "claude auth login", "opencode auth login"],
  },
  {
    title: "Ask from anywhere",
    body: "Hover the notch to peek, click it, or press Ctrl+Alt+O. Capture a region, get the explanation, insert it, and return to your work.",
    commands: [] as string[],
  },
];

export const faqs = [
  {
    question: "Do I need an API key or a new subscription?",
    answer: "No. Otto reuses the AI CLI tools already installed and signed in on your PC. Those tools keep their own accounts, limits, and billing.",
  },
  {
    question: "Can Otto edit my files or run commands?",
    answer: "No. Otto has no file-edit executor, no shell executor, and no coding workspace. Its prompts frame each turn as personal assistance and learning help, not coding work.",
  },
  {
    question: "Does Otto watch my screen?",
    answer: "No. Capture happens only after you trigger it, with no periodic or automatic collection. Hide from screen capture is on by default, but it is best effort, so some recorders may still see Otto.",
  },
  {
    question: "Which AI tools does it support?",
    answer: "Nineteen local CLI engines: Codex, Claude Code, OpenCode, Pi, and fifteen ACP CLIs such as Gemini CLI, GitHub Copilot, Cursor Agent, and Goose. Install one, then click Refresh PATH in Settings → Assistant.",
  },
  {
    question: "Which platform does it run on?",
    answer: "Windows 11 today. Updates are minisign-verified and checked on launch and every six hours from Settings → General.",
  },
  {
    question: "Why does Windows warn when I install it?",
    answer: "The installer is not Authenticode-signed yet, so SmartScreen may warn. Click More info, then Run anyway, or check the file against SHA256SUMS.txt on the release page.",
  },
];
