/**
 * 7MGFC — Cliente Supabase Frontend
 * Comunicação direta e segura com o backend Supabase via REST API
 */

export const SUPABASE_CONFIG = {
  url: "https://crsqpssomhkpapqcoftr.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyc3Fwc3NvbWhrcGFwcWNvZnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MTM1NjAsImV4cCI6MjEwNjI4OTU2MH0.uzHwP3qK3ynWoITFZqm5I8LrrFeowYOFdy6Hsn--Y84",
};

export async function supabaseRequest(
  endpoint: string,
  method = "GET",
  body: any = null,
  extraHeaders: Record<string, string> = {}
) {
  const options: RequestInit = {
    method,
    headers: {
      apikey: SUPABASE_CONFIG.anonKey,
      Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`, options);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error((errorData && errorData.message) || `Erro HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await response.json();
  }
  return null;
}

export async function fetchUserDailyUsage(
  userId: string
): Promise<{ used: number; limit: number; remaining: number }> {
  const today = new Date().toISOString().split("T")[0];
  const endpoint = `daily_limits?user_id=eq.${encodeURIComponent(userId)}&download_date=eq.${encodeURIComponent(today)}&select=*`;

  try {
    const data = await supabaseRequest(endpoint);
    const row = Array.isArray(data) ? data[0] : undefined;
    const used = Number(row?.downloads_used ?? 0);
    return { used, limit: 30, remaining: Math.max(0, 30 - used) };
  } catch (err) {
    console.warn("[7MGFC] Não foi possível consultar uso no Supabase:", err);
    return { used: 0, limit: 30, remaining: 30 };
  }
}

export async function incrementDownloadUsage(
  userId: string,
  userDailyLimit = 30
): Promise<{ used: number; limit: number; remaining: number }> {
  const today = new Date().toISOString().split("T")[0];
  const endpoint = `daily_limits?user_id=eq.${encodeURIComponent(userId)}&download_date=eq.${encodeURIComponent(today)}&select=*`;

  try {
    const data = await supabaseRequest(endpoint);
    const existingRow = Array.isArray(data) && data.length > 0 ? data[0] : null;

    let newUsed = 1;
    if (existingRow) {
      newUsed = Number(existingRow.downloads_used || 0) + 1;
      await supabaseRequest(`daily_limits?id=eq.${existingRow.id}`, "PATCH", {
        downloads_used: newUsed,
        updated_at: new Date().toISOString(),
      });
    } else {
      await supabaseRequest("daily_limits", "POST", {
        user_id: userId,
        download_date: today,
        downloads_used: 1,
      });
    }

    return {
      used: newUsed,
      limit: userDailyLimit,
      remaining: Math.max(0, userDailyLimit - newUsed),
    };
  } catch (err) {
    console.error("[7MGFC] Falha ao registrar uso de download:", err);
    return { used: 1, limit: userDailyLimit, remaining: Math.max(0, userDailyLimit - 1) };
  }
}

export async function recordDownloadHistory(
  userId: string,
  stockUrl: string,
  downloadUrl?: string,
  resourceId?: string
) {
  try {
    await supabaseRequest("downloads_history", "POST", {
      user_id: userId,
      stock_url: stockUrl,
      download_url: downloadUrl || null,
      resource_id: resourceId || null,
      status: "completed",
    });
  } catch (err) {
    console.warn("[7MGFC] Falha ao gravar histórico no Supabase:", err);
  }
}
