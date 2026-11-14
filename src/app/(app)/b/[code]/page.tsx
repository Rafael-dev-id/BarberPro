import type { Metadata } from "next";
import BookingSummaryView, {
  bookingSummaryMetadata,
} from "@/components/BookingSummaryView";
import { decodeBookingCode } from "@/lib/booking-link";

export const metadata: Metadata = bookingSummaryMetadata;

// Tautan pendek: /b/<22 karakter base64url dari UUID token>.
export default async function ShortBookingSummaryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // Kode tidak valid -> "" -> komponen menampilkan "Booking tidak ditemukan".
  return <BookingSummaryView token={decodeBookingCode(code) ?? ""} />;
}
