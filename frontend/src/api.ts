import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function jsonError(response: Response) {
  const body = await response.json().catch(() => ({})) as { detail?: string };
  return new Error(body.detail || "The local server returned HTTP " + response.status + ".");
}

export async function request<T>(path: string, method = "GET", body?: object | FormData, signal?: AbortSignal): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData);
  const headers = new Headers();
  if (json) headers.set("Content-Type", "application/json");
  if (localStorage.getItem("pf-presentation") === "true") headers.set("X-PrivForensics-Presentation", "1");
  const response = await fetch("/api" + path, { method, headers, body: json ? JSON.stringify(body) : body as FormData, signal });
  if (!response.ok) throw await jsonError(response);
  return response.json() as Promise<T>;
}

export function withQuery(path: string, values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== "" && value !== undefined && value !== null) params.set(key, String(value));
  });
  return params.size ? path + "?" + params.toString() : path;
}

export function useRead<T>(path: string | undefined, refresh?: number) {
  return useQuery({ queryKey: ["api", path], queryFn: ({ signal }) => request<T>(path!, "GET", undefined, signal),
    enabled: !!path, refetchInterval: refresh });
}

export function useAction<T, V>(action: (values: V) => Promise<T>, onSuccess?: (values: T) => void) {
  const query = useQueryClient();
  return useMutation({ mutationFn: action, onSuccess: (values) => {
    void query.invalidateQueries({ queryKey: ["api"] });
    onSuccess?.(values);
  } });
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const element = document.createElement("a");
  element.href = href;
  element.download = filename;
  element.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function downloadPost(path: string, body: object, name: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (localStorage.getItem("pf-presentation") === "true") headers.set("X-PrivForensics-Presentation", "1");
  const response = await fetch("/api" + path, { method: "POST", headers,
    body: JSON.stringify(body) });
  if (!response.ok) throw await jsonError(response);
  saveBlob(await response.blob(), name);
}

export function exportCsv(filename: string, headings: string[], rows: (string | number | null)[][]) {
  const lines = [headings, ...rows].map(row => row.map(item => {
    const text = typeof item === "string" && /^[\s]*[=+@-]/.test(item) ? "'" + item : String(item ?? "");
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(",")).join("\n");
  saveBlob(new Blob([lines], { type: "text/csv;charset=utf-8" }), filename);
}
