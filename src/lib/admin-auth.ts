import type { User } from "@supabase/supabase-js";
import type { createSupabaseServerClient } from "@/lib/supabase-server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const NETWORK_ERROR_MESSAGE = "Koneksi terputus. Perubahan belum tersimpan.";

export type AdminUserResult =
   | { status: "authenticated"; user: User }
   | { status: "unauthenticated" }
   | { status: "unavailable" };

export function isNetworkError(error: unknown): boolean {
   if (error instanceof TypeError) return true;
   if (!error || typeof error !== "object") return false;

   const details = error as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
      cause?: unknown;
   };
   if (details.name === "AuthRetryableFetchError") return true;
   if (
      typeof details.status === "number" &&
      (details.status === 0 || details.status >= 500)
   ) {
      return true;
   }

   const message =
      typeof details.message === "string" ? details.message.toLowerCase() : "";
   if (
      /fetch failed|failed to fetch|network error|network request failed|load failed|econn|enotfound|socket hang up/.test(
         message
      )
   ) {
      return true;
   }

   return details.cause !== undefined && isNetworkError(details.cause);
}

export async function requireAdminUser(
   supabase: ServerSupabaseClient
): Promise<AdminUserResult> {
   try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
         return isNetworkError(error)
            ? { status: "unavailable" }
            : { status: "unauthenticated" };
      }
      return data.user
         ? { status: "authenticated", user: data.user }
         : { status: "unauthenticated" };
   } catch {
      return { status: "unavailable" };
   }
}
