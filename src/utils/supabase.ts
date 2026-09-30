/**
 * 7MGFC — Cliente Supabase Frontend
 * A extensão usa somente a chave pública (anon/publishable).
 * Operações privilegiadas devem permanecer no backend.
 */

export const SUPABASE_CONFIG = {
  url: "https://crsqpssomhkpapqcoftr.supabase.co",
  anonKey: "SUBSTITUA_PELA_SUA_CHAVE_ANON_PUBLICA",
};

export async function fetchUserDailyUsage(
  userId: string,
): Promise<{ used: number; limit: number; remaining: number }> {
  const today = new Date().toISOString().split("T")[0];
  const endpoint = `${SUPABASE_CONFIG.url}/rest/v1/daily_limits?user_id=eq.${encodeURIComponent(userId)}&download_date=eq.${encodeURIComponent(today)}`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_CONFIG.anonKey,
        Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const row = Array.isArray(data) ? data[0] : undefined;
    const used = Number(row?.downloads_used ?? 0);
    const limit = 30;

    return { used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    console.warn("[7MGFC] Não foi possível consultar uso no Supabase:", err);
    return { used: 0, limit: 30, remaining: 30 };
  }
}
