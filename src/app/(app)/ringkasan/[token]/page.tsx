import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import {
  getPublicBookingStatus,
  UUID_PATTERN,
  type PublicBookingSummary,
} from "@/lib/public-booking";
import BookingSummaryClient from "@/components/BookingSummaryClient";
import { isNetworkError } from "@/lib/admin-auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function BookingSummaryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_PATTERN.test(token)) {
    return <BookingSummaryMessage title="Booking tidak ditemukan" />;
  }

  let summaryData: unknown = null;
  let requestError: unknown = null;
  try {
    const { data, error } = await supabase.rpc("get_booking_summary", {
      p_token: token,
    });
    summaryData = data;
    requestError = error;
  } catch (error) {
    requestError = error;
  }

  if (requestError) {
    return (
      <BookingSummaryMessage
        title="Ringkasan booking belum dapat dimuat"
        message={
          isNetworkError(requestError)
            ? "Koneksi terputus. Ringkasan booking belum dapat dimuat."
            : "Silakan coba lagi beberapa saat."
        }
      />
    );
  }
  if (!summaryData) {
    return <BookingSummaryMessage title="Booking tidak ditemukan" />;
  }

  const summary = summaryData as PublicBookingSummary;
  return (
    <BookingSummaryClient
      token={token}
      summary={summary}
      statusLabel={getPublicBookingStatus(summary.status, summary.cancelled_by)}
    />
  );
}

function BookingSummaryMessage({
  title,
  message = "Periksa kembali tautan atau hubungi barbershop.",
}: {
  title: string;
  message?: string;
}) {
  return (
    <section className="card p-6">
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-ink/70">{message}</p>
    </section>
  );
}
