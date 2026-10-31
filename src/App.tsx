/** Bootstrap only: no simulated CLI, media, screenshot or timer behavior. */
export default function App() {
  return (
    <main className="flex h-screen w-screen items-start justify-center bg-transparent p-2">
      <section aria-label="Otto idle" className="flex h-15 w-full items-center justify-between rounded-full bg-otto-surface px-5 text-otto-text">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-otto-text" /><span className="h-2 w-2 rounded-full bg-otto-text" /></div>
          <span className="text-sm font-medium tracking-tight">Otto</span>
        </div>
        <span className="text-xs text-otto-muted">Idle</span>
      </section>
    </main>
  );
}
