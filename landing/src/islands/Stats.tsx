import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter";
import { stats } from "@/data/otto";

export default function Stats() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-otto-line bg-otto-line lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-otto-surface p-6 sm:p-8">
          <AnimatedCounter value={stat.value} label={stat.label} animateOnView />
        </div>
      ))}
    </div>
  );
}
