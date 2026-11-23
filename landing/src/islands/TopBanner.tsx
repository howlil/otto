import { AnnouncementBar } from "@/components/arc/announcement-bar/announcement-bar";
import { changelogUrl } from "@/data/otto";

export default function TopBanner() {
  return (
    <AnnouncementBar
      label="Release notes"
      autoPlay={false}
      messages={[
        {
          id: "otto-1-4-0",
          message: "Coming in 1.4.0: Circle mascot, local voice input, and Read Aloud.",
          action: { label: "See the changelog", href: changelogUrl },
        },
      ]}
    />
  );
}
