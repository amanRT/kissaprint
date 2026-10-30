// Responsive image URLs from src/data/images.json (written by the image pipeline in tools/) plus the content
// hashes from scripts/prepare-assets.mjs, so /assets/* can be cached for a year and still update on change.
import imagesJson from "@/data/images.json";
import versionsJson from "@/data/asset-versions.json";

export type ImageInfo = { src: string; widths: number[]; width: number; height: number; group: string };
export const images = imagesJson as Record<string, ImageInfo>;
const versions = versionsJson as Record<string, string>;

export function image(name: string): ImageInfo {
  const im = images[name];
  if (!im) throw new Error(`Unknown image "${name}" - render it with tools/render_mockups.py or tools/build_images.py`);
  return im;
}

export const imageUrl = (name: string, width: number, ext: "avif" | "webp") => `${image(name).src}-${width}.${ext}?v=${versions[name]}`;

export function srcset(name: string, ext: "avif" | "webp", widths?: number[]) {
  return image(name).widths.filter((w) => !widths || widths.includes(w)).map((w) => `${imageUrl(name, w, ext)} ${w}w`).join(", ");
}

/** A file under public/ that isn't part of an image set (e.g. the default share image). */
export const fileUrl = (path: string) => (versions[path] ? `${path}?v=${versions[path]}` : path);
