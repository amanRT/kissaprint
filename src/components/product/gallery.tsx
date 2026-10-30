"use client";
import { useState } from "react";

export type GalleryImage = { avif: string; webp: string; src: string; alt: string; width: number; height: number; thumb: React.ReactNode };

/** Main product image + thumbnails. The first image is the LCP element (high priority, never lazy). */
export function Gallery({ images, sizes, badges, transitionName }: { images: GalleryImage[]; sizes: string; badges: React.ReactNode; transitionName?: string }) {
  const [current, setCurrent] = useState(0);
  const im = images[current];
  return (
    <div className="gallery" data-gallery>
      <div className="gallery__main" style={transitionName ? { viewTransitionName: transitionName } : undefined}>
        <picture>
          <source type="image/avif" srcSet={im.avif} sizes={sizes} />
          <img src={im.src} srcSet={im.webp} sizes={sizes} width={im.width} height={im.height} alt={im.alt} fetchPriority="high" decoding="async" data-gallery-main />
        </picture>
        {badges}
      </div>
      {images.length > 1 && (
        <div className="gallery__thumbs">
          {images.map((g, i) => (
            <button key={g.src} type="button" aria-label={`Show image ${i + 1} of ${images.length}`} aria-current={i === current} onClick={() => setCurrent(i)}>{g.thumb}</button>
          ))}
        </div>
      )}
    </div>
  );
}
