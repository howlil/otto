import { Accordion } from "@/components/arc/accordion/accordion";
import { faqs } from "@/data/otto";

export default function Faq() {
  return (
    <Accordion
      items={faqs.map((item) => ({ title: item.question, content: item.answer }))}
      defaultOpen={0}
      size="lg"
    />
  );
}
