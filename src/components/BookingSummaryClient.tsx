"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cancelBookingByToken } from "@/lib/booking-management-actions";
import type { PublicBookingSummary } from "@/lib/public-booking";
import {
  isNetworkError,
  NETWORK_ERROR_MESSAGE,
} from "@/lib/admin-auth";

const jakartaDateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const jakartaTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default function BookingSummaryClient({
  token,
  summary,
  statusLabel,
}: {
  token: string;
  summary: PublicBookingSummary;
  statusLabel: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startsAt = new Date(summary.starts_at);
  const blockReason =
    summary.cancel_block_reason === "too_late"
      ? "Pembatalan tidak bisa dilakukan kurang dari 30 menit sebelum jadwal. Silakan hubungi barbershop."
      : summary.cancel_block_reason === "not_confirmed"
        ? `Booking ini berstatus ${statusLabel.toLowerCase()} dan tidak dapat dibatalkan.`
        : "";

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (dialog && !element.open) element.showModal();
    if (!dialog && element.open) element.close();
  }, [dialog]);

  async function confirmAction() {
    if (!dialog || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await cancelBookingByToken(token);
      if (!result.ok) {
        setMessage(result.message);
        router.refresh();
        return;
      }

      setDialog(null);
      if (dialog === "reschedule") {
        router.push("/booking");
      } else {
        setMessage("Booking berhasil dibatalkan.");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        isNetworkError(error)
          ? NETWORK_ERROR_MESSAGE
          : "Pembatalan belum berhasil. Silakan coba lagi."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Ringkasan booking</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">
          Booking {summary.code}
        </h1>
        <dl className="mt-5 space-y-3 rounded-xl bg-ink/5 p-4 text-sm">
          <SummaryRow label="Nama" value={summary.customer_name} />
          <SummaryRow label="Layanan" value={summary.service_name} />
          <SummaryRow label="Kapster" value={summary.barber_name} />
          <SummaryRow
            label="Jadwal"
            value={`${jakartaDateFormatter.format(startsAt)} · ${jakartaTimeFormatter.format(
              startsAt
            )} WIB`}
          />
          <SummaryRow label="Status" value={statusLabel} />
        </dl>

        {message && (
          <p
            role={message.includes("berhasil") ? "status" : "alert"}
            className={`mt-4 rounded-xl p-3 text-sm ${
              message.includes("berhasil")
                ? "bg-emerald-50 text-emerald-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {message}
          </p>
        )}

        {!summary.can_cancel && blockReason && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {blockReason}
          </p>
        )}

        <div className="mt-5 grid gap-2">
          <button
            type="button"
            disabled={!summary.can_cancel || busy}
            onClick={() => setDialog("cancel")}
            className="btn-gold min-h-11 w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            Batalkan booking
          </button>
          <button
            type="button"
            disabled={!summary.can_cancel || busy}
            onClick={() => setDialog("reschedule")}
            className="min-h-11 w-full rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ubah jadwal
          </button>
          <Link
            href="/booking"
            className="min-h-11 rounded-xl px-4 py-2 text-center text-sm font-semibold text-ink/70 hover:bg-cream"
          >
            Kembali ke booking
          </Link>
        </div>
      </section>

      <dialog
        ref={dialogRef}
        aria-labelledby="booking-confirm-title"
        className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/50"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setDialog(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setDialog(null);
        }}
      >
        <div className="p-6">
          <h2
            id="booking-confirm-title"
            className="font-display text-xl font-semibold"
          >
            {dialog === "reschedule" ? "Ubah jadwal booking?" : "Batalkan booking?"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-ink/70">
            {dialog === "reschedule"
              ? "Booking ini akan dibatalkan, lalu kamu memilih jadwal baru."
              : "Booking ini akan dibatalkan dan slotnya tersedia kembali."}
          </p>
          {message && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {message}
            </p>
          )}
          <div className="mt-6 grid gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmAction()}
              className="btn-gold min-h-11 w-full disabled:opacity-50"
            >
              {busy
                ? "Memproses…"
                : dialog === "reschedule"
                  ? "Batalkan dan pilih jadwal"
                  : "Ya, batalkan booking"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog(null)}
              className="min-h-11 w-full rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream disabled:opacity-50"
            >
              Kembali
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink/60">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
