import { notFound } from "next/navigation";
import { PrintMagazine } from "@/components/magazine/print";
import { TEMPLATES } from "@/lib/magazine";
import { settings } from "@/lib/server/config";
import { requireAdminPage } from "@/lib/server/current-user";
import { makeStore } from "@/lib/server/store";

export const metadata = { title: "Print view | KissaPrints admin", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ line?: string }> };

/** A designed order line (the magazine) laid out on A4 with the customer's original photos, ready to save as PDF. */
export default async function PrintPage({ params, searchParams }: Props) {
  const { id } = await params;
  const line = Math.max(0, Math.floor(Number((await searchParams).line ?? 0)) || 0);
  await requireAdminPage(`/admin/print/${encodeURIComponent(id)}/?line=${line}`);
  const store = makeStore(settings());
  const order = store ? await store.getOrder(id) : null;
  const item = order?.items[line];
  const template = item?.layout ? TEMPLATES[item.layout.template] : undefined;
  if (!store || !order || !item?.layout || !template) notFound();
  const slots = item.layout.slots;
  const urls = await store.photoUrls(Object.values(slots).map((s) => s.key));
  const photos = Object.fromEntries(Object.entries(slots).filter(([, s]) => urls[s.key]).map(([slot, s]) => [slot, { src: urls[s.key], x: s.x, y: s.y }]));
  return (
    <PrintMagazine template={template.id} title={item.note} photos={photos} heading={`${order.id} · ${item.name} · ${order.customer.name}`}
      missing={template.slots.filter((s) => !photos[s.id]).map((s) => s.label)} />
  );
}
