import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { request, useRead } from "./api";
import { jobActive } from "./design/tokens";
import type { Health, Investigation, Job, PageResult } from "./types";

type Prefs = {
  mode: "simple" | "advanced"; theme: "dark" | "light"; density: "compact" | "default" | "comfortable";
  presentation: boolean; reduced: boolean; rail: boolean; preview: number;
};
const defaults: Prefs = { mode: "simple", theme: "dark", density: "default", presentation: false, reduced: false,
  rail: false, preview: 8 };
type Workspace = {
  active?: Investigation; cases: Investigation[]; caseId?: string; health?: Health; connected: boolean;
  prefs: Prefs; setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  url: (path: string, extras?: Record<string, string | number>) => string;
  switchCase: (id: string) => void; openNew: () => void; jobs: Job[]; activeJobs: Job[];
  showJobs: () => void; track: (job: Job) => void; notice: (text: string) => void;
};
const Context = createContext<Workspace | null>(null);

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace context is unavailable.");
  return value;
}

function stored<K extends keyof Prefs>(key: K): Prefs[K] {
  try {
    return (JSON.parse(localStorage.getItem("pf-" + key) || "null") as Prefs[K] | null) ?? defaults[key];
  } catch {
    return defaults[key];
  }
}

export function WorkspaceProvider({ children }: { children: (props: {
  newCase: boolean; setNewCase: (open: boolean) => void; jobTray: boolean; setJobTray: (open: boolean) => void;
}) => ReactNode }) {
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const caseList = useRead<PageResult<Investigation>>("/cases?size=100");
  const caseId = search.get("case") || undefined;
  const current = useRead<Investigation>(caseId ? "/cases/" + caseId : undefined);
  const health = useRead<Health>("/health", 12_000);
  const [fast, setFast] = useState(false);
  const jobQuery = useRead<Job[]>("/jobs", fast ? 750 : 3400);
  const allJobs = jobQuery.data ?? [];
  const activeJobs = allJobs.filter(job => jobActive.has(job.status));
  const lastStates = useRef(new Map<string, Job["status"]>());
  const [newCase, setNewCase] = useState(false);
  const [jobTray, setJobTray] = useState(false);
  const [message, setMessage] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    mode: stored("mode"), theme: stored("theme"), density: stored("density"), presentation: stored("presentation"),
    reduced: stored("reduced"), rail: stored("rail"), preview: stored("preview"),
  }));
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
    root.dataset.presentation = String(prefs.presentation);
    root.dataset.reduced = String(prefs.reduced);
  }, [prefs]);
  useEffect(() => {
    if (caseId && current.data) localStorage.setItem("pf-last-case", caseId);
    if (!caseId && caseList.data?.items.length) {
      const saved = localStorage.getItem("pf-last-case");
      if (saved && caseList.data.items.some(item => item.id === saved)) {
        const params = new URLSearchParams(location.search);
        params.set("case", saved);
        navigate(location.pathname + "?" + params.toString(), { replace: true });
      }
    }
  }, [caseId, current.data, caseList.data, location.pathname, location.search, navigate]);
  useEffect(() => {
    if (!jobQuery.data) return;
    let changed = false;
    for (const job of jobQuery.data) {
      const before = lastStates.current.get(job.id);
      if (before && jobActive.has(before) && !jobActive.has(job.status)) {
        changed = true;
        if (job.status === "completed") setMessage(job.label + " completed.");
        if (job.status === "failed") setMessage(job.label + " failed. Open jobs for details.");
      }
      lastStates.current.set(job.id, job.status);
    }
    setFast(jobQuery.data.some(job => jobActive.has(job.status)));
    if (changed) void client.invalidateQueries({ queryKey: ["api"], predicate: query => query.queryKey[1] !== "/jobs" });
  }, [jobQuery.data, client]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5100);
    return () => clearTimeout(timer);
  }, [message]);
  function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    localStorage.setItem("pf-" + key, JSON.stringify(value));
    setPrefs(currentPrefs => ({ ...currentPrefs, [key]: value }));
  }
  function url(path: string, extras: Record<string, string | number> = {}) {
    const params = new URLSearchParams(Object.entries(extras).map(([key, value]) => [key, String(value)]));
    if (caseId) params.set("case", caseId);
    return path + (params.size ? "?" + params.toString() : "");
  }
  function switchCase(id: string) {
    const params = new URLSearchParams({ case: id });
    localStorage.setItem("pf-last-case", id);
    navigate(location.pathname + "?" + params.toString());
  }
  function track(job: Job) {
    lastStates.current.set(job.id, job.status);
    client.setQueryData<Job[]>(["api", "/jobs"], currentJobs =>
      [job, ...(currentJobs ?? []).filter(item => item.id !== job.id)]);
    setFast(jobActive.has(job.status));
    setMessage(jobActive.has(job.status) ? job.label + " queued." : job.label + " " + job.status + ".");
    if (jobActive.has(job.status)) {
      void request<Job>("/jobs/" + job.id).then(updated => {
        if (updated.status !== job.status) void client.invalidateQueries({ queryKey: ["api"] });
      }).catch(() => null);
    }
  }
  const mine = allJobs.filter(job => !caseId || job.case_id === caseId);
  const context = {
    active: current.data, cases: caseList.data?.items ?? [], caseId, health: health.data, connected: !!health.data && !health.isError,
    prefs, setPref, url, switchCase, openNew: () => setNewCase(true), jobs: mine, activeJobs,
    showJobs: () => setJobTray(true), track, notice: setMessage,
  };
  return <Context.Provider value={context}>
    {children({ newCase, setNewCase, jobTray, setJobTray })}
    <div className="live-region" aria-live="polite" aria-atomic="true">{message && <div className="toast">{message}</div>}</div>
  </Context.Provider>;
}
