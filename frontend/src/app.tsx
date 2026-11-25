import {
  IconAdjustments, IconArchive, IconChartBar, IconChevronDown, IconCommand, IconDatabase, IconFileCertificate,
  IconFolder, IconHelpCircle, IconHistory, IconLayoutSidebarLeftCollapse, IconListDetails, IconLockCheck, IconMicroscope,
  IconMoon, IconPresentation, IconRoute, IconSearch, IconShieldSearch, IconSquareRoundedLetterA, IconSun,
  IconTimeline, IconTopologyStar3, IconWaveSine,
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { request, useAction, useRead, withQuery } from "./api";
import { Drawer, Empty, ErrorBox, JobProgress, Loading, Page, Status } from "./components";
import { caseStatus, utc } from "./format";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { CaseForm, Investigations } from "./pages/investigations";
import { Overview } from "./pages/overview";
import { EvidencePage } from "./pages/evidence";
import { Explorer } from "./pages/explorer";
import { jobActive } from "./design/tokens";
import type { Dataset, Evidence, Job, RunSummary } from "./types";

const Correlation = lazy(() => import("./pages/correlation"));
const Privacy = lazy(() => import("./pages/privacy").then(module => ({ default: module.PrivacyAnalysis })));
const Protection = lazy(() => import("./pages/privacy").then(module => ({ default: module.PrivacyProtection })));
const Analysis = lazy(() => import("./pages/analysis"));
const Lab = lazy(() => import("./pages/lab"));
const Attacks = lazy(() => import("./pages/attacks"));
const Performance = lazy(() => import("./pages/performance"));
const Reports = lazy(() => import("./pages/records").then(module => ({ default: module.ReportsPage })));
const Audit = lazy(() => import("./pages/records").then(module => ({ default: module.AuditPage })));
const Settings = lazy(() => import("./pages/settings"));
const Design = lazy(() => import("./pages/design"));

const NAV = [
  { label: "Workspace", routes: [
    { path: "/", label: "Overview", icon: IconListDetails, shortcut: "o" },
    { path: "/investigations", label: "Investigations", icon: IconFolder, shortcut: "i" },
    { path: "/evidence", label: "Evidence management", icon: IconArchive, shortcut: "e" },
    { path: "/datasets", label: "Dataset explorer", icon: IconDatabase, shortcut: "d" },
    { path: "/correlation", label: "Event correlation", icon: IconTimeline, shortcut: "c" },
  ] },
  { label: "Privacy", routes: [
    { path: "/privacy", label: "Privacy analysis", icon: IconShieldSearch, shortcut: "p" },
    { path: "/protection", label: "Privacy protection", icon: IconLockCheck, shortcut: "k" },
  ] },
  { label: "Research", routes: [
    { path: "/analysis", label: "AI forensic analysis", icon: IconTopologyStar3, shortcut: "a" },
    { path: "/lab", label: "Privacy–Utility Lab", icon: IconMicroscope, shortcut: "l" },
    { path: "/attacks", label: "Attack simulation", icon: IconRoute, shortcut: "s" },
    { path: "/performance", label: "Performance", icon: IconWaveSine, shortcut: "m" },
  ] },
  { label: "Records", routes: [
    { path: "/reports", label: "Reports", icon: IconFileCertificate, shortcut: "r" },
    { path: "/audit", label: "Audit history", icon: IconHistory, shortcut: "u" },
  ] },
];
const SETTINGS = { path: "/settings", label: "Settings", icon: IconAdjustments, shortcut: "," };
const LINKS = [...NAV.flatMap(group => group.routes), SETTINGS,
  { path: "/design-system", label: "Design system", icon: IconSquareRoundedLetterA, shortcut: "" }];

const WORKFLOW = [{ label: "Case workflow", routes: [
  { path: "/", label: "Overview", icon: IconListDetails, shortcut: "o" },
  { path: "/evidence", label: "Evidence", icon: IconArchive, shortcut: "e" },
  { path: "/datasets", label: "Review activity", icon: IconTimeline, shortcut: "d" },
  { path: "/privacy", label: "Protect data", icon: IconShieldSearch, shortcut: "p" },
  { path: "/analysis", label: "Flag logins", icon: IconTopologyStar3, shortcut: "a" },
  { path: "/lab", label: "Compare results", icon: IconMicroscope, shortcut: "l" },
  { path: "/reports", label: "Reports", icon: IconFileCertificate, shortcut: "r" },
] }];
const WORKFLOW_PARENT: Record<string, string> = {
  "/investigations": "/", "/correlation": "/datasets", "/protection": "/privacy",
  "/attacks": "/lab", "/performance": "/lab", "/audit": "/reports",
};

export function App() {
  return <WorkspaceProvider>{props => <Shell {...props} />}</WorkspaceProvider>;
}

function Shell({ newCase, setNewCase, jobTray, setJobTray }: {
  newCase: boolean; setNewCase: (open: boolean) => void; jobTray: boolean; setJobTray: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const { prefs, setPref, active, activeJobs, health, connected, url } = workspace;
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const chord = useRef(0);
  const priorPath = useRef(path);
  useEffect(() => {
    if (priorPath.current !== path) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      document.getElementById("main-content")?.scrollTo(0, 0);
      priorPath.current = path;
    }
  }, [path]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPalette(open => !open); return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable],[role=dialog]")) return;
      if (event.key === "/") { event.preventDefault(); setPalette(true); }
      if (event.key === "?") { event.preventDefault(); setHelp(true); }
      if (event.key === "g") { chord.current = Date.now(); return; }
      if (Date.now() - chord.current < 900) {
        const route = LINKS.find(item => item.shortcut === event.key);
        if (route) { event.preventDefault(); navigate(url(route.path)); }
        chord.current = 0;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate, url]);
  const caseDatasets = useRead<Dataset[]>(workspace.caseId ? "/cases/" + workspace.caseId + "/datasets" : undefined);
  const fixtures = caseDatasets.data?.some(item => item.origin === "fixture");
  const advanced = prefs.mode === "advanced";
  const groups = advanced ? NAV : WORKFLOW;
  const routeLabel = groups.flatMap(group => group.routes).find(item => item.path === path)?.label
    ?? LINKS.find(item => item.path === path)?.label ?? "Workspace";
  const groupLabel = advanced ? NAV.find(group => group.routes.some(route => route.path === path))?.label ?? "Workspace" : "Case workflow";
  const jobsLabel = activeJobs.length ? activeJobs.length + " running" : "Jobs";
  return <div className={"app " + (prefs.rail ? "rail-collapsed" : "")}>
    <a href="#main-content" className="skip-link">Skip to workspace</a>
    <aside className="sidebar" aria-label="Workspace sidebar">
      <Link to={url("/")} className="brand" aria-label="PrivForensics overview">
        <img src="/mark.svg" alt="" width="35" height="35" /><span><strong>PrivForensics</strong><small>Privacy-preserving forensics</small></span>
      </Link>
      <nav aria-label="Main navigation" className="nav">
        {groups.map(group => <div className="nav-group" key={group.label}>
          <p>{group.label}</p>{group.routes.map(item => <RailItem key={item.path} item={item}
            sectionActive={!advanced && WORKFLOW_PARENT[path] === item.path} />)}
        </div>)}
      </nav>
      <div className="rail-footer">
        <RailItem item={SETTINGS} />
        <div className="rail-meta"><span className="dot" /> <span>Local workspace</span>
          <button className="icon-button" type="button" onClick={() => setPref("rail", !prefs.rail)}
            aria-label={prefs.rail ? "Expand sidebar" : "Collapse sidebar"} title={prefs.rail ? "Expand sidebar" : "Collapse sidebar"}>
            <IconLayoutSidebarLeftCollapse stroke={1.6} size={16} /></button></div>
      </div>
    </aside>
    <header className="topbar">
      <div className="breadcrumb"><span>{groupLabel}</span><span className="slash">/</span><strong>{routeLabel}</strong></div>
      <div className="top-actions">
        <div className="case-switch">
          <select aria-label="Active investigation" value={workspace.caseId || ""} onChange={event => {
            if (event.target.value === "new") setNewCase(true);
            else workspace.switchCase(event.target.value);
          }}>
            {!workspace.caseId && <option value="">Select investigation</option>}
            {workspace.caseId && !workspace.cases.some(item => item.id === workspace.caseId) &&
              <option value={workspace.caseId}>{active?.title || workspace.caseId}</option>}
            {workspace.cases.map(item => <option key={item.id} value={item.id}>{prefs.presentation ? item.id : item.title}</option>)}
            <option value="new">Create investigation…</option>
          </select><IconChevronDown size={13} aria-hidden="true" />
        </div>
        {advanced && <button className="search-launch" type="button" onClick={() => setPalette(true)} aria-label="Open global search">
          <IconSearch size={15} aria-hidden="true" /><span>Search</span><kbd><IconCommand size={11} aria-hidden="true" /> K</kbd>
        </button>}
        <div className="segmented mode-switch" aria-label="Workspace mode">
          <button type="button" aria-pressed={prefs.mode === "simple"} onClick={() => setPref("mode", "simple")}>Simple</button>
          <button type="button" aria-pressed={prefs.mode === "advanced"} onClick={() => setPref("mode", "advanced")}>Advanced</button>
        </div>
        {(advanced || activeJobs.length > 0) && <button className="button jobs-button" type="button" onClick={() => setJobTray(true)} title="Open background jobs">
          <IconChartBar size={15} aria-hidden="true" />{jobsLabel}
        </button>}
        <button className="icon-button top-icon" type="button" aria-label="Presentation mode" title="Presentation mode"
          aria-pressed={prefs.presentation} onClick={() => setPref("presentation", !prefs.presentation)}><IconPresentation size={18} /></button>
        <button className="icon-button top-icon" type="button" aria-label={prefs.theme === "dark" ? "Use light theme" : "Use dark theme"}
          title={prefs.theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={() => setPref("theme", prefs.theme === "dark" ? "light" : "dark")}>
          {prefs.theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>
        {advanced && <button className="icon-button top-icon" type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts"
          onClick={() => setHelp(true)}><IconHelpCircle size={18} /></button>}
      </div>
    </header>
    <main className="workspace" tabIndex={-1} id="main-content">
      <Suspense fallback={<Loading label="Loading workspace page…" />}><Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/investigations" element={<Investigations />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/datasets" element={<Explorer />} />
        <Route path="/correlation" element={<Correlation />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/protection" element={<Protection />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/attacks" element={<Attacks />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/design-system" element={<Design />} />
        <Route path="*" element={<Page title="Page unavailable" summary="The requested address does not match a workspace page.">
          <Link className="button" to={url("/")}>Back to overview</Link></Page>} />
      </Routes></Suspense>
    </main>
    <footer className="statusbar">
      <span><i className={"dot " + (connected ? "online" : "offline")} />{connected ? "Backend connected" : "Backend unavailable"}</span>
      {advanced && <><span>{activeJobs.length} active {activeJobs.length === 1 ? "job" : "jobs"}</span>
        <span className="status-storage" title={health?.storage}>SQLite · {health?.storage?.split("/").at(-1) ?? "—"}</span></>}
      {fixtures && <span className="status-source"><Status tone="fixture">Example fixture</Status></span>}
      {!!active?.run_count && <span>Measured experiment results</span>}
      {advanced && <span className="status-end">Privacy key {health?.key.configured ? "configured" : "not configured"}</span>}
      {prefs.presentation && <span>Presentation mode</span>}{advanced && <span className="mono">v{health?.version ?? "0.1.0"}</span>}
    </footer>
    {newCase && <CaseForm close={() => setNewCase(false)} />}
    {jobTray && <JobTray close={() => setJobTray(false)} />}
    {palette && <CommandPalette close={() => setPalette(false)} />}
    {help && <Drawer title="Keyboard shortcuts" close={() => setHelp(false)} side={false}>
      <div className="shortcuts"><span>Global search</span><kbd>Ctrl / ⌘ K</kbd><span>Quick search</span><kbd>/</kbd>
        <span>Navigate to a page</span><kbd>G + page key</kbd><span>Next / previous table row</span><kbd>J / K</kbd>
        <span>Open focused row</span><kbd>Enter</kbd><span>Close dialog</span><kbd>Esc</kbd>
        {LINKS.filter(item => item.shortcut).map(item => <div className="shortcut-row" key={item.path}><span>{item.label}</span><kbd>G {item.shortcut.toUpperCase()}</kbd></div>)}
      </div>
    </Drawer>}
  </div>;
}

function RailItem({ item, sectionActive }: { item: typeof SETTINGS; sectionActive?: boolean }) {
  const { url } = useWorkspace();
  const Icon = item.icon;
  return <NavLink end to={url(item.path)} className={sectionActive ? "nav-item active" : "nav-item"} title={item.label}
    aria-label={item.label} aria-current={sectionActive ? "location" : undefined}><Icon size={17} stroke={1.52} aria-hidden="true" /><span>{item.label}</span>
    {item.path === "/lab" && <i className="research-mark" aria-hidden="true" />}
  </NavLink>;
}

function JobTray({ close }: { close: () => void }) {
  const { track, prefs } = useWorkspace();
  const query = useRead<Job[]>("/jobs");
  const cancel = useAction((id: string) => request<Job>("/jobs/" + id + "/cancel", "POST"), track);
  return <Drawer title="Background jobs" description="File hashing, ingestion and experiments run here." close={close}>
    <ErrorBox error={query.error || cancel.error} />
    {!query.data?.length ? <Empty title="No jobs yet" detail="Start an evidence or analysis operation to see progress." /> :
      <div className="stack">{query.data.map(job => <article className="job-card" key={job.id}>
        <div className="cluster between"><strong>{job.label}</strong><Status tone={job.status === "failed" ? "danger" :
          job.status === "completed" ? "success" : jobActive.has(job.status) ? "info" : "neutral"}>{job.status}</Status></div>
        <div className="muted mono job-id">{job.id} · {utc(job.created_at)}</div>
        {(jobActive.has(job.status) || job.status === "completed") && <JobProgress job={job} />}
        {job.error && <p className="job-error">{job.error}</p>}
        {jobActive.has(job.status) && <button className="button small" type="button"
          disabled={job.cancel_requested || cancel.isPending} onClick={() => cancel.mutate(job.id)}>
          {job.cancel_requested ? "Cancellation requested" : "Cancel job"}</button>}
        {prefs.mode === "advanced" && job.result && <details><summary>Result metadata</summary><pre>{JSON.stringify(job.result, null, 2)}</pre></details>}
      </article>)}</div>}
  </Drawer>;
}

function CommandPalette({ close }: { close: () => void }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const base = workspace.caseId ? "/cases/" + workspace.caseId : "";
  const evidence = useRead<Evidence[]>(base ? base + "/evidence" : undefined);
  const datasets = useRead<Dataset[]>(base ? base + "/datasets" : undefined);
  const runs = useRead<RunSummary[]>(base ? base + "/runs" : undefined);
  const choices = [
    ...LINKS.map(item => ({ label: item.label, category: "Page", action: () => navigate(workspace.url(item.path)) })),
    { label: "New investigation", category: "Action", action: workspace.openNew },
    { label: "Background jobs", category: "Action", action: workspace.showJobs },
    ...workspace.cases.map(item => ({ label: workspace.prefs.presentation ? item.id : item.title, category: "Investigation", action: () => workspace.switchCase(item.id) })),
    ...(evidence.data ?? []).map(item => ({ label: workspace.prefs.presentation ? item.id : item.name, category: "Evidence",
      action: () => navigate(workspace.url("/evidence", { evidence: item.id })) })),
    ...(datasets.data ?? []).map(item => ({ label: workspace.prefs.presentation ? item.id : item.name, category: "Dataset",
      action: () => navigate(workspace.url("/datasets", { dataset: item.id })) })),
    ...(runs.data ?? []).map(item => ({ label: item.id + " · " + item.config.mechanism, category: "Experiment",
      action: () => navigate(workspace.url("/lab", { run: item.id })) })),
  ].filter(item => (item.label + " " + item.category).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 28);
  function pick(choice: typeof choices[number]) { close(); choice.action(); }
  return <Drawer title="Search workspace" description="Search pages, investigations, evidence and actions." close={close} side={false}>
    <div className="palette">
      <label className="sr-only" htmlFor="command-search">Find a page or record</label>
      <input id="command-search" value={q} placeholder="Find a page, investigation or record…" onChange={event => { setQ(event.target.value); setIndex(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown") { event.preventDefault(); setIndex(value => Math.min(value + 1, choices.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setIndex(value => Math.max(value - 1, 0)); }
          if (event.key === "Enter" && choices[index]) { event.preventDefault(); pick(choices[index]); }
        }} />
      <div className="palette-results">{choices.map((choice, i) => <button type="button" key={choice.category + choice.label + i}
        className={i === index ? "current" : ""} onClick={() => pick(choice)}><span>{choice.label}</span><small>{choice.category}</small></button>)}
        {!choices.length && <p>No records or pages match this search.</p>}</div>
    </div>
  </Drawer>;
}
