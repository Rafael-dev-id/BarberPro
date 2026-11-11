"use client";

import { useEffect, useState } from "react";
import { createWalkInBooking } from "@/lib/admin-actions";
import { getBookedSlots } from "@/lib/booking-actions";
import {
  effectiveStart,
  filterPastSlots,
  generateSlots,
  getJakartaNow,
  minutesToTime,
  timeToMinutes,
} from "@/lib/slots";
import { type Barber, type Service, type WorkingHour } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

type WalkInInput = Parameters<typeof createWalkInBooking>[0];
type WalkInResolution = NonNullable<Parameters<typeof createWalkInBooking>[1]>;
type WalkInBarber = Pick<Barber, "id" | "name">;

interface WalkInFormProps {
  services: Service[];
  barbers: Barber[];
  workingHours: WorkingHour[];
  startedBarberIds: number[];
  onSuccess: (message: string) => void;
}

function isSlotTaken(
  slot: number,
  duration: number,
  ranges: { startMinutes: number; endMinutes: number }[],
  date: string
) {
  const now = getJakartaNow();
  const slotEnd =
    effectiveStart(slot, now.minutes, date === now.date) + duration;
  const slotStart = effectiveStart(slot, now.minutes, date === now.date);
  return ranges.some(
    (range) => slotStart < range.endMinutes && slotEnd > range.startMinutes
  );
}

export default function WalkInForm({
  services,
  barbers,
  workingHours,
  startedBarberIds,
  onSuccess,
}: WalkInFormProps) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("0");
  const [date, setDate] = useState(today);
  const [slotMinutes, setSlotMinutes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [availableSlots, setAvailableSlots] = useState<number[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [startConflict, setStartConflict] = useState<{
    conflict: {
      barberName: string;
      customerName: string;
      time: string;
      kind: "running" | "booked";
      message: string;
      suggestedBarber?: WalkInBarber;
      nearestSlotSame?: { barber: WalkInBarber; startsAt: string; label: string };
      nearestSlotAny?: {
        barber: WalkInBarber;
        startsAt: string;
        label: string;
      };
    };
    input: WalkInInput;
  } | null>(null);

  const service = services.find((item) => item.id === Number(serviceId));
  const selectedBarber =
    barberId === "0"
      ? undefined
      : barbers.find((item) => item.id === Number(barberId));

  useEffect(() => {
    if (!service || !barberId || !date) return;

    const activeService = service;
    const activeBarbers =
      barberId === "0"
        ? barbers.filter(
            (item) =>
              item.is_active && !startedBarberIds.includes(item.id)
          )
        : selectedBarber
          && !startedBarberIds.includes(selectedBarber.id)
          ? [selectedBarber]
          : [];
    let cancelled = false;
    if (activeBarbers.length === 0) {
      const timer = setTimeout(() => {
        setAvailableSlots([]);
        setSlotMinutes("");
        setLoadingSlots(false);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    async function loadSlots() {
      setLoadingSlots(true);
      setErrorMessage("");
      try {
        const weekday = new Date(`${date}T00:00:00+07:00`).getUTCDay();
        const slotsByBarber = await Promise.all(
          activeBarbers.map(async (activeBarber) => {
            const ranges = await getBookedSlots(activeBarber.id, date);
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
              .filter(
                (slot) =>
                  !isSlotTaken(slot, activeService.duration, ranges, date)
              );
            return slots;
          })
        );
        if (cancelled) return;

        const slots = Array.from(new Set(slotsByBarber.flat())).sort(
          (left, right) => left - right
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
  }, [
    barberId,
    date,
    serviceId,
    workingHours,
    service,
    selectedBarber,
    barbers,
    startedBarberIds,
  ]);

  function buildInput(startNow: boolean): WalkInInput | null {
    if (!service || !barberId) return null;
    if (!startNow && !slotMinutes) return null;
    return {
      customerName,
      customerPhone: customerPhone.trim() || undefined,
      serviceId: service.id,
      barberId: Number(barberId),
      date,
      slotMinutes: Number(slotMinutes || 0),
      startNow,
      sendWa: !startNow && customerPhone.trim() !== "",
      customerNotes,
    };
  }

  function resetForm() {
    setCustomerName("");
    setCustomerPhone("");
    setServiceId("");
    setBarberId("0");
    setDate(today);
    setSlotMinutes("");
    setCustomerNotes("");
    setStartConflict(null);
  }

  async function save(startNow: boolean) {
    const input = buildInput(startNow);
    if (
      submitting ||
      !input ||
      customerName.trim().length < 3 ||
      date !== today && startNow
    ) {
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await createWalkInBooking(input);
      if (!result.ok) {
        if ("code" in result && result.code === "conflict") {
          setStartConflict({ conflict: result.conflict, input });
          return;
        }
        setErrorMessage(
          ("message" in result && result.message) || "Walk-in belum disimpan."
        );
        return;
      }

      resetForm();
      onSuccess(result.message);
    } catch {
      setStartConflict(null);
      setErrorMessage("Walk-in gagal disimpan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveStartConflict(resolution: WalkInResolution) {
    if (!startConflict || submitting) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await createWalkInBooking(startConflict.input, resolution);
      if (!result.ok) {
        if ("code" in result && result.code === "conflict") {
          setStartConflict((current) =>
            current ? { ...current, conflict: result.conflict } : current
          );
          return;
        }
        setErrorMessage(
          ("message" in result && result.message) || "Walk-in belum disimpan."
        );
        setStartConflict(null);
        return;
      }
      resetForm();
      onSuccess(result.message);
    } catch {
      setStartConflict(null);
      setErrorMessage("Walk-in gagal disimpan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  const conflict = startConflict?.conflict;
  const primaryResolution: WalkInResolution | null = conflict?.suggestedBarber
    ? { kind: "start_with_barber", barberId: conflict.suggestedBarber.id }
    : conflict?.nearestSlotAny
      ? { kind: "schedule_any" }
      : conflict?.nearestSlotSame
        ? { kind: "schedule_same" }
        : null;
  const primaryLabel = conflict?.suggestedBarber
    ? `Mulai sekarang dengan ${conflict.suggestedBarber.name}`
    : conflict?.nearestSlotAny
      ? `Jadwalkan ${conflict.nearestSlotAny.label} dengan ${conflict.nearestSlotAny.barber.name}`
      : conflict?.nearestSlotSame
        ? `Jadwalkan ulang ${conflict.nearestSlotSame.label} dengan ${conflict.nearestSlotSame.barber.name}`
        : "Tidak ada jam tersedia";
  const secondaryResolution =
    primaryResolution?.kind !== "schedule_same" && conflict?.nearestSlotSame
      ? ({ kind: "schedule_same" } satisfies WalkInResolution)
      : null;

  return (
    <>
    <div className="mb-5 rounded-2xl border border-line bg-cream p-4">
      <h3 className="font-display text-lg font-semibold">Catat walk-in</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-ink">
          Nama
          <input
            required
            minLength={3}
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className="input-premium"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
          Nomor WA (opsional)
          <input
            type="tel"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            className="input-premium"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
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
            className="input-premium"
          >
            <option value="">Pilih layanan</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.duration} menit
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
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
            className="input-premium"
          >
            <option value="0">Siapa saja</option>
            <option value="">Pilih kapster</option>
            {barbers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
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
            className="input-premium"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
          Jam
          <select
            value={slotMinutes}
            disabled={loadingSlots || availableSlots.length === 0}
            onChange={(event) => setSlotMinutes(event.target.value)}
            className="input-premium disabled:opacity-50"
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
          <span className="text-xs font-normal text-ink/70">
            Jam hanya dipakai untuk Simpan ke antre. Mulai sekarang memakai waktu saat ini.
          </span>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink sm:col-span-2">
          Catatan (opsional)
          <textarea
            maxLength={300}
            rows={2}
            value={customerNotes}
            onChange={(event) => setCustomerNotes(event.target.value)}
            className="input-premium"
          />
        </label>
      </div>

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={
            submitting ||
            loadingSlots ||
            !slotMinutes ||
            !service ||
            customerName.trim().length < 3
          }
          onClick={() => void save(false)}
          className="min-h-11 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-ink hover:bg-gold-soft disabled:opacity-50"
        >
          {submitting ? "Menyimpan…" : "Simpan ke antre"}
        </button>
        <button
          type="button"
          disabled={
            submitting ||
            !service ||
            customerName.trim().length < 3 ||
            date !== today
          }
          onClick={() => void save(true)}
          className="min-h-11 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Mulai sekarang
        </button>
        {date !== today && (
          <p className="self-center text-sm text-ink/70">Hanya untuk hari ini.</p>
        )}
      </div>
    </div>
    <ConfirmDialog
      open={conflict !== undefined}
      tone="warning"
      title={
        conflict?.kind === "running"
          ? "Kapster masih mengerjakan pelanggan"
          : "Jadwal walk-in bertabrakan"
      }
      details={
        conflict
          ? [
              { label: "Kapster", value: conflict.barberName },
              { label: "Pelanggan", value: conflict.customerName },
              { label: "Waktu", value: conflict.time },
            ]
          : []
      }
      note={conflict?.message}
      confirmLabel={primaryLabel}
      hideConfirm={!primaryResolution}
      secondaryLabel={
        secondaryResolution && conflict?.nearestSlotSame
          ? `Jadwalkan ulang ${conflict.nearestSlotSame.label} dengan ${conflict.nearestSlotSame.barber.name}`
          : undefined
      }
      busy={submitting}
      onConfirm={() => {
        if (primaryResolution) void resolveStartConflict(primaryResolution);
      }}
      onSecondary={() => {
        if (secondaryResolution) void resolveStartConflict(secondaryResolution);
      }}
      cancelLabel="Kembali"
      onCancel={() => {
        if (!submitting) setStartConflict(null);
      }}
    />
    </>
  );
}
