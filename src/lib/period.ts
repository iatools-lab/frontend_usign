import { useEffect, useState } from "react";
import { apiFetch, hasStoredAuthToken } from "./api";

export type Period = { from: string; to: string };
export const EMPTY_PERIOD: Period = { from: "", to: "" };

// Interpret calendar days in the browser's timezone; the upper bound is exclusive.
export function periodParams(period: Period) {
  const params = new URLSearchParams({ limit: "100" });
  if (period.from) params.set("from", new Date(`${period.from}T00:00:00`).toISOString());
  if (period.to) {
    const end = new Date(`${period.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    params.set("to", end.toISOString());
  }
  return params.toString();
}

// Keep filtered responses separate from the application's unfiltered caches.
export function usePeriodRecords<T>(path: string, period: Period) {
  const params = periodParams(period);
  const [state, setState] = useState<{
    key: string;
    items: T[];
    isLoading: boolean;
    error: unknown;
  }>({ key: "", items: [], isLoading: true, error: null });
  const key = `${path}?${params}`;

  useEffect(() => {
    let active = true;
    let version = 0;
    const sync = async () => {
      const current = ++version;
      setState({ key, items: [], isLoading: true, error: null });
      if (!hasStoredAuthToken()) {
        setState({ key, items: [], isLoading: false, error: null });
        return;
      }
      try {
        const page = await apiFetch<T[] | { items: T[] }>(key);
        if (active && version === current) {
          setState({
            key,
            items: Array.isArray(page) ? page : page.items,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        if (active && version === current) {
          setState({ key, items: [], isLoading: false, error });
        }
      }
    };
    const refresh = () => void sync();
    const onStoreChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === "binders") refresh();
    };
    refresh();
    window.addEventListener("goodflag:store", onStoreChange);
    window.addEventListener("goodflag:auth", refresh);
    return () => {
      active = false;
      window.removeEventListener("goodflag:store", onStoreChange);
      window.removeEventListener("goodflag:auth", refresh);
    };
  }, [key]);

  return state.key === key ? state : { items: [] as T[], isLoading: true, error: null };
}
