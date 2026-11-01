export function MessageContent({ text }: { text: string }) {
  return (
    <p className="m-0 whitespace-pre-wrap text-otto-md leading-[1.6] [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}
