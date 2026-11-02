import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

// Server-only database client. It uses the SECRET key, so it must never be
// imported into a file marked 'use client'.
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// Supabase returns at most 1,000 rows per request, so this asks page by page
// until everything has arrived. `build(from, to)` must return a query ending in .range(from, to).
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  max = 20000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  const step = 1000;
  for (let from = 0; from < max; from += step) {
    const { data, error } = await build(from, from + step - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < step) break;
  }
  return { rows, error: null };
}

// Splits a big list into smaller batches (databases and URLs have size limits).
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
