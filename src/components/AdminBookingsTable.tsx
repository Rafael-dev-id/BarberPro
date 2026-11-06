"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { updateBookingStatus } from "@/lib/admin-actions";
import { formatRupiah } from "@/lib/format";
import { isTooCloseToCancel } from "@/lib/slots";
import { getRowState } from "@/lib/booking-state";
import DateRangePicker, { type Value } from "@/components/DateRangePicker";
import { type Barber, type BookingRow, type Service, type WorkingHour } from "@/lib/types";
import AdminStats from "@/components/AdminStats";
import CashierPanel, { CashierRevenueTable } from "@/components/CashierPanel";
import ConfirmDialog from "@/components/ConfirmDialog";
import WalkInForm from "@/components/WalkInForm";

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900",
  confirmed: "bg-sky-100 text-sky-900",
  started: "bg-violet-100 text-violet-900",
  done: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-red-100 text-red-900",
};

const statusLabels: Record<string, string> = {
  pending: "Menunggu",
  confirmed: "Dikonfirmasi",
  started: "Sedang dikerjakan",
  done: "Selesai",
  cancelled: "Dibatalkan",
};

const fmtDay = (d: Date) =>
  d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }).toLowerCase();
const jakartaTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const jakartaDateFormatter = new Intl.DateTimeFormat("id-ID", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

function formatBookingDateTime(iso: string): string {
  const date = new Date(iso);
  const parts = jakartaDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = part("weekday").replace(/\.$/, "");
  const month = part("month").toLowerCase();
  return `${weekday}, ${part("day")} ${month} · ${jakartaTimeFormatter.format(date)}`;
}

export default function AdminBookingsTable({
  initialBookings,
  services,
  barbers,
  workingHours,
}: {
  initialBookings: BookingRow[];
  services: Service[];
  barbers: Barber[];
  workingHours: WorkingHour[];
}) {
  const [bookings, setBookings] = useState<BookingRow[]>(initialBookings);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [range, setRange] = useState<"today" | "7d" | "30d" | "all" | "custom">("today");
  const [status, setStatus] = useState<"all" | "confirmed" | "started" | "done" | "cancelled">("all");
  const [barber, setBarber] = useState("all");
  const [q, setQ] = useState("");
  const [mounted, setMounted] = useState(false);
  // G2: tipe eksplisit. Tanpa generic, TS yakin state ini selamanya null.
  const [customRange, setCustomRange] = useState<Value | null>(null);
  const [live, setLive] = useState<string>("MENYAMBUNG…");
  const liveStatusRef = useRef("MENYAMBUNG…");
  const [page, setPage] = useState<number>(1);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInMessage, setWalkInMessage] = useState("");
  const [sortMode, setSortMode] = useState<"terbaru" | "slot">("terbaru");
  const [pendingAction, setPendingAction] = useState<{
    id: number;
    status: "done" | "cancelled";
  } | null>(null);
  const [actionError, setActionError] = useState("");

  async function reload() {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("bookings")
      .select("*, services(name, price), barbers(name)")
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true });
     
    if (data) {
       // Urutkan data secara paksa di sisi klien berdasarkan string waktu/jam 'starts_at'
       const sortedData = [...data].sort((a, b) => {
         return (new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()) || (a.id - b.id);
       });
      
       setBookings(sortedData as BookingRow[]);
    }
    
    if (error) {
       setLive("RELOAD GAGAL"); 
       return;
    }
    setLive(liveStatusRef.current);
  }


  useEffect(() => {
    const timer = setTimeout(() => {
       setMounted(true);
    }, 0);
    const clockTimer = setInterval(() => {
      void reload();
    }, 30_000);

    const handleFocus = () => {
      void reload();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("bookings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          reload();
        }
      )
      .subscribe((status: string) => {
        liveStatusRef.current = status;
        setLive(status);
      });

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(timer);
      clearInterval(clockTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const clockTimer = setTimeout(() => setNowMs(Date.now()), 0);
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      clearTimeout(clockTimer);
      clearInterval(interval);
    };
  }, []);

  async function applyStatus(bookingId: number, newStatus: string): Promise<boolean> {
    setBusyId(bookingId);
    setActionError("");
    try {
      const result = await updateBookingStatus(bookingId, newStatus);
      if (!result.ok) {
        setActionError(result.message);
        return false;
      }
      await reload();
      return true;
    } catch {
      setActionError("Gagal terhubung. Coba lagi.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function handleStatus(bookingId: number, newStatus: string) {
    if (newStatus === "done" || newStatus === "cancelled") {
      setPendingAction({ id: bookingId, status: newStatus });
      return;
    }
    void applyStatus(bookingId, newStatus);
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    await applyStatus(pendingAction.id, pendingAction.status);
    setPendingAction(null);
  }

  const pendingBooking = pendingAction
    ? bookings.find((booking) => booking.id === pendingAction.id)
    : undefined;
  const pendingActionValid =
    pendingBooking &&
    ((pendingAction?.status === "done" &&
      (pendingBooking.status === "started" ||
        (pendingBooking.status === "confirmed" &&
          nowMs !== null &&
          getRowState(pendingBooking, nowMs) === "overdue"))) ||
      (pendingAction?.status === "cancelled" &&
        (pendingBooking.status === "confirmed" || pendingBooking.status === "started")));

  useEffect(() => {
    if (!pendingAction || pendingActionValid || busyId === pendingAction.id) return;
    const timer = setTimeout(() => setPendingAction(null), 0);
    return () => clearTimeout(timer);
  }, [pendingAction, pendingActionValid, busyId]);

  const pendingSchedule = pendingBooking
    ? formatBookingDateTime(pendingBooking.starts_at)
    : "";
  const notifyCustomer =
    pendingBooking && !pendingBooking.customer_phone.startsWith("walkin-");

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const startToday = new Date(`${todayStr}T00:00:00+07:00`).getTime();
  const endToday = new Date(`${todayStr}T23:59:59+07:00`).getTime();
  const end7 = startToday + 7 * 24 * 60 * 60 * 1000;
  const end30 = startToday + 30 * 24 * 60 * 60 * 1000;

  const barberNames = Array.from(new Set(bookings.map((b) => b.barbers?.name ?? "-")));

  const filtered = bookings.filter((b) => {
    const t = new Date(b.starts_at).getTime();
    if (range === "today" && (t < startToday || t > endToday)) return false;
    if (range === "7d" && (t < startToday || t > end7)) return false;
    if (range === "30d" && (t < startToday || t > end30)) return false;
    // G3: KABELENYA. Tanpa cabang ini, rentang kustom hanya menghias dropdown.
    // Butir hari dibanding milidetik: konsisten dengan preset lain di file ini.
    if (range === "custom" && customRange && Array.isArray(customRange)) {
      const [a, bb] = customRange;
      if (a && bb) {
        const s = new Date(`${a.toLocaleDateString("en-CA")}T00:00:00+07:00`).getTime();
        const e = new Date(`${bb.toLocaleDateString("en-CA")}T23:59:59+07:00`).getTime();
        if (t < s || t > e) return false;
      }
    }
    if (status !== "all" && b.status !== status) return false;
    if (barber !== "all" && (b.barbers?.name ?? "-") !== barber) return false;
    const needle = q.trim().toLowerCase();
    if (
      needle &&
      !b.customer_name.toLowerCase().includes(needle) &&
      !b.customer_phone.includes(needle)
    )
      return false;
    return true;
  });

  const handleSetCustomRange = (v: Value) => {
    setCustomRange(v);
  };

  const getDropdownLabel = () => {
    // G6: console.log dibuang. Label hanya menyebut rentang yang benar-benar aktif.
    if (range === "custom" && customRange && Array.isArray(customRange)) {
      const [a, bb] = customRange;
      if (a && bb) return `${fmtDay(a)} – ${fmtDay(bb)}`;
    }
    return "Rentang kustom…";
  };

  const liveState = live.toUpperCase();
  const liveLabel =
    liveState === "SUBSCRIBED"
      ? "Live"
      : liveState === "CONNECTING" || liveState === "JOINING"
        ? "Menyambung…"
        : "Terputus";
  const liveDotColor =
    liveState === "SUBSCRIBED"
      ? "bg-emerald-600"
      : liveState === "CONNECTING" || liveState === "JOINING"
        ? "bg-amber-500"
        : "bg-red-600";

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortMode === "slot") {
      return (
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() ||
        a.id - b.id
      );
    }

    const createdAt = (booking: BookingRow) => {
      if (
        "created_at" in booking &&
        typeof booking.created_at === "string"
      ) {
        return Date.parse(booking.created_at);
      }
      return 0;
    };
    return createdAt(b) - createdAt(a) || b.id - a.id;
  });
  const pageCount = Math.max(1, Math.ceil(sortedFiltered.length / 10));
  const pageSafe = Math.min(page, pageCount);
  const rows = sortedFiltered.slice((pageSafe - 1) * 10, pageSafe * 10);

  useEffect(() => {
     const timer = setTimeout(() => {
        setPage(1);
     }, 0);

     return () => clearTimeout(timer);
  }, [range, status, barber, q, customRange]);

  return (
    <>
      <AdminStats bookings={bookings} />
      <section className="card mt-8 p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Kasir</h2>
        <p className="mt-1 text-sm text-ink/70">
          Pantau sesi yang sedang berjalan dan hasil kerja hari ini.
        </p>
        <CashierPanel
          bookings={bookings}
          barbers={barbers}
          busyId={busyId}
          onFinish={(id) => handleStatus(id, "done")}
        />
        <CashierRevenueTable bookings={bookings} barbers={barbers} />
      </section>

      <section className="card mt-8 p-5 sm:p-6">
      {actionError && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <p>{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError("")}
            className="min-h-11 shrink-0 rounded-lg border border-red-300 px-3 py-2 font-semibold hover:bg-red-100"
          >
            Tutup
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
         <div className="flex flex-wrap items-center gap-3">
           <h2 className="font-display text-xl font-semibold">Semua Booking</h2>
           <p className="w-full text-sm text-ink/70 sm:w-auto">
             Cari, saring, dan kelola jadwal pelanggan.
           </p>
           <button
             type="button"
             onClick={() => {
               if (!showWalkIn) setWalkInMessage("");
               setShowWalkIn(!showWalkIn);
             }}
             className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream"
           >
             {showWalkIn ? "Tutup walk-in" : "Tambah walk-in"}
           </button>
         </div>
         <p
           title={live}
           className="flex items-center gap-2 text-sm font-semibold text-ink/70"
         >
           <span className={`h-2.5 w-2.5 rounded-full ${liveDotColor}`} aria-hidden="true" />
           {liveLabel}
         </p>
      </div>
      
      {showWalkIn && (
        <WalkInForm
          services={services}
          barbers={barbers}
          workingHours={workingHours}
          onSuccess={(message) => {
            setWalkInMessage(message);
            setShowWalkIn(false);
            void reload();
          }}
        />
      )}
      {walkInMessage && (
        <p
          role="status"
          className={`mb-4 text-sm ${
            walkInMessage.toLowerCase().includes("gagal") ? "text-amber-800" : "text-emerald-800"
          }`}
        >
          {walkInMessage}
        </p>
      )}

      {/* S5: mount hanya di klien — kalender tidak boleh dirender server. */}
      {mounted && range === "custom" && (
        <DateRangePicker onSendRange={handleSetCustomRange} />
      )}

       
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <select
          value={range}
          onChange={(e) => {
            const next = e.target.value as typeof range;
            setRange(next);
            // G4: aturan reset rancangan S3 Rafael — ganti preset = kustom lenyap.
            if (next !== "custom") setCustomRange(null);
          }}
          className="input-premium"
        >
          <option value="all">Semua tanggal</option>
          <option value="today">Hari ini</option>
          <option value="7d">7 hari ke depan</option>
          <option value="30d">30 hari ke depan</option>
          <option value="custom">{getDropdownLabel()}</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="input-premium"
        >
          <option value="all">Semua status</option>
          <option value="confirmed">Dikonfirmasi</option>
          <option value="started">Sedang dikerjakan</option>
          <option value="done">Selesai</option>
          <option value="cancelled">Dibatalkan</option>
        </select>
        <select
          value={barber}
          onChange={(e) => setBarber(e.target.value)}
          className="input-premium"
        >
          <option value="all">Semua kapster</option>
          {barberNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nama / nomor…"
          className="input-premium"
        />
        <div className="flex w-fit overflow-hidden rounded-xl border border-line">
          <button
            type="button"
            aria-pressed={sortMode === "terbaru"}
            onClick={() => setSortMode("terbaru")}
            className={`min-h-11 px-3 py-2 text-sm ${
              sortMode === "terbaru"
                ? "bg-gold text-ink"
                : "text-ink/70 hover:bg-cream"
            }`}
          >
            Terbaru dahulu
          </button>
          <button
            type="button"
            aria-pressed={sortMode === "slot"}
            onClick={() => setSortMode("slot")}
            className={`min-h-11 border-l border-line px-3 py-2 text-sm ${
              sortMode === "slot"
                ? "bg-gold text-ink"
                : "text-ink/70 hover:bg-cream"
            }`}
          >
            Urut slot
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm md:text-base">
          <thead>
            <tr className="border-b border-line bg-cream text-xs font-semibold uppercase tracking-wide text-ink/70">
              <th className="py-3 pr-3">Waktu</th>
              <th className="py-3 pr-3">Pelanggan</th>
              <th className="py-3 pr-3">Layanan</th>
              <th className="py-3 pr-3">Kapster</th>
              <th className="py-3 pr-3">Status</th>
              <th className="py-3">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-ink/70">
                  Belum ada booking masuk.
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-ink/70">
                  Tidak ada booking yang cocok dengan filter.
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const rowState =
                  nowMs === null ? "other" : getRowState(b, nowMs);
                return (
                <tr key={b.id} className="border-b border-line">
                  <td className="py-3 pr-3">
                    {formatBookingDateTime(b.starts_at)}
                  </td>
                  <td className="py-3 pr-3">
                    {b.customer_name}
                    <span className="block text-xs text-ink/70">
                      {b.customer_phone.startsWith("walkin-")
                        ? "Tanpa nomor"
                        : b.customer_phone}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {b.services?.name ?? "-"}
                    <span className="block text-xs text-ink/70">
                      {formatRupiah(b.services?.price ?? 0)}
                    </span>
                  </td>
                  <td className="py-3 pr-3">{b.barbers?.name ?? "-"}</td>
                  <td className="py-3 pr-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        statusColors[b.status] || "bg-cream text-ink/70"
                      }`}
                    >
                      {statusLabels[b.status] ?? b.status}
                    </span>
                    {rowState === "overdue" && b.status === "confirmed" && (
                      <span
                        title="Jadwal sudah lewat lebih dari 15 menit"
                        className="ml-1 inline-flex rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800"
                      >
                        Terlewat
                      </span>
                    )}
                    {rowState === "stale_session" && (
                      <span
                        title="Sesi dimulai di hari sebelumnya dan belum ditutup"
                        className="ml-1 inline-flex rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800"
                      >
                        Belum ditutup
                      </span>
                    )}
                    {rowState === "future_session" && (
                      <span className="ml-1 inline-flex rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">
                        Jadwal belum tiba
                      </span>
                    )}
                    {b.status === "confirmed" &&
                      rowState === "today" &&
                      nowMs !== null &&
                      new Date(b.starts_at).getTime() > nowMs &&
                      isTooCloseToCancel(b.starts_at) && (
                      <span
                        title="Kurang dari 30 menit lagi"
                        className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900"
                      >
                        Segera
                      </span>
                    )}
                  </td>
                  <td className="py-3">
                    {b.status === "pending" && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "confirmed")}
                        className="min-h-11 rounded-xl bg-gold px-3 py-2 text-sm font-bold text-ink transition hover:bg-gold-soft disabled:opacity-50"
                      >
                        Konfirmasi
                      </button>
                    )}
                    {b.status === "confirmed" && rowState === "upcoming" && (
                      <span className="mr-2 text-sm text-ink/70">
                        Mulai di hari H
                      </span>
                    )}
                    {b.status === "confirmed" && rowState === "today" && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "started")}
                        className="min-h-11 rounded-xl bg-sky-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
                      >
                        Mulai sekarang
                      </button>
                    )}
                    {((b.status === "started" &&
                      (rowState === "in_session" || rowState === "stale_session")) ||
                      (b.status === "confirmed" && rowState === "overdue")) && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "done")}
                        className="min-h-11 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Selesai
                      </button>
                    )}
                    {(b.status === "confirmed" || b.status === "started") && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "cancelled")}
                        className="ml-2 min-h-11 rounded-xl border border-red-600 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                      >
                        Batalkan
                      </button>
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="nav-btn flex gap-3 justify-end py-3">
           <span className="text-ink/70 text-sm">Halaman {pageSafe} dari {pageCount} — [ {sortedFiltered.length} booking ]</span>
           <button className="btn min-h-11 rounded-xl border border-line px-3 py-2 text-sm text-ink disabled:opacity-50 hover:bg-cream"
              disabled={pageSafe <= 1}
              onClick={() => setPage(page - 1)}
           >
              ← Sebelumnya
           </button>
           <button className="btn min-h-11 rounded-xl border border-line px-3 py-2 text-sm text-ink disabled:opacity-50 hover:bg-cream"
              disabled={pageSafe >= pageCount}
              onClick={() => setPage(page + 1)}
           >
              Berikutnya →
           </button>
        </div>
      </div>
      </section>
      <ConfirmDialog
        open={Boolean(pendingActionValid)}
        tone={pendingAction?.status === "done" ? "success" : "danger"}
        title={
          pendingAction?.status === "done"
            ? "Selesaikan sesi?"
            : "Batalkan booking?"
        }
        details={
          pendingBooking
            ? [
                { label: "Pelanggan", value: pendingBooking.customer_name },
                { label: "Layanan", value: pendingBooking.services?.name ?? "-" },
                { label: "Kapster", value: pendingBooking.barbers?.name ?? "-" },
                { label: "Jadwal", value: pendingSchedule },
                {
                  label: "Total",
                  value: formatRupiah(pendingBooking.services?.price ?? 0),
                },
              ]
            : []
        }
        note={
          pendingAction?.status === "done"
            ? `Sesi ditutup dan tidak bisa dibatalkan dari dashboard.${
                pendingBooking?.status === "confirmed"
                  ? " Booking ini belum pernah dimulai; sesi akan dicatat selesai."
                  : ""
              }${
                notifyCustomer ? " Pelanggan akan dikabari lewat WhatsApp." : ""
              }`
            : `Slot akan dibuka kembali.${
                notifyCustomer ? " Pelanggan akan dikabari lewat WhatsApp." : ""
              }`
        }
        confirmLabel={
          pendingAction?.status === "done"
            ? `Ya, selesai · ${formatRupiah(pendingBooking?.services?.price ?? 0)}`
            : "Ya, batalkan"
        }
        busy={pendingAction !== null && busyId === pendingAction.id}
        onConfirm={() => void confirmPendingAction()}
        onCancel={() => {
          if (busyId !== pendingAction?.id) setPendingAction(null);
        }}
      />
    </>
  );
}
