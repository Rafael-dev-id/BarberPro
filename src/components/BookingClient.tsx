"use client";

import { useEffect, useRef, useState } from "react";
import { Barber, Service, WorkingHour } from "@/lib/types";
import { formatRupiah, formatTanggalLabel } from "@/lib/format";
import {
  generateSlots,
  filterPastSlots,
  timeToMinutes,
  minutesToTime,
} from "@/lib/slots";
import { getBookedSlots } from "@/lib/booking-actions";
import BookingForm from "@/components/BookingForm";

interface BookedRange {
  startMinutes: number;
  endMinutes: number;
}

interface BookingClientProps {
  services: Service[];
  barbers: Barber[];
  workingHours: WorkingHour[];
}

interface SmartDateNote {
  sourceDate: string;
  targetDate: string;
}

function isSlotTaken(slot: number, duration: number, ranges: BookedRange[]) {
  const slotEnd = slot + duration;
  return ranges.some((r) => slot < r.endMinutes && slotEnd > r.startMinutes);
}

function listSmartCandidateDates(workingHours: WorkingHour[]): string[] {
  const now = new Date();
  const today = now.toLocaleDateString("en-CA");
  const candidates: string[] = [];

  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);

    const dayHours = workingHours.filter((wh) => wh.weekday === date.getDay());
    if (dayHours.length === 0) continue;

    if (
      offset === 0 &&
      !dayHours.some(
        (wh) =>
          now.getHours() * 60 + now.getMinutes() <
          timeToMinutes(wh.end_time)
      )
    ) {
      continue;
    }

    candidates.push(date.toLocaleDateString("en-CA"));
  }

  return candidates.length > 0 ? candidates : [today];
}

export default function BookingClient({
  services,
  barbers,
  workingHours,
}: BookingClientProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(
    () => listSmartCandidateDates(workingHours)[0]
  );
  const [dateTouched, setDateTouched] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [bookedRanges, setBookedRanges] = useState<BookedRange[]>([]);
  const [bookedRangesFor, setBookedRangesFor] = useState<{
    barberId: number;
    date: string;
    refreshKey: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dateNote, setDateNote] = useState("");
  const [smartNote, setSmartNote] = useState<SmartDateNote | null>(null);
  const [sameDayOffer, setSameDayOffer] = useState<{
    barberId: number;
    barberName: string;
    timeMinutes: number;
  } | null>(null);
  const dateTouchedRef = useRef(false);
  const selectedBarberRef = useRef<number | null>(null);
  const initialProbe = useRef({ services, workingHours, selectedDate });

  // Ambil tanggal hari ini
  const todayObj = new Date();
  const today = todayObj.toLocaleDateString("en-CA");

  // Tambah 60 hari dengan memanipulasi objek tanggal secara murni
  const maxDateObj = new Date();
  maxDateObj.setDate(maxDateObj.getDate() + 60);
  const maxDate = maxDateObj.toLocaleDateString("en-CA");
   
  const selectedService = services.find((s) => s.id === selectedServiceId);
  const selectedBarber = barbers.find((b) => b.id === selectedBarberId);

  const weekday = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).getDay()
    : null;

  const workingHour = workingHours.find(
    (wh) => wh.barber_id === selectedBarberId && wh.weekday === weekday
  );

  let slots: number[] = [];
  if (workingHour && selectedService) {
    slots = generateSlots(
      timeToMinutes(workingHour.start_time),
      timeToMinutes(workingHour.end_time),
      selectedService.duration
    );
    slots = filterPastSlots(slots, selectedDate);
  }

  useEffect(() => {
    if (!selectedBarberId || !selectedDate) {
      return;
    }

    let cancelled = false;

    getBookedSlots(selectedBarberId, selectedDate).then((ranges) => {
      if (!cancelled) {
        setBookedRanges(ranges);
        setBookedRangesFor({ barberId: selectedBarberId, date: selectedDate, refreshKey });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedBarberId, selectedDate, refreshKey]);

  useEffect(() => {
    if (!selectedBarberId || !selectedDate) return;

    let cancelled = false;
    const refreshSlots = async () => {
      try {
        const ranges = await getBookedSlots(selectedBarberId, selectedDate);
        if (cancelled) return;
        setBookedRanges(ranges);
        setBookedRangesFor({
          barberId: selectedBarberId,
          date: selectedDate,
          refreshKey,
        });
      } catch (error) {
        console.error("Gagal memperbarui ketersediaan slot.", error);
      }
    };
    const handleFocus = () => {
      void refreshSlots();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshSlots();
    };
    const timer = setInterval(() => void refreshSlots(), 30_000);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedBarberId, selectedDate, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    async function findAvailableDate() {
      const { services: initialServices, workingHours: initialWorkingHours, selectedDate: initialDate } =
        initialProbe.current;
      if (initialServices.length === 0) return;

      const minDuration = Math.min(...initialServices.map((service) => service.duration));
      const candidates = listSmartCandidateDates(initialWorkingHours);
      const todayDate = new Date().toLocaleDateString("en-CA");

      for (const candidate of candidates) {
        if (cancelled || dateTouchedRef.current || selectedBarberRef.current !== null) {
          return;
        }

        const now = new Date();
        const todayMinutes = now.getHours() * 60 + now.getMinutes();
        const weekday = new Date(`${candidate}T00:00:00`).getDay();
        const dayHours = initialWorkingHours.filter(
          (wh) =>
            wh.weekday === weekday &&
            (candidate !== todayDate || todayMinutes < timeToMinutes(wh.end_time))
        );
        const hoursByBarber = new Map<number, WorkingHour[]>();

        for (const hour of dayHours) {
          const hours = hoursByBarber.get(hour.barber_id) ?? [];
          hours.push(hour);
          hoursByBarber.set(hour.barber_id, hours);
        }

        const barberAvailability = await Promise.all(
          Array.from(hoursByBarber.entries()).map(async ([barberId, hours]) => {
            const ranges = await getBookedSlots(barberId, candidate);
            return hours.some((hour) =>
              filterPastSlots(
                generateSlots(
                  timeToMinutes(hour.start_time),
                  timeToMinutes(hour.end_time),
                  minDuration
                ),
                candidate
              ).some((slot) => !isSlotTaken(slot, minDuration, ranges))
            );
          })
        );

        if (cancelled || dateTouchedRef.current || selectedBarberRef.current !== null) {
          return;
        }

        if (barberAvailability.some(Boolean)) {
          if (candidate !== initialDate) setSelectedDate(candidate);
          if (candidate !== todayDate) {
            setSmartNote({ sourceDate: todayDate, targetDate: candidate });
          } else {
            setSmartNote(null);
          }
          return;
        }
      }
    }

    void findAvailableDate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      selectedServiceId === null ||
      selectedBarberId === null ||
      !selectedDate ||
      !selectedService ||
      bookedRangesFor?.barberId !== selectedBarberId ||
      bookedRangesFor.date !== selectedDate ||
      bookedRangesFor.refreshKey !== refreshKey
    ) {
      return;
    }

    const availableSlots = slots.filter(
      (slot) => !isSlotTaken(slot, selectedService.duration, bookedRanges)
    );
    if (availableSlots.length > 0) return;

    let cancelled = false;
    const barberId = selectedBarberId;
    const serviceDuration = selectedService.duration;

    async function findBarberDate() {
      const todayDate = new Date().toLocaleDateString("en-CA");
      const todayMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      const weekday = new Date(`${selectedDate}T00:00:00`).getDay();
      const sameDayBarbers = barbers.flatMap((barber) => {
        if (barber.id === barberId) return [];

        const hours = workingHours.filter(
          (hour) =>
            hour.barber_id === barber.id &&
            hour.weekday === weekday &&
            (selectedDate !== todayDate ||
              todayMinutes < timeToMinutes(hour.end_time))
        );
        return hours.length > 0 ? [{ barber, hours }] : [];
      });

      const sameDayAvailability = await Promise.all(
        sameDayBarbers.map(async ({ barber, hours }) => {
          const ranges = await getBookedSlots(barber.id, selectedDate);
          const availableSlots = hours
            .flatMap((hour) =>
              filterPastSlots(
                generateSlots(
                  timeToMinutes(hour.start_time),
                  timeToMinutes(hour.end_time),
                  serviceDuration
                ),
                selectedDate
              )
            )
            .filter((slot) => !isSlotTaken(slot, serviceDuration, ranges));
          const timeMinutes = Math.min(...availableSlots);

          return Number.isFinite(timeMinutes)
            ? { barberId: barber.id, barberName: barber.name, timeMinutes }
            : null;
        })
      );

      if (cancelled) return;

      let nearestOffer: {
        barberId: number;
        barberName: string;
        timeMinutes: number;
      } | null = null;
      for (const offer of sameDayAvailability) {
        if (
          offer &&
          (nearestOffer === null ||
            offer.timeMinutes < nearestOffer.timeMinutes)
        ) {
          nearestOffer = offer;
        }
      }

      if (nearestOffer) {
        setSameDayOffer(nearestOffer);
        return;
      }

      setSameDayOffer(null);
      if (dateTouched || dateTouchedRef.current) return;

      const startDate = new Date(`${selectedDate}T00:00:00`);

      for (let offset = 1; offset <= 7; offset++) {
        const candidateDate = new Date(startDate);
        candidateDate.setDate(candidateDate.getDate() + offset);
        const candidate = candidateDate.toLocaleDateString("en-CA");
        const now = new Date();
        const todayMinutes = now.getHours() * 60 + now.getMinutes();
        const candidateWeekday = candidateDate.getDay();
        const dayHours = workingHours.filter(
          (hour) =>
            hour.barber_id === barberId &&
            hour.weekday === candidateWeekday &&
            (candidate !== todayDate ||
              todayMinutes < timeToMinutes(hour.end_time))
        );
        if (dayHours.length === 0) continue;

        const ranges = await getBookedSlots(barberId, candidate);
        const hasAvailableSlot = dayHours.some((hour) =>
          filterPastSlots(
            generateSlots(
              timeToMinutes(hour.start_time),
              timeToMinutes(hour.end_time),
              serviceDuration
            ),
            candidate
          ).some((slot) => !isSlotTaken(slot, serviceDuration, ranges))
        );

        if (cancelled || dateTouchedRef.current) return;

        if (hasAvailableSlot) {
          setSelectedDate(candidate);
          setSmartNote(
            candidate === todayDate
              ? null
              : { sourceDate: selectedDate, targetDate: candidate }
          );
          return;
        }
      }
    }

    void findBarberDate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedServiceId,
    selectedBarberId,
    selectedDate,
    bookedRanges,
    dateTouched,
    refreshKey,
  ]);

  useEffect(() => {
    if (
      selectedServiceId === null ||
      selectedBarberId === null ||
      !selectedDate
    ) {
      return;
    }

    const availableSlots = slots.filter(
      (slot) =>
        selectedService !== undefined &&
        !isSlotTaken(slot, selectedService.duration, bookedRanges)
    );
    const nextSlot = availableSlots[0] ?? null;

    setSelectedSlot((currentSlot) => {
      if (currentSlot !== null && availableSlots.includes(currentSlot)) {
        return currentSlot;
      }

      return currentSlot === nextSlot ? currentSlot : nextSlot;
    });
  }, [
    selectedServiceId,
    selectedBarberId,
    selectedDate,
    bookedRanges,
    refreshKey,
  ]);

  const validSelectedSlot =
    selectedSlot !== null &&
    selectedService !== undefined &&
    !isSlotTaken(selectedSlot, selectedService.duration, bookedRanges)
      ? selectedSlot
      : null;

  function chooseService(id: number) {
    setSelectedServiceId(id);
    setSelectedSlot(null);
    setSameDayOffer(null);
  }

  function chooseBarber(id: number) {
    selectedBarberRef.current = id;
    setSelectedBarberId(id);
    setSelectedSlot(null);
    setSameDayOffer(null);
  }

  function chooseDate(value: string) {
    if (value < today || value > maxDate) {
       setDateNote("Booking hanya bisa sampai 60 hari ke depan. Coba pilih tanggal lain");
       return;
    };

    setDateNote("");
    dateTouchedRef.current = true;
    setDateTouched(true);
    setSmartNote(null);
    setSameDayOffer(null);
    setSelectedDate(value);
    setSelectedSlot(null);
  }

  // Benarkah SEMUA slot di tanggal ini sudah terisi?
  const allTaken =
     selectedService !== undefined &&
     slots.length > 0 &&
     slots.every((slot) => isSlotTaken(slot, selectedService.duration, bookedRanges));

  return (
    <div>
      <header className="mb-8">
        <p className="eyebrow">Booking</p>
        <h1 className="title-display mt-2">Amankan Kursimu</h1>
        <p className="mt-3 text-ink/60">
          Empat langkah cepat — selesai dalam 1 menit.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        {/* ------- kolom kiri: langkah 1-4 ------- */}
        <div className="space-y-10">
          <section>
            <h2 className="eyebrow">1 · Pilih Layanan</h2>
            <div className="mt-4 space-y-3">
              {services.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => chooseService(service.id)}
                    className={`w-full rounded-2xl border-2 bg-white p-4 text-left transition relative ${
                      isSelected
                        ? "border-gold shadow-[0_0_0_4px_rgb(201_162_75/0.15)]"
                        : "border-line hover:border-ink/30"
                    }`}
                  >
                   {service.badge && (
                       <span className="absolute -top-2 -right-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-ink shadow">
                         {service.badge}
                       </span>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold">{service.name}</span>
                      <span className="text-sm font-bold text-gold">
                        {formatRupiah(service.price)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink/50">
                      ± {service.duration} menit
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="eyebrow">2 · Pilih Barber</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {barbers.map((barber) => {
                const isSelected = barber.id === selectedBarberId;
                return (
                  <button
                    key={barber.id}
                    type="button"
                    onClick={() => chooseBarber(barber.id)}
                    className={`rounded-2xl border-2 bg-white p-4 text-center transition ${
                      isSelected
                        ? "border-gold shadow-[0_0_0_4px_rgb(201_162_75/0.15)]"
                        : "border-line hover:border-ink/30"
                    }`}
                  >
                    <span className="block font-display font-semibold">
                      {barber.name}
                    </span>
                    <span className="mt-1 block text-xs font-bold uppercase tracking-widest text-gold">
                      {barber.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="eyebrow">3 · Pilih Tanggal</h2>
            <input
              type="date"
              value={selectedDate}
              min={today}
              max={maxDate}
              onChange={(event) => chooseDate(event.target.value)}
              className="input-premium mt-4"
            />
            {selectedDate && (
              <p className="mt-2 text-sm text-ink/60">
                {formatTanggalLabel(selectedDate)}
              </p>
            )}
            {dateNote && <p className="mt-2 text-xs text-red-600">{dateNote}</p>}
            {!dateTouched && selectedDate !== today && smartNote && (
              <p className="mt-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-700">
                <span className="font-semibold text-sky-900">
                  {formatTanggalLabel(smartNote.sourceDate)}
                </span>
                <span className="mx-1">
                  sudah penuh untuk semua kapster — ditampilkan
                </span>
                <span className="mx-1 font-semibold text-sky-900">
                  {formatTanggalLabel(smartNote.targetDate)}
                </span>
                .
              </p>
            )}
          </section>

          {selectedService && selectedBarber && selectedDate && (
            <section>
              <h2 className="eyebrow">4 · Pilih Jam</h2>
              <p className="mt-1 text-xs text-ink/50">
                Slot untuk {formatTanggalLabel(selectedDate)}
              </p>
              {sameDayOffer &&
                slots.every((slot) =>
                  isSlotTaken(slot, selectedService.duration, bookedRanges)
                ) && (
                <div className="mt-4 rounded-xl bg-sky-50 p-3 text-xs text-sky-700">
                  <p className="font-semibold">
                    Slot untuk {selectedBarber.name} sudah habis.
                  </p>
                  <p className="mt-1">{formatTanggalLabel(selectedDate)}</p>
                  <p className="mt-2">
                    {sameDayOffer.barberName} masih punya slot.
                  </p>
                  <p>
                    Slot terdekat: {minutesToTime(sameDayOffer.timeMinutes)} WIB.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      chooseBarber(sameDayOffer.barberId);
                      setSameDayOffer(null);
                    }}
                    className="mt-2 rounded-full border border-gold px-3 py-1.5 font-semibold text-ink hover:bg-gold/10"
                  >
                    Ganti ke {sameDayOffer.barberName} · {minutesToTime(sameDayOffer.timeMinutes)} WIB
                  </button>
                </div>
              )}

              {workingHour ? (
                slots.length > 0 ? (
                   <>
                     <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
                       {slots.map((slot) => {
                         const taken = isSlotTaken(
                           slot,
                           selectedService.duration,
                           bookedRanges
                         );
                         const isSelected = slot === selectedSlot;
                         return (
                           <button
                             key={slot}
                             type="button"
                             disabled={taken}
                             onClick={() => setSelectedSlot(slot)}
                             className={`rounded-xl border-2 py-2 text-sm font-bold transition ${
                               taken
                                 ? "cursor-not-allowed border-line bg-ink/5 text-ink/30"
                                 : isSelected
                                   ? "border-gold bg-gold text-ink"
                                   : "border-line bg-white hover:border-ink/30"
                             }`}
                           >
                              <span className={taken ? "line-through" : ""}>
                                {minutesToTime(slot)}
                              </span>
                              {taken && (
                                 <span className="mt-0.5 block text-[9px] font-semibold tracking-widest">TERISI</span>
                              )}
                           </button>
                         );
                       })}
                     </div>
                      {allTaken && (
                         <p className="mt-3 text-sm text-ink/50">
                           Semua jam di tanggal ini sudah di booking. Coba tanggal lain atau kapster lain.
                         </p>
                      )}
                   </>
                ) : (
                   <p className="mt-4 text-sm text-ink/50">
                     Tidak ada slot tersisa untuk {selectedBarber.name} pada {formatTanggalLabel(selectedDate)}.
                   </p>
                )
              ) : (
                <p className="mt-4 text-sm text-ink/50">
                  {selectedBarber.name} libur di hari ini. Pilih barber lain atau tanggal lain.
                </p>
              )}
            </section>
          )}
        </div>

        {/* ------- kolom kanan: ringkasan + form (sticky di desktop) ------- */}
        <div className="lg:sticky lg:top-24">
          <BookingForm
            complete={Boolean(
              selectedService && selectedBarber && selectedDate && validSelectedSlot !== null
            )}
            serviceId={selectedService?.id ?? 0}
            barberId={selectedBarber?.id ?? 0}
            serviceName={selectedService?.name ?? ""}
            barberName={selectedBarber?.name ?? ""}
            date={selectedDate}
            dateLabel={formatTanggalLabel(selectedDate)}
            slotMinutes={validSelectedSlot ?? 0}
            onBooked={() => {
              setSameDayOffer(null);
              setRefreshKey((k) => k + 1);
            }}
            onSlotConflict={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  );
}