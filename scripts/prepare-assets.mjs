// Runs before `next dev` and `next build` (npm predev/prebuild).
//  1. src/data/asset-versions.json: a short content hash per image, appended as ?v=... so /assets/* can be
//     cached for a year (next.config.ts) yet still update the moment an image file changes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const images = read("src/data/images.json");

const versions = {};
let missing = 0;
for (const [name, im] of Object.entries(images)) {
  const hash = createHash("sha256");
  for (const w of im.widths) {
    for (const ext of ["avif", "webp"]) {
      const file = join(root, "public", `${im.src}-${w}.${ext}`);
      if (existsSync(file)) hash.update(readFileSync(file));
      else missing++;
    }
  }
  versions[name] = hash.digest("hex").slice(0, 10);
}
for (const extra of ["/assets/img/og-default.jpg"]) {
  versions[extra] = createHash("sha256").update(readFileSync(join(root, "public", extra))).digest("hex").slice(0, 10);
}
writeFileSync(join(root, "src/data/asset-versions.json"), JSON.stringify(versions, null, 1) + "\n");

console.log(`assets: ${Object.keys(versions).length} image versions${missing ? `, ${missing} variant files missing` : ""}`);
