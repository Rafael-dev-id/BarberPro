"use client";

import { useState, useEffect } from "react";
import { isValidIndonesianPhone, normalizePhone } from "@/lib/phone";
import { formatRupiah } from "@/lib/format";
import { minutesToTime } from "@/lib/slots";
import { createBooking } from "@/lib/booking-actions";
import Link from "next/link";

interface BookingFormProps {
  complete: boolean;
  serviceId: number;
  barberId: number;
  serviceName: string;
  barberName: string;
  date: string;
  dateLabel?: string;
  slotMinutes: number;
  onBooked: (token: string) => void;
  onSlotConflict: () => void;
  onStartAnother: () => void;
}

interface FormErrors {
  name?: string;
  phone?: string;
}

type SubmitStatus = "idle" | "loading" | "success" | "error";
type BookingSummary = {
  publicToken: string;
  code: string;
  serviceName: string;
  barberName: string;
  dateLabel: string;
  timeLabel: string;
  price: number;
};

export default function BookingForm({
  complete,
  serviceId,
  barberId,
  serviceName,
  barberName,
  date,
  dateLabel,
  slotMinutes,
  onBooked,
  onSlotConflict,
  onStartAnother,
}: BookingFormProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [serverMessage, setServerMessage] = useState("");
  const [serverWarning, setServerWarning] = useState("");
  const [bookingSummary, setBookingSummary] = useState<BookingSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  function getManagementUrl(token: string): string {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    return new URL(`/ringkasan/${token}`, siteUrl).toString();
  }

  async function copyManagementUrl(token: string) {
    const url = getManagementUrl(token);
    setCopied(false);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      try {
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand("copy")) {
          setCopyError("Tautan tidak dapat disalin. Salin alamat secara manual.");
          return;
        }
      } catch {
        setCopyError("Tautan tidak dapat disalin. Salin alamat secara manual.");
        return;
      } finally {
        textarea.remove();
      }
    }
    setCopied(true);
  }

  function clearError(field: keyof FormErrors) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (customerName.trim().length < 3) {
      newErrors.name = "Nama minimal 3 karakter.";
    }
    if (!isValidIndonesianPhone(customerPhone)) {
      newErrors.phone = "Nomor tidak valid. Contoh: 081234567890";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    setStatus("loading");

    const result = await createBooking({
      serviceId,
      barberId,
      date,
      slotMinutes,
      customerName: customerName.trim(),
      customerPhone: normalizePhone(customerPhone),
      customerNotes: customerNotes.trim(),
    });

    setStatus(result.ok ? "success" : "error");
    setServerMessage(result.message);
    setServerWarning(result.ok ? result.warning ?? "" : "");
    setBookingSummary(result.ok ? result.summary : null);

    if (result.ok) {
      try {
        localStorage.setItem("barberpro:last-booking", result.summary.publicToken);
      } catch {
        // Booking tetap berhasil bila penyimpanan browser tidak tersedia.
      }
      onBooked(result.summary.publicToken);
    }
    else if (result.message === "Slot itu baru saja diambil pelanggan lain. Silakan pilih jam lain.") {
      onSlotConflict();
    }
  }

  function resetForm() {
     setCustomerName("");
     setCustomerPhone("");
     setCustomerNotes("");
     setErrors({});
     setStatus("idle");
     setServerMessage("");
     setServerWarning("");
     setBookingSummary(null);
     setCopied(false);
     setCopyError("");
     onStartAnother();
  }

  // Patroli: kalau pilihan dari induk berubah, catatan gagal sudah basi → cabut.
  useEffect(() => {
     // eslint-disable-next-line react-hooks/set-state-in-effect
     setStatus((current) => current === "error" ? "idle" : current);
     setServerMessage("");
     setServerWarning("");
  }, [date, serviceId, barberId]);

  /* Saat belum lengkap: tampilkan kartu ringkasan "hidup".
     Component tetap MOUNTED (state aman), hanya isinya berbeda. */
  if (!complete && status !== "success") {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">
           Ringkasan
        </h2>
        <ul className="mt-4 space-y-2 text-sm">
          <li className={serviceName ? "text-ink" : "text-ink/40"}>
            {serviceName || "Pilih layanan"}
          </li>
          <li className={barberName ? "text-ink" : "text-ink/40"}>
            {barberName || "Pilih barber"}
          </li>
          <li className={date ? "text-ink" : "text-ink/40"}>
            {date ? dateLabel ?? date : "Pilih tanggal"}
          </li>
        </ul>
        <p className="mt-5 rounded-xl bg-ink/5 p-3 text-xs text-ink/50">
          Lengkapi pilihanmu — ringkasan & form akan terbuka di sini.
        </p>
      </section>
    );
  }

  if (status === "success") {
     return (
        <section className="card p-5">
           <h2 className="font-display text-lg font-semibold">
              Booking Berhasil
           </h2>
           {bookingSummary && (
             <dl className="mt-3 space-y-1 rounded-xl bg-ink/5 p-4 text-sm">
               <div className="flex justify-between gap-3">
                 <dt className="text-ink/60">Kode booking</dt>
                 <dd className="flex items-center gap-2 text-right font-semibold tracking-wider">
                   {bookingSummary.code}
                   <button
                     type="button"
                     onClick={() => void copyManagementUrl(bookingSummary.publicToken)}
                     className="text-xs font-medium tracking-normal text-ink/60 underline underline-offset-2 hover:text-ink"
                   >
                     {copied ? "Tersalin" : "Salin tautan"}
                   </button>
                 </dd>
               </div>
               <div className="flex justify-between gap-3">
                 <dt className="text-ink/60">Layanan</dt>
                 <dd className="text-right font-medium">{bookingSummary.serviceName}</dd>
               </div>
               <div className="flex justify-between gap-3">
                 <dt className="text-ink/60">Kapster</dt>
                 <dd className="text-right font-medium">{bookingSummary.barberName}</dd>
               </div>
               <div className="flex justify-between gap-3">
                 <dt className="text-ink/60">Tanggal</dt>
                 <dd className="text-right font-medium">{bookingSummary.dateLabel}</dd>
               </div>
               <div className="flex justify-between gap-3">
                 <dt className="text-ink/60">Jam</dt>
                 <dd className="text-right font-medium">{bookingSummary.timeLabel} WIB</dd>
               </div>
               <div className="flex justify-between gap-3">
                 <dt className="text-ink/60">Harga</dt>
                 <dd className="text-right font-medium">{formatRupiah(bookingSummary.price)}</dd>
               </div>
             </dl>
           )}
           {copyError && (
             <p role="status" className="mt-2 text-sm text-red-700">{copyError}</p>
           )}
           {bookingSummary && (
             <Link
               href={`/ringkasan/${bookingSummary.publicToken}`}
               className="btn-gold mt-4 block min-h-11 w-full text-center"
             >
               Kelola booking
             </Link>
           )}
           <p className="mt-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
             Booking berhasil.
           </p>
           {serverWarning && (
             <p className="mt-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
               {serverWarning}
             </p>
           )}

           <button
              type="button"
              onClick={resetForm}
              className="mt-3 min-h-11 w-full rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream"
           >
              Buat booking lain
           </button>
           <Link
              href="/"
              className="mt-2 block py-2 text-center text-xs font-medium text-ink/60 underline underline-offset-2 hover:text-ink"
           >
              Ke beranda
           </Link>
        </section>
     );
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg font-semibold">Ringkasan</h2>

      <div className="mt-4 rounded-xl bg-ink p-4 text-cream">
        <p className="text-sm font-bold text-gold">{serviceName}</p>
        <p className="mt-1 text-xs text-cream/70">
          {barberName} · {dateLabel ?? date} · {minutesToTime(slotMinutes)} WIB
        </p>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="name" className="label-premium">Nama</label>
          <input
            id="name"
            type="text"
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              clearError("name");
            }}
            placeholder="Nama depan"
            className="input-premium"
          />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="phone" className="label-premium">Nomor WhatsApp</label>
          <input
            id="phone"
            type="tel"
            value={customerPhone}
            onChange={(e) => {
              setCustomerPhone(e.target.value);
              clearError("phone");
              if (
                status === "error" &&
                serverMessage !==
                  "Slot itu baru saja diambil pelanggan lain. Silakan pilih jam lain."
              ) {
                setStatus("idle");
                setServerMessage("");
              }
            }}
            placeholder="08xxxxxxxxxx"
            className="input-premium"
          />
          {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
        </div>

        <div>
          <label htmlFor="notes" className="label-premium">Catatan (opsional)</label>
          <textarea
            id="notes"
            value={customerNotes}
            onChange={(e) => setCustomerNotes(e.target.value)}
            placeholder="Contoh: jangan terlalu pendek"
            rows={3}
            className="input-premium"
          />
        </div>

        {status === "error" && (
          <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700 whitespace-pre-line [word-spacing:1px] tracking-[.5px] leading-[15px]">
            {serverMessage}
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "loading"}
          className="btn-gold w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Menyimpan..." : "Konfirmasi Booking"}
        </button>
      </div>
    </section>
  );
}