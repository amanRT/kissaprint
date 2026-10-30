// Designable products: which templates exist, their photo spots, and the check the server runs on a saved design.
// The look of each page lives in components/magazine/pages.tsx; this file is just the data both sides agree on.
// All templates are original KissaPrints designs.

export type SlotDef = { id: string; page: number; label: string };
export type Template = { id: string; name: string; pages: number; slots: SlotDef[] };
/** A design as saved in the cart and the order: which uploaded photo goes in which spot, and its framing (0-100). */
export type Layout = { template: string; slots: Record<string, { key: string; x: number; y: number }> };

export const TEMPLATES: Record<string, Template> = {
  "kissa-8": {
    id: "kissa-8", name: "Kissa - 8 pages", pages: 8,
    slots: [
      { id: "cover", page: 0, label: "Cover photo" },
      { id: "letter", page: 1, label: "Editor's letter" },
      { id: "began-main", page: 2, label: "How it began" },
      { id: "began-polaroid", page: 2, label: "Polaroid" },
      { id: "feature", page: 3, label: "Feature" },
      { id: "moment-1", page: 4, label: "Little moment 1" },
      { id: "moment-2", page: 4, label: "Little moment 2" },
      { id: "moment-3", page: 4, label: "Little moment 3" },
      { id: "trip-1", page: 5, label: "Adventure 1" },
      { id: "trip-2", page: 5, label: "Adventure 2" },
      { id: "forever", page: 6, label: "Forever" },
      { id: "back", page: 7, label: "Back cover" },
    ],
  },
};

/** Products with a designer, the option that picks the template, and the template per option value. */
export const DESIGNERS: Record<string, { option: string; templates: Record<string, string> }> = {
  "personalised-magazine": { option: "Pages", templates: { "8 pages": "kissa-8" } },
};

/** The template for a product + chosen options, if that combination can be designed. */
export function templateFor(slug: string, opts: Record<string, string>): Template | null {
  const d = DESIGNERS[slug];
  const id = d?.templates[opts[d.option]];
  return id ? TEMPLATES[id] ?? null : null;
}

const clamp = (n: unknown) => Math.min(100, Math.max(0, Math.round(Number(n) * 10) / 10 || 0));

/** Server-side: keep only valid spots that use one of this line's uploaded photos. Throws a message on a broken design. */
export function cleanLayout(raw: unknown, template: Template, photoKeys: ReadonlySet<string>): Layout {
  const r = raw as { template?: unknown; slots?: unknown };
  if (!r || typeof r !== "object" || r.template !== template.id || !r.slots || typeof r.slots !== "object" || Array.isArray(r.slots)) {
    throw new Error("Your magazine design is out of date - please open the designer and save it again");
  }
  const ids = new Set(template.slots.map((s) => s.id));
  const slots: Layout["slots"] = {};
  for (const [id, v] of Object.entries(r.slots as Record<string, { key?: unknown; x?: unknown; y?: unknown }>)) {
    if (!ids.has(id) || !v || typeof v.key !== "string" || !photoKeys.has(v.key)) {
      throw new Error("One of the photos in your magazine design didn't upload properly - please open the designer and add it again");
    }
    slots[id] = { key: v.key, x: clamp(v.x ?? 50), y: clamp(v.y ?? 50) };
  }
  return { template: template.id, slots };
}
