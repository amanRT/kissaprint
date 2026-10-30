// fetch() wrapper for the browser: JSON in/out, errors become exceptions carrying the HTTP status and field name.
export type ApiError = Error & { status?: number; field?: string };

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(path.startsWith("/") ? path : `/api/${path}/`, body === undefined ? init : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error((data as { error?: string }).error || "Something went wrong - please try again"),
      { status: res.status, field: (data as { field?: string }).field }) as ApiError;
  }
  return data as T;
}
