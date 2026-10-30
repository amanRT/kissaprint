import { CollectionPage } from "@/components/collection/listing";
import { listingMeta, shopListing } from "@/lib/collections";
import { shopVisibility } from "@/lib/server/visibility";

export const metadata = listingMeta(shopListing());

export default async function ShopPage() {
  return <CollectionPage {...shopListing(await shopVisibility())} />;
}
