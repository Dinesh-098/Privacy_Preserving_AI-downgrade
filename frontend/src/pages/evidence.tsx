import { IconDownload, IconFilePlus, IconFileSearch, IconShieldCheck } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request, useAction, useRead, withQuery } from "../api";
import { Confirm, DataTable, Drawer, Empty, ErrorBox, Field, HashText, JobProgress, KeyValues,
  Loading, Page, Panel, Status, Tabbed } from "../components";
import { activityName, bytes, kindName, utc } from "../format";
import type { Audit, Evidence, Job, Kind, PageResult } from "../types";
import { useWorkspace } from "../workspace";

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const status = evidence.integrity;
  return <Status tone={status === "verified" ? "success" : status === "mismatch" ? "danger" : "neutral"}>
    {status === "verified" ? "Verified" : status === "mismatch" ? "Hash mismatch" : "Not yet verified"}</Status>;
}

export function EvidencePage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [register, setRegister] = useState(false);
  const [q, setQ] = useState("");
  const [integrity, setIntegrity] = useState("");
  const caseId = workspace.caseId;
  const list = useRead<Evidence[]>(caseId ? "/cases/" + caseId + "/evidence" : undefined);
  const rows = list.data?.filter(item => (!integrity || item.integrity === integrity) &&
    (item.name + " " + item.id + " " + item.sha256).toLowerCase().includes(q.toLowerCase())) ?? [];
  const chosen = params.get("evidence");
  function select(id?: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("evidence", id);
    else next.delete("evidence");
    setParams(next);
  }
  return <Page title="Evidence management" summary="Register digital evidence, verify its SHA-256 and review documented handling."
    actions={caseId && <button className="button primary" type="button" onClick={() => setRegister(true)}><IconFilePlus size={17} />Register evidence</button>}>
    {!caseId ? <Panel title="Evidence register"><Empty title="Select an investigation" detail="Evidence must belong to an investigation."
      action={<button className="button primary" type="button" onClick={workspace.openNew}>New investigation</button>} /></Panel> :
      <Panel title="Evidence register" actions={<span className="muted">{list.data?.length ?? "—"} files</span>}>
        <div className="filters"><Field label="Search"><input type="search" value={q} onChange={event => setQ(event.target.value)}
          placeholder="Filename, evidence ID or hash" /></Field>
          <Field label="Integrity"><select value={integrity} onChange={event => setIntegrity(event.target.value)}>
            <option value="">All evidence</option><option value="registered">Not yet verified</option>
            <option value="verified">Verified</option><option value="mismatch">Hash mismatch</option>
          </select></Field></div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Loading /> : rows.length ? <DataTable data={rows} label="Registered evidence" onSelect={item => select(item.id)} columns={[
          { accessorKey: "name", header: "Evidence file", cell: info => <button className="text-button" type="button"
            onClick={() => select(info.row.original.id)}><IconFileSearch size={15} />{workspace.prefs.presentation ? info.row.original.id : info.getValue()}</button> },
          { accessorKey: "source", header: "Source", cell: info => info.getValue() === "fixture" ? <Status tone="fixture">Example fixture</Status> :
            info.getValue() === "local" ? "Local path" : "Upload" },
          { accessorKey: "size", header: "Size", cell: info => <code>{bytes(info.getValue())}</code> },
          { accessorKey: "sha256", header: "SHA-256", cell: info => <HashText hash={info.getValue()} /> },
          { accessorKey: "integrity", header: "Integrity", cell: info => <EvidenceBadge evidence={info.row.original} /> },
          { accessorKey: "verified_at", header: "Last verified (UTC)", cell: info => <code>{utc(info.getValue())}</code> },
        ]} /> :
          <Empty title={q || integrity ? "No evidence matches" : "No evidence registered yet"}
            detail={q || integrity ? "Adjust the filters to view other files." : "Register a local path for a large file or upload a small one."}
            action={!q && !integrity && <button className="button" type="button" onClick={() => setRegister(true)}>Register a file</button>} />}
      </Panel>}
    <p className="next-link">Next <Link to={workspace.url("/datasets")}>Review activity</Link></p>
    {register && caseId && <RegisterForm caseId={caseId} close={() => setRegister(false)} />}
    {chosen && <EvidenceDetail id={chosen} close={() => select()} />}
  </Page>;
}

function RegisterForm({ caseId, close }: { caseId: string; close: () => void }) {
  const workspace = useWorkspace();
  const [mode, setMode] = useState(workspace.prefs.mode === "advanced" ? "local" : "upload");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const mutation = useAction(async (type: string) => {
    const url = "/cases/" + caseId + "/evidence/";
    if (type === "local") return request<Job>(url + "local", "POST", { path });
    const form = new FormData();
    if (file) form.append("file", file);
    return request<Job>(url + "upload", "POST", form);
  }, result => { workspace.track(result); close(); });
  const limit = workspace.health?.limits.upload_bytes ?? 24 * 1024 * 1024;
  const oversized = file && file.size > limit;
  const form = <div className="stack">
    {mode === "local" ? <Field label="Absolute file path" hint="Use a file inside the project or a configured evidence directory.">
      <input className="mono" required autoFocus value={path} onChange={event => setPath(event.target.value)}
        placeholder="/Users/…/dataset/lanl/auth.txt.gz" /></Field> :
      <Field label="Evidence file" hint={"Maximum upload " + bytes(limit) + ". Register a local path for larger files."}>
        <input type="file" required onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>}
    {oversized && mode === "upload" && <p className="alert error" role="alert">This file exceeds the upload limit.</p>}
    <ErrorBox error={mutation.error} />
    <div className="cluster"><button className="button primary" type="submit"
      disabled={mutation.isPending || (mode === "local" ? !path.trim() : !file || !!oversized)}>
      {mutation.isPending ? "Submitting…" : "Register and hash"}</button><button type="button" className="button" onClick={close}>Cancel</button></div>
  </div>;
  return <Drawer title="Register evidence" description="The original SHA-256 is recorded when the file is registered." close={close}>
    <form onSubmit={event => { event.preventDefault(); mutation.mutate(mode); }}>
      <Tabbed value={mode} change={setMode} label="Evidence registration method" tabs={[
        { id: "local", label: "Register local file", content: <div className="stack"><p className="muted">
          Reference a file in place. Large files are hashed in the background without copying.</p>{form}</div> },
        { id: "upload", label: "Upload file", content: <div className="stack"><p className="muted">
          Store a managed copy inside the local workspace.</p>{form}</div> },
      ]} />
    </form>
  </Drawer>;
}

function EvidenceDetail({ id, close }: { id: string; close: () => void }) {
  const workspace = useWorkspace();
  const detail = useRead<Evidence>("/evidence/" + id);
  const audit = useRead<PageResult<Audit>>(withQuery("/audit", { entity: id, size: 40 }));
  const [verifyId, setVerifyId] = useState<string>();
  const selectedJob = workspace.jobs.find(job => job.id === verifyId);
  const verify = useAction(() => request<Job>("/evidence/" + id + "/verify", "POST"), job => {
    setVerifyId(job.id); workspace.track(job);
  });
  const item = detail.data;
  return <Drawer title={item ? (workspace.prefs.presentation ? item.id : item.name) : "Evidence detail"} description={id} close={close}>
    <div className="stack">
      <ErrorBox error={detail.error || audit.error || verify.error} />
      {detail.isLoading && <Loading />}
      {item && <>
        <div className="cluster"><EvidenceBadge evidence={item} />{item.source === "fixture" && <Status tone="fixture">Example fixture</Status>}</div>
        <KeyValues items={[["File size", bytes(item.size)], ["Registered (UTC)", utc(item.created_at)], ["Last verified (UTC)", utc(item.verified_at)],
          ["Source", item.source === "local" ? "Local path" : item.source === "upload" ? "Managed upload" : "Generated fixture"],
          ...(item.path && workspace.prefs.mode === "advanced" && !workspace.prefs.presentation ? [["Path", <code>{item.path}</code>] as [string, React.ReactNode]] : [])]} />
        <section className="stack inset">
          <h3>Provenance</h3>
          <div className="hash-full"><span>Registered SHA-256</span><code>{item.sha256}</code><HashText hash={item.sha256} /></div>
          {item.verified_sha256 && <div className="hash-full"><span>Recomputed SHA-256</span><code>
            {item.verified_sha256.split("").map((character, index) => <span className={character !== item.sha256[index] ? "different" : ""} key={index}>{character}</span>)}
          </code><HashText hash={item.verified_sha256} /></div>}
        </section>
        {item.integrity === "mismatch" && <div className="alert error" role="alert">
          The file differs from its registered hash. Restore and verify the original, or register the current file as new evidence.
        </div>}
        <div className="cluster"><button className="button primary" type="button" disabled={verify.isPending || selectedJob?.status === "running" || selectedJob?.status === "queued"}
          onClick={() => verify.mutate()}><IconShieldCheck size={17} />Verify hash</button>
          <a className="button" href={"/api/evidence/" + item.id + "/export"} download><IconDownload size={16} />Export metadata</a></div>
        {selectedJob && <div className="inset stack"><JobProgress job={selectedJob} />
          {selectedJob.error && <p className="alert error">{selectedJob.error}</p>}</div>}
        <h3>Custody log</h3>
        <ol className="custody">{audit.data?.items.map(entry => <li key={entry.sequence}>
          <strong>{activityName(entry.action)}</strong><small>{utc(entry.time)} · {entry.actor}</small></li>)}</ol>
        <p className="muted">The custody log records actions performed in this local application.</p>
        <Link className="button" to={workspace.url("/datasets", { ingest: item.id })}>Ingest this evidence</Link>
      </>}
    </div>
  </Drawer>;
}

function detectedKind(evidence?: Evidence): Kind {
  const name = evidence?.name.toLowerCase() ?? "";
  if (name.includes("redteam") || name.includes("red-team")) return "redteam";
  if (name.includes("proc")) return "proc";
  if (name.includes(".csv")) return "synthetic";
  return "auth";
}

export function IngestForm({ evidence, selected, close }: { evidence: Evidence[]; selected?: string; close: () => void }) {
  const workspace = useWorkspace();
  const [id, setId] = useState(selected ?? evidence[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>(detectedKind(evidence.find(item => item.id === id)));
  const [mode, setMode] = useState("sample");
  const [line, setLine] = useState("");
  const [count, setCount] = useState(25_000);
  const [confirm, setConfirm] = useState(false);
  const item = evidence.find(source => source.id === id);
  const mutation = useAction((full: boolean) => request<Job>("/evidence/" + id + "/ingest", "POST", {
    kind, mode, start: line ? Number(line) : null, count, confirm_full: full,
  }), job => { workspace.track(job); close(); });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "full") setConfirm(true);
    else mutation.mutate(false);
  }
  return <Drawer title="Ingest evidence" description="Choose a schema and a source range to create an analytical dataset." close={close}>
    <form className="stack" onSubmit={submit}>
      <Field label="Evidence"><select value={id} onChange={event => { setId(event.target.value); setKind(detectedKind(evidence.find(source => source.id === event.target.value))); }}>
        {evidence.map(source => <option key={source.id} value={source.id}>{workspace.prefs.presentation ? source.id : source.name}</option>)}</select></Field>
      <Field label="Source schema"><select value={kind} onChange={event => setKind(event.target.value as Kind)}>
        {(Object.keys(kindName) as Kind[]).map(key => <option key={key} value={key}>{kindName[key]}</option>)}</select></Field>
      <Field label="Scan scope"><select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="sample">Sample from the beginning</option><option value="range">Physical line range</option><option value="full">Full stream or remaining range</option>
      </select></Field>
      {mode !== "sample" && <Field label="First physical line" hint="Resume at the line following a previously completed range.">
        <input type="number" min={kind === "synthetic" ? 2 : 1} value={line} onChange={event => setLine(event.target.value)}
          placeholder={kind === "synthetic" ? "2" : "1"} /></Field>}
      {mode !== "full" && <Field label="Maximum source lines"><input type="number" value={count} min={1} max={20_000_000}
        onChange={event => setCount(Number(event.target.value))} required /></Field>}
      {item?.integrity === "mismatch" && <div className="alert error" role="alert">Verify the source successfully before ingesting this evidence.</div>}
      <ErrorBox error={mutation.error} />
      <div className="cluster"><button className="button primary" type="submit" disabled={mutation.isPending || !id || item?.integrity === "mismatch"}>
        {mutation.isPending ? "Submitting…" : "Start ingestion"}</button><button className="button" type="button" onClick={close}>Cancel</button></div>
    </form>
    {confirm && <Confirm title="Scan the full source" detail={"This can read up to " + bytes(item?.size) +
      " of source data and write a Parquet dataset. Check the available disk space. The job tray shows a measured rate and ETA once processing starts."}
      action="Confirm full scan" close={() => setConfirm(false)} confirm={() => mutation.mutate(true)} />}
  </Drawer>;
}
