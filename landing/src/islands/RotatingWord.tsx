import { useEffect, useState } from "react";
import { TextMorph } from "@/components/arc/text-morph/text-morph";

const words = ["learn", "solve", "write", "practice"];

export default function RotatingWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % words.length), 2600);
    return () => window.clearInterval(timer);
  }, []);

  return <TextMorph className="text-otto-text">{words[index]}</TextMorph>;
}
