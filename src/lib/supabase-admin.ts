import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client using the service role key. Never import this from a
// Client Component — it must only run in API routes, Server Components, or
// standalone scripts. There is no anon-key browser client in this project:
// the dashboard reads data through Server Components instead.
let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return cachedClient;
}
