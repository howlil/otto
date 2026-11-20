import { AnnouncementBar } from "@/components/arc/announcement-bar/announcement-bar";
import { releaseUrl } from "@/data/otto";

export default function TopBanner() {
  return (
    <AnnouncementBar
      label="Release announcement"
      autoPlay={false}
      messages={[
        {
          id: "otto-1-0-0",
          message: "Otto 1.0.0 is out for Windows 11.",
          action: { label: "Download the installer", href: releaseUrl },
        },
      ]}
    />
  );
}
