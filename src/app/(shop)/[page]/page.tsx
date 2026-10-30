import { notFound } from "next/navigation";
import { INFO_PAGES, InfoView } from "@/components/content/pages";
import { faqs } from "@/lib/catalog";
import { ldFaq, pageMeta } from "@/lib/seo";

type Props = { params: Promise<{ page: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(INFO_PAGES).map((page) => ({ page }));

export async function generateMetadata({ params }: Props) {
  const slug = (await params).page;
  const info = INFO_PAGES[slug];
  return info ? pageMeta({ title: info.title, description: info.description, path: `/${slug}/`, noindex: info.noindex }) : {};
}

export default async function InfoRoute({ params }: Props) {
  const slug = (await params).page;
  const info = INFO_PAGES[slug];
  if (!info) notFound();
  const Body = info.body;
  return (
    <InfoView slug={slug} info={info} ld={slug === "faq" ? [ldFaq(faqs)] : []}>
      <Body />
    </InfoView>
  );
}
