// Safe to import from client components (no data imports). Symbols live in the sprite (icon-sprite.ts).
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
