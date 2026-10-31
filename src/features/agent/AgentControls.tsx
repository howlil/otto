export function Bars({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-[21px] w-[29px] flex-none items-center justify-center gap-[3px] ${className}`}
      aria-hidden="true"
    >
      <i className="block h-[5px] w-[3px] origin-center rounded-[5px] bg-otto-text-soft-white motion-safe:animate-otto-bars motion-reduce:animate-none" />
      <i className="block h-[5px] w-[3px] origin-center rounded-[5px] bg-otto-text-soft-white motion-safe:animate-otto-bars motion-reduce:animate-none [animation-delay:-0.19s]" />
      <i className="block h-[5px] w-[3px] origin-center rounded-[5px] bg-otto-text-soft-white motion-safe:animate-otto-bars motion-reduce:animate-none [animation-delay:-0.48s]" />
      <i className="block h-[5px] w-[3px] origin-center rounded-[5px] bg-otto-text-soft-white motion-safe:animate-otto-bars motion-reduce:animate-none [animation-delay:-0.32s]" />
    </span>
  );
}
