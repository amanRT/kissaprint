import { notFound } from "next/navigation";
import { CollectionPage } from "@/components/collection/listing";
import { listingMeta, OCCASION_SLUGS, occasionListing } from "@/lib/collections";
import { shopVisibility } from "@/lib/server/visibility";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => OCCASION_SLUGS.map((slug) => ({ slug }));

export async function generateMetadata({ params }: Props) {
  const listing = occasionListing((await params).slug, await shopVisibility());
  return listing ? listingMeta(listing) : {};
}

export default async function OccasionRoute({ params }: Props) {
  const listing = occasionListing((await params).slug, await shopVisibility());
  if (!listing) notFound();
  return <CollectionPage {...listing} />;
}
