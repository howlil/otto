import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function createVisualRecorder(name, enabled = process.env.OTTO_E2E_CAPTURE === "1") {
  const directory = enabled ? mkdtempSync(join(tmpdir(), `otto-${name}-frames-`)) : null;
  let index = 0;
  return {
    enabled: directory !== null,
    directory,
    async capture(label, screenshot) {
      if (!directory) return null;
      const encoded = await screenshot();
      if (typeof encoded !== "string") throw new Error("WebDriver screenshot is unavailable");
      const image = Buffer.from(encoded, "base64");
      if (
        image.length < 24 ||
        !image.subarray(0, 8).equals(pngSignature) ||
        image.readUInt32BE(16) === 0 ||
        image.readUInt32BE(20) === 0
      ) throw new Error("WebDriver returned an invalid PNG screenshot");
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "frame";
      const path = join(directory, `${String(++index).padStart(3, "0")}-${slug}.png`);
      writeFileSync(path, image, { mode: 0o600 });
      return path;
    },
  };
}
