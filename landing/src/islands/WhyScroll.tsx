import { useRef } from "react";
import { motion, type MotionValue, useReducedMotion, useScroll, useTransform } from "motion/react";

const words =
  "Every time you leave your task to ask an AI, the thread snaps. Otto keeps help where you already are, then gets out of the way.".split(
    " ",
  );

export default function WhyScroll() {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end center"] });

  return (
    <p ref={ref} className="font-display text-3xl leading-[1.25] font-medium tracking-tight text-balance sm:text-5xl">
      {words.map((word, index) => (
        <Word key={`${index}-${word}`} progress={scrollYProgress} index={index} total={words.length}>
          {word}
        </Word>
      ))}
    </p>
  );
}

function Word({
  children,
  progress,
  index,
  total,
}: {
  children: string;
  progress: MotionValue<number>;
  index: number;
  total: number;
}) {
  const reduced = useReducedMotion();
  const start = index / total;
  const opacity = useTransform(progress, [start, Math.min(start + 1 / total, 1)], [0.2, 1]);

  return (
    <motion.span style={{ opacity: reduced ? 1 : opacity }} className="mr-[0.28em] inline-block">
      {children}
    </motion.span>
  );
}
