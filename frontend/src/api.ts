async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `${method} ${url} failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => http<T>("GET", `/api${url}`),
  post: <T>(url: string, body?: unknown) => http<T>("POST", `/api${url}`, body),
  put: <T>(url: string, body?: unknown) => http<T>("PUT", `/api${url}`, body),
  del: <T>(url: string) => http<T>("DELETE", `/api${url}`),
};

export function gmapsLink(p: { gmaps_url?: string; lat: number | null; lng: number | null; name: string }) {
  if (p.gmaps_url) return p.gmaps_url;
  if (p.lat != null && p.lng != null)
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
}

/** Parse coordinates out of a pasted Google Maps URL. */
export function parseGmapsUrl(url: string): { lat: number; lng: number } | null {
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  const q = url.match(/[?&]q(?:uery)?=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
  const bang = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
  return null;
}
