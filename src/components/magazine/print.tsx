"use client";
// Admin: the customer's magazine as A4 sheets with their original photos. "Print / Save as PDF" gives the file for
// the printer (Chrome: Destination "Save as PDF", Margins "None", Background graphics on).
import { MagazineProvider, PAGES, type SlotPhoto } from "./pages";

type Props = { template: string; title: string; photos: Record<string, SlotPhoto | undefined>; heading: string; missing: string[] };

export function PrintMagazine({ template, title, photos, heading, missing }: Props) {
  const Pages = PAGES[template] ?? [];
  return (
    <div className="mag-print">
      <div className="mag-print__bar">
        <strong>{heading}</strong>
        {missing.length > 0 && <span className="adm-warn">Empty spots: {missing.join(", ")}</span>}
        <button type="button" className="btn btn--kiss btn--sm" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <MagazineProvider value={{ photos, title }}>
        {Pages.map((P, i) => <P key={i} />)}
      </MagazineProvider>
    </div>
  );
}
