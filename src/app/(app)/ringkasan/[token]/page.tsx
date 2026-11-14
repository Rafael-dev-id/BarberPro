import type { Metadata } from "next";
import BookingSummaryView, {
  bookingSummaryMetadata,
} from "@/components/BookingSummaryView";

export const metadata: Metadata = bookingSummaryMetadata;

// Tautan lama: tetap berfungsi.
export default async function BookingSummaryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BookingSummaryView token={token} />;
}
