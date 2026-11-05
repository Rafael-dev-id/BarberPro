"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { updateBookingStatus } from "@/lib/admin-actions";
import { formatRupiah } from "@/lib/format";
import { isTooCloseToCancel } from "@/lib/slots";
import DateRangePicker, { type Value } from "@/components/DateRangePicker";
import { type Barber, type BookingRow, type Service, type WorkingHour } from "@/lib/types";
import AdminStats from "@/components/AdminStats";
import WalkInForm from "@/components/WalkInForm";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-400/15 text-yellow-300",
  confirmed: "bg-sky-400/15 text-sky-300",
  started: "bg-violet-400/15 text-violet-300",
  done: "bg-emerald-400/15 text-emerald-300",
  cancelled: "bg-red-400/15 text-red-300",
};

const fmtDay = (d: Date) =>
  d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }).toLowerCase();

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
  const [busyId, setBusyId] = useState<number | null>(null);
  const [range, setRange] = useState<"today" | "7d" | "30d" | "all" | "custom">("today");
  const [status, setStatus] = useState<"all" | "confirmed" | "started" | "done" | "cancelled">("all");
  const [barber, setBarber] = useState("all");
  const [q, setQ] = useState("");
  const [mounted, setMounted] = useState(false);
  // G2: tipe eksplisit. Tanpa generic, TS yakin state ini selamanya null.
  const [customRange, setCustomRange] = useState<Value | null>(null);
  const [live, setLive] = useState<string>("MENYAMBUNG…");
  const [page, setPage] = useState<number>(1);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInMessage, setWalkInMessage] = useState("");
  const [sortMode, setSortMode] = useState<"terbaru" | "slot">("terbaru");

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
      .subscribe((status: string) => setLive(status));

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(timer);
      clearInterval(clockTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  async function handleStatus(bookingId: number, newStatus: string) {
    if (newStatus === "cancelled") {
      const customer_name = bookings.find((b) => b.id === bookingId)?.customer_name;
      const yakin = window.confirm(`Batalkan booking atas nama ${customer_name}?`);
      if (!yakin) return;
    }

    setBusyId(bookingId);
    const result = await updateBookingStatus(bookingId, newStatus);
    setBusyId(null);
    if (!result.ok) {
      window.alert(result.message);
    } else {
      await reload();
    }
  }

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

      <div className="flex justify-between items-center pt-8 pb-3">
         <div className="flex flex-wrap items-center gap-3">
           <h2 className="font-display text-xl font-semibold">Semua Booking</h2>
           <button
             type="button"
             onClick={() => {
               if (!showWalkIn) setWalkInMessage("");
               setShowWalkIn(!showWalkIn);
             }}
             className="rounded-xl border border-gold px-3 py-2 text-xs font-bold text-gold-300 hover:bg-gold/10"
           >
             {showWalkIn ? "Tutup walk-in" : "Tambah walk-in"}
           </button>
         </div>
         <p className="text-[10px] uppercase tracking-widest text-cream/40">
           Kanal live: <span className="font-bold text-cream/70">{live}</span>
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
            walkInMessage.includes("gagal") ? "text-amber-300" : "text-emerald-300"
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
          className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm"
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
          className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm"
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
          className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm"
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
          className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm"
        />
        <div className="flex w-fit overflow-hidden rounded-xl border border-cream/15">
          <button
            type="button"
            aria-pressed={sortMode === "terbaru"}
            onClick={() => setSortMode("terbaru")}
            className={`px-3 py-2 text-xs ${
              sortMode === "terbaru"
                ? "bg-gold text-ink"
                : "text-cream/70 hover:bg-cream/5"
            }`}
          >
            Terbaru dahulu
          </button>
          <button
            type="button"
            aria-pressed={sortMode === "slot"}
            onClick={() => setSortMode("slot")}
            className={`border-l border-cream/15 px-3 py-2 text-xs ${
              sortMode === "slot"
                ? "bg-gold text-ink"
                : "text-cream/70 hover:bg-cream/5"
            }`}
          >
            Urut slot
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-cream/10 text-xs uppercase tracking-widest text-cream/50">
              <th className="py-2 pr-3">Waktu</th>
              <th className="py-2 pr-3">Pelanggan</th>
              <th className="py-2 pr-3">Layanan</th>
              <th className="py-2 pr-3">Barber</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-cream/50">
                  Belum ada booking masuk.
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-cream/50">
                  Tidak ada booking yang cocok dengan filter.
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <tr key={b.id} className="border-b border-cream/5">
                  <td className="py-2 pr-3">
                    {new Intl.DateTimeFormat("id-ID", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    })
                      .formatToParts(new Date(b.starts_at))
                      .map((part) =>
                        part.type === "month" ? part.value.toLowerCase() : part.value
                      )
                      .join("")}
                  </td>
                  <td className="py-2 pr-3">
                    {b.customer_name}
                    <span className="block text-xs text-cream/50">
                      {b.customer_phone.startsWith("walkin-")
                        ? "Tanpa nomor"
                        : b.customer_phone}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {b.services?.name ?? "-"}
                    <span className="block text-xs text-cream/50">
                      {formatRupiah(b.services?.price ?? 0)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{b.barbers?.name ?? "-"}</td>
                  <td className="py-2 pr-3 text-xs uppercase">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
                        statusColors[b.status] || "bg-cream/10"
                      }`}
                    >
                      {b.status}
                    </span>
                    {b.status === "confirmed" && isTooCloseToCancel(b.starts_at) && (
                      <span className="ml-1 rounded-full bg-amber-400/15 px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-amber-200">
                        mepet
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {b.status === "pending" && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "confirmed")}
                        className="rounded-xl bg-gold p-3 py-2 text-xs font-bold text-ink transition hover:bg-gold-soft disabled:opacity-50"
                      >
                        Konfirmasi
                      </button>
                    )}
                    {b.status === "confirmed" && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "started")}
                        className="rounded-xl bg-sky-500 p-3 py-2 text-xs font-bold text-ink transition hover:bg-sky-400 disabled:opacity-50"
                      >
                        Mulai sekarang
                      </button>
                    )}
                    {b.status === "started" && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "done")}
                        className="rounded-xl bg-emerald-500 p-3 py-2 text-xs font-bold text-ink transition hover:bg-emerald-400 disabled:opacity-50"
                      >
                        Selesai
                      </button>
                    )}
                    {(b.status === "confirmed" || b.status === "started") && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleStatus(b.id, "cancelled")}
                        className="ml-2 rounded-xl border border-red-400/40 px-3 py-1 text-xs text-red-300 disabled:opacity-50"
                      >
                        Batalkan
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="nav-btn flex gap-3 justify-end py-3">
           <span className="text-cream text-sm">Halaman {pageSafe} dari {pageCount} — [ {sortedFiltered.length} booking ]</span>
           <button className="btn rounded-xl border border-gold text-xs text-gold-300 disabled:opacity-50 px-3 py-1"
              disabled={pageSafe <= 1}
              onClick={() => setPage(page - 1)}
           >
              ← Sebelumnya
           </button>
           <button className="btn btn rounded-xl border border-gold text-xs text-gold-300 disabled:opacity-50 px-3 py-1"
              disabled={pageSafe >= pageCount}
              onClick={() => setPage(page + 1)}
           >
              Berikutnya →
           </button>
        </div>
      </div>
    </>
  );
}
