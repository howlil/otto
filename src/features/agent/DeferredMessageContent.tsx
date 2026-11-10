import { lazy, Suspense, type ComponentType } from "react";

type MessageRenderer = ComponentType<{ text: string }>;
type RendererModule = { MessageContent: MessageRenderer };

function PlainMessageContent({ text }: { text: string }) {
  return (
    <div className="md-body">
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export function createMessageContentRenderer(load: () => Promise<RendererModule>) {
  return lazy(() =>
    Promise.resolve()
      .then(load)
      .then(({ MessageContent }) => ({ default: MessageContent }))
      .catch(() => ({ default: PlainMessageContent })),
  );
}

const Renderer = createMessageContentRenderer(() => import("./MessageContent"));

export function DeferredMessageContent({
  text,
  renderer: Content = Renderer,
}: {
  text: string;
  renderer?: MessageRenderer;
}) {
  if (!text) return null;
  return (
    <Suspense fallback={<PlainMessageContent text={text} />}>
      <Content text={text} />
    </Suspense>
  );
}
