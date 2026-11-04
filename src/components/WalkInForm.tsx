"use client";

import { useEffect, useState } from "react";
import { createWalkInBooking } from "@/lib/admin-actions";
import { getBookedSlots } from "@/lib/booking-actions";
import { filterPastSlots, generateSlots, minutesToTime, timeToMinutes } from "@/lib/slots";
import { type Barber, type Service, type WorkingHour } from "@/lib/types";

interface WalkInFormProps {
  services: Service[];
  barbers: Barber[];
  workingHours: WorkingHour[];
  onSuccess: (message: string) => void;
}

function isSlotTaken(
  slot: number,
  duration: number,
  ranges: { startMinutes: number; endMinutes: number }[]
) {
  const slotEnd = slot + duration;
  return ranges.some(
    (range) => slot < range.endMinutes && slotEnd > range.startMinutes
  );
}

export default function WalkInForm({
  services,
  barbers,
  workingHours,
  onSuccess,
}: WalkInFormProps) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [date, setDate] = useState(today);
  const [slotMinutes, setSlotMinutes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [sendWa, setSendWa] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<number[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const service = services.find((item) => item.id === Number(serviceId));
  const selectedBarber = barbers.find((item) => item.id === Number(barberId));

  useEffect(() => {
    if (!service || !selectedBarber || !date) return;

    const activeService = service;
    const activeBarber = selectedBarber;
    let cancelled = false;
    async function loadSlots() {
      setLoadingSlots(true);
      setErrorMessage("");
      try {
        const ranges = await getBookedSlots(activeBarber.id, date);
        if (cancelled) return;

        const weekday = new Date(`${date}T00:00:00`).getDay();
        const slots = workingHours
          .filter(
            (hours) =>
              hours.barber_id === activeBarber.id &&
              hours.weekday === weekday
          )
          .flatMap((hours) =>
            filterPastSlots(
              generateSlots(
                timeToMinutes(hours.start_time),
                timeToMinutes(hours.end_time),
                activeService.duration
              ),
              date
            )
          )
          .filter((slot) =>
            !isSlotTaken(slot, activeService.duration, ranges)
          );

        setAvailableSlots(slots);
        setSlotMinutes(slots.length > 0 ? String(slots[0]) : "");
      } catch {
        if (!cancelled) {
          setAvailableSlots([]);
          setSlotMinutes("");
          setErrorMessage("Gagal memuat ketersediaan jam. Silakan coba lagi.");
        }
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    }

    void loadSlots();
    return () => {
      cancelled = true;
    };
  }, [barberId, date, serviceId, workingHours, service, selectedBarber]);

  async function save(startNow: boolean) {
    if (submitting || !service || !selectedBarber || !slotMinutes) return;

    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await createWalkInBooking({
        customerName,
        customerPhone: customerPhone.trim() || undefined,
        serviceId: service.id,
        barberId: selectedBarber.id,
        date,
        slotMinutes: Number(slotMinutes),
        startNow,
        sendWa: !startNow && sendWa,
        customerNotes,
      });

      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }

      setCustomerName("");
      setCustomerPhone("");
      setServiceId("");
      setBarberId("");
      setDate(today);
      setSlotMinutes("");
      setCustomerNotes("");
      setSendWa(false);
      onSuccess(result.message);
    } catch {
      setErrorMessage("Walk-in gagal disimpan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-5 rounded-2xl border border-gold/40 bg-ink/60 p-4">
      <h3 className="font-display text-lg font-semibold">Catat walk-in</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-cream/70">
          Nama
          <input
            required
            minLength={3}
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
        </label>
        <label className="grid gap-1 text-xs text-cream/70">
          Nomor WA (opsional)
          <input
            type="tel"
            value={customerPhone}
            onChange={(event) => {
              setCustomerPhone(event.target.value);
              if (!event.target.value.trim()) setSendWa(false);
            }}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
        </label>
        <label className="grid gap-1 text-xs text-cream/70">
          Layanan
          <select
            required
            value={serviceId}
            onChange={(event) => {
              setServiceId(event.target.value);
              setAvailableSlots([]);
              setSlotMinutes("");
              setLoadingSlots(false);
            }}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          >
            <option value="">Pilih layanan</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.duration} menit
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-cream/70">
          Kapster
          <select
            required
            value={barberId}
            onChange={(event) => {
              setBarberId(event.target.value);
              setAvailableSlots([]);
              setSlotMinutes("");
              setLoadingSlots(false);
            }}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          >
            <option value="">Pilih kapster</option>
            {barbers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-cream/70">
          Tanggal
          <input
            type="date"
            min={today}
            required
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setAvailableSlots([]);
              setSlotMinutes("");
              setLoadingSlots(false);
            }}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
        </label>
        <label className="grid gap-1 text-xs text-cream/70">
          Jam
          <select
            required
            value={slotMinutes}
            disabled={loadingSlots || availableSlots.length === 0}
            onChange={(event) => setSlotMinutes(event.target.value)}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream disabled:opacity-50"
          >
            {availableSlots.length === 0 ? (
              <option value="">
                {loadingSlots ? "Memuat jam…" : "Tidak ada jam tersedia"}
              </option>
            ) : (
              availableSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {minutesToTime(slot)}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-cream/70 sm:col-span-2">
          Catatan (opsional)
          <textarea
            maxLength={300}
            rows={2}
            value={customerNotes}
            onChange={(event) => setCustomerNotes(event.target.value)}
            className="rounded-xl border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
        </label>
      </div>

      {customerPhone.trim() && (
        <label className="mt-4 flex items-center gap-2 text-xs text-cream/70">
          <input
            type="checkbox"
            checked={!!customerPhone.trim()}
            onChange={(event) => setSendWa(event.target.checked)}
            className="accent-gold"
          />
          Kirim WA konfirmasi ke pelanggan (untuk simpan ke antre)
        </label>
      )}

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={
            submitting || loadingSlots || !slotMinutes || customerName.trim().length < 3
          }
          onClick={() => void save(false)}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-ink disabled:opacity-50"
        >
          {submitting ? "Menyimpan…" : "Simpan ke antre"}
        </button>
        <button
          type="button"
          disabled={
            submitting || loadingSlots || !slotMinutes || customerName.trim().length < 3
          }
          onClick={() => void save(true)}
          className="rounded-xl border border-sky-400 px-4 py-2 text-sm font-bold text-sky-200 disabled:opacity-50"
        >
          Mulai sekarang
        </button>
      </div>
    </div>
  );
}
