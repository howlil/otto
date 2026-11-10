import type { MediaSnapshot } from "../../platform/tauri/media";

export function mediaTitle(snapshot: MediaSnapshot): string {
  if (snapshot.status === "available") return snapshot.title || "Media playing";
  if (snapshot.status === "loading") return "Checking media";
  if (snapshot.status === "unsupported") return "Music unavailable";
  return "No active media";
}

export function mediaDetail(snapshot: MediaSnapshot): string {
  if (snapshot.status === "available") return snapshot.artist || "System media";
  if (snapshot.status === "loading") return snapshot.message;
  if (snapshot.status === "unsupported") return snapshot.message;
  return snapshot.message || "Start playback in a media app";
}

export function mediaHomeSubtitle(snapshot: MediaSnapshot): string {
  if (snapshot.status === "available") return snapshot.artist || "System media";
  if (snapshot.status === "loading") return "Checking media";
  if (snapshot.status === "unsupported") return "Music unavailable";
  return "No media session";
}
