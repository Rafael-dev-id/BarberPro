"use client";

import { useEffect, useState } from "react";
import { getJakartaNow } from "@/lib/slots";
import { formatRupiah } from "@/lib/format";
import { getRowState, minutesPastEnd } from "@/lib/booking-state";
import { type Barber, type BookingRow } from "@/lib/types";

interface CashierPanelProps {
  bookings: BookingRow[];
  barbers: Barber[];
  busyId: number | null;
  onFinish: (bookingId: number) => void;
}

const LATE_QUEUE_MINUTES = 30;

const jakartaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
});
const jakartaTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatJakartaTime(value: string): string {
  return jakartaTimeFormatter.format(new Date(value));
}

export default function CashierPanel({
  bookings,
  barbers,
  busyId,
  onFinish,
}: CashierPanelProps) {
  const today = getJakartaNow().date;
  const [nowMs, setNowMs] = useState<number | null>(null);
  const queueCutoff = nowMs === null
    ? null
    : nowMs - LATE_QUEUE_MINUTES * 60_000;
  const todayBookings = bookings.filter(
    (booking) => jakartaDateFormatter.format(new Date(booking.starts_at)) === today
  );

  useEffect(() => {
    const clockTimer = setTimeout(() => setNowMs(Date.now()), 0);
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      clearTimeout(clockTimer);
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="mt-6">
      <h2 className="font-display text-xl font-semibold">Sedang dikerjakan</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {barbers.filter((barber) => barber.is_active).map((barber) => {
          const startedBookings = todayBookings.filter(
            (booking) =>
              booking.status === "started" &&
              booking.barbers?.name === barber.name
          );
          const overtimeBookings =
            nowMs === null
              ? []
              : startedBookings.filter(
                  (booking) => getRowState(booking, nowMs) === "overtime"
                );
          const hasOvertime = overtimeBookings.length > 0;
          const nextBooking = todayBookings
            .filter(
              (booking) =>
                booking.status === "confirmed" &&
                booking.barbers?.name === barber.name &&
                queueCutoff !== null &&
                new Date(booking.starts_at).getTime() >= queueCutoff
            )
            .sort(
              (left, right) =>
                new Date(left.starts_at).getTime() -
                new Date(right.starts_at).getTime()
            )[0];

          return (
            <article
              key={barber.id}
              className={`rounded-2xl border p-4 ${
                hasOvertime
                  ? "border-amber-300 bg-amber-50"
                  : startedBookings.length > 0
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-line bg-white"
              }`}
            >
              <h3 className="flex items-center gap-2 font-semibold text-ink">
                {startedBookings.length > 0 && (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      hasOvertime ? "bg-amber-500" : "bg-emerald-600"
                    }`}
                    aria-hidden="true"
                  />
                )}
                {barber.name}
              </h3>
              {startedBookings.length > 1 && (
                <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  {startedBookings.length} sesi berjalan bersamaan
                </p>
              )}
              {startedBookings.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {startedBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="rounded-xl border border-emerald-200 bg-white p-3"
                    >
                      <p className="font-medium text-ink">{booking.customer_name}</p>
                      <p className="mt-1 text-sm text-ink/70">
                        {booking.services?.name ?? "Layanan"} ·{" "}
                        {booking.customer_phone.startsWith("walkin-")
                          ? "Tanpa nomor"
                          : booking.customer_phone}
                      </p>
                      <p className="mt-1 text-sm text-ink/70">
                        Mulai {formatJakartaTime(booking.starts_at)} · estimasi selesai{" "}
                        {formatJakartaTime(booking.ends_at)}
                      </p>
                      {nowMs !== null &&
                        getRowState(booking, nowMs) === "overtime" && (
                          <p className="mt-2 text-sm font-semibold text-red-700">
                            Lewat estimasi {minutesPastEnd(booking.ends_at, nowMs)} mnt.
                            Tekan Selesai bila sudah selesai.
                          </p>
                        )}
                      {booking.customer_notes && (
                        <p className="mt-2 text-sm text-ink/70">
                          Catatan: {booking.customer_notes}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => onFinish(booking.id)}
                        className="mt-3 min-h-11 w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Selesai · {formatRupiah(booking.services?.price ?? 0)}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-ink/70">Kosong</p>
              )}
              <p className="mt-3 border-t border-line pt-3 text-sm text-ink/70">
                {nextBooking && nowMs !== null
                  ? new Date(nextBooking.starts_at).getTime() >= nowMs
                    ? `Berikutnya: ${nextBooking.customer_name} · ${formatJakartaTime(nextBooking.starts_at)}`
                    : `Menunggu: ${nextBooking.customer_name} · jadwal ${formatJakartaTime(nextBooking.starts_at)} (telat ${Math.floor((nowMs - new Date(nextBooking.starts_at).getTime()) / 60_000)} mnt)`
                  : "Tidak ada antrean"}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function CashierRevenueTable({
  bookings,
  barbers,
}: Pick<CashierPanelProps, "bookings" | "barbers">) {
  const today = getJakartaNow().date;
  const todayBookings = bookings.filter(
    (booking) => jakartaDateFormatter.format(new Date(booking.starts_at)) === today
  );
  const doneToday = todayBookings.filter((booking) => booking.status === "done");
  const activeBarberNames = barbers
    .filter((barber) => barber.is_active)
    .map((barber) => barber.name);
  const otherBarberNames = Array.from(
    new Set(doneToday.map((booking) => booking.barbers?.name ?? "Tanpa kapster"))
  ).filter((name) => !activeBarberNames.includes(name));
  const revenueRows = Array.from(new Set([...activeBarberNames, ...otherBarberNames]));

  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-semibold">
        Selesai hari ini per kapster
      </h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="bg-cream text-ink/70">
            <tr>
              <th className="px-4 py-2 font-medium">Kapster</th>
              <th className="px-4 py-2 text-right font-medium">Sesi</th>
              <th className="px-4 py-2 text-right font-medium">Rupiah</th>
            </tr>
          </thead>
          <tbody>
            {revenueRows.map((name) => {
              const barberDone = doneToday.filter(
                (booking) => (booking.barbers?.name ?? "Tanpa kapster") === name
              );
              const revenue = barberDone.reduce(
                (total, booking) => total + (booking.services?.price ?? 0),
                0
              );
              return (
                <tr key={name} className="border-t border-line">
                  <td className="px-4 py-2 text-ink">{name}</td>
                  <td className="px-4 py-2 text-right text-ink/70">
                    {barberDone.length}
                  </td>
                  <td className="px-4 py-2 text-right text-ink/70">
                    {formatRupiah(revenue)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-line bg-cream font-bold">
              <td className="px-4 py-2 text-ink">Total</td>
              <td className="px-4 py-2 text-right text-ink">{doneToday.length}</td>
              <td className="px-4 py-2 text-right text-ink">
                {formatRupiah(
                  doneToday.reduce(
                    (total, booking) => total + (booking.services?.price ?? 0),
                    0
                  )
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
