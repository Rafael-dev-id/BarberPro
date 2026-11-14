// Tautan booking pendek: UUID token (16 byte) dikodekan base64url = 22 karakter.
// Tidak ada kolom atau migrasi baru; token di database tetap UUID yang sama.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function encodeBookingCode(uuid: string): string | null {
  if (!UUID_PATTERN.test(uuid)) return null;
  const hex = uuid.replace(/-/g, "");
  let binary = "";
  for (let index = 0; index < 32; index += 2) {
    binary += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeBookingCode(code: string): string | null {
  if (!CODE_PATTERN.test(code)) return null;

  let binary: string;
  try {
    binary = atob(code.replace(/-/g, "+").replace(/_/g, "/") + "==");
  } catch {
    return null;
  }
  if (binary.length !== 16) return null;

  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");

  // Tolak kode non-kanonis: kode harus persis hasil encode dari UUID-nya.
  return encodeBookingCode(uuid) === code ? uuid : null;
}

// Jalur publik untuk sebuah booking. Bila token bukan UUID, jatuh ke jalur lama.
export function bookingPath(uuid: string): string {
  const code = encodeBookingCode(uuid);
  return code ? `/b/${code}` : `/ringkasan/${uuid}`;
}
