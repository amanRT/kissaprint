import { notFound } from "next/navigation";
import { CollectionPage } from "@/components/collection/listing";
import { COLLECTION_SLUGS, collectionListing, listingMeta } from "@/lib/collections";
import { shopVisibility } from "@/lib/server/visibility";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => COLLECTION_SLUGS.map((slug) => ({ slug }));

export async function generateMetadata({ params }: Props) {
  const listing = collectionListing((await params).slug, await shopVisibility());
  return listing ? listingMeta(listing) : {};
}

export default async function CollectionRoute({ params }: Props) {
  const listing = collectionListing((await params).slug, await shopVisibility());
  if (!listing) notFound();
  return <CollectionPage {...listing} />;
}
