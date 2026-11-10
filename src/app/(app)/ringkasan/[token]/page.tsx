import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import {
  getPublicBookingStatus,
  UUID_PATTERN,
  type PublicBookingSummary,
} from "@/lib/public-booking";
import BookingSummaryClient from "@/components/BookingSummaryClient";
import { isNetworkError } from "@/lib/admin-auth";
import { isValidIndonesianPhone, normalizePhone } from "@/lib/phone";
import Link from "next/link";

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
  const tooLateContactUrl =
    summary.status === "confirmed" &&
    summary.cancel_block_reason === "too_late"
      ? getTooLateContactUrl(summary)
      : null;
  return (
    <BookingSummaryClient
      token={token}
      summary={summary}
      statusLabel={getPublicBookingStatus(summary.status, summary.cancelled_by)}
      tooLateContactUrl={tooLateContactUrl}
    />
  );
}

function getTooLateContactUrl(summary: PublicBookingSummary): string | null {
  const configuredNumber = process.env.ADMIN_WHATSAPP_NUMBER;
  if (!configuredNumber || !isValidIndonesianPhone(configuredNumber)) return null;

  const normalizedNumber = normalizePhone(configuredNumber).replace(/\D/g, "");
  if (!/^62\d{8,11}$/.test(normalizedNumber)) return null;

  const startsAt = new Date(summary.starts_at);
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(startsAt);
  const text = `Halo, saya ${summary.customer_name}, kode booking ${summary.code}. Saya ingin mengubah atau membatalkan booking ${date} jam ${time}.`;

  return `https://wa.me/${normalizedNumber}?text=${encodeURIComponent(text)}`;
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
      <Link
        href="/booking"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-ink/70 underline underline-offset-2"
      >
        Kembali ke booking
      </Link>
    </section>
  );
}
