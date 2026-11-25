import { IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request, useAction, useRead, withQuery } from "../api";
import { Confirm, DataTable, Drawer, Empty, ErrorBox, Field, KeyValues, Loading, Page, Pagination, Panel, SourceChip,
  Status, Tabbed } from "../components";
import { activityName, caseStatus, num, utc } from "../format";
import type { Audit, CaseStatus, Evidence, Finding, Investigation, PageResult, Report, RunSummary } from "../types";
import { useWorkspace } from "../workspace";

export function CaseForm({ close, existing }: { close: () => void; existing?: Investigation }) {
  const workspace = useWorkspace();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState<CaseStatus>(existing?.status ?? "open");
  const [confirm, setConfirm] = useState(false);
  const mutation = useAction(() => request<Investigation>(existing ? "/cases/" + existing.id : "/cases",
    existing ? "PATCH" : "POST", existing ? { title, description, status } : { title, description }), result => {
      workspace.switchCase(result.id); workspace.notice(existing ? "Investigation updated." : "Investigation created."); close();
    });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (existing && status !== existing.status) setConfirm(true);
    else mutation.mutate();
  }
  return <Drawer title={existing ? "Edit investigation" : "New investigation"} description="Give the case a short, recognizable title." close={close}>
    <form className="stack form" onSubmit={submit}>
      <Field label="Investigation title"><input value={title} onChange={event => setTitle(event.target.value)}
        required maxLength={160} placeholder="e.g. Authentication review" autoFocus /></Field>
      <Field label="Description" hint="Optional context for the local case record."><textarea rows={5} maxLength={5000}
        value={description} onChange={event => setDescription(event.target.value)} placeholder="Scope, purpose or working notes" /></Field>
      {existing && <Field label="Status"><select value={status} onChange={event => setStatus(event.target.value as CaseStatus)}>
        {Object.entries(caseStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Field>}
      <ErrorBox error={mutation.error} />
      <div className="cluster"><button type="submit" className="button primary" disabled={mutation.isPending || !title.trim()}>
        {mutation.isPending ? "Saving…" : existing ? "Save changes" : "Create investigation"}</button>
        <button className="button" type="button" onClick={close}>Cancel</button></div>
    </form>
    {confirm && <Confirm title="Change investigation status" detail={"Set this case to " + caseStatus[status].toLowerCase() + "?"}
      action="Change status" close={() => setConfirm(false)} confirm={() => mutation.mutate()} />}
  </Drawer>;
}

export function Investigations() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(false);
  const active = workspace.active;
  const list = useRead<PageResult<Investigation>>(withQuery("/cases", { q, status, page, size: 20 }));
  const detail = active && params.get("detail") === active.id;
  function select(item: Investigation) {
    setParams(new URLSearchParams({ case: item.id, detail: item.id }));
  }
  return <Page title="Investigations" summary="Create a case and keep its evidence, findings and experiments together."
    actions={<button className="button primary" type="button" onClick={workspace.openNew}><IconPlus size={17} />New investigation</button>}>
    <Panel title="Case register" actions={<span className="muted">{num(list.data?.total)} cases</span>}>
      <div className="filters">
        <Field label="Search"><input type="search" placeholder="Case title or ID" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} /></Field>
        <Field label="Status"><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">All statuses</option>{Object.entries(caseStatus).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></Field>
      </div>
      <ErrorBox error={list.error} />
      {list.isLoading ? <Loading /> : list.data?.items.length ?
        <DataTable label="Investigation register" data={list.data.items} onSelect={select} columns={[
          { accessorKey: "id", header: "Case ID", cell: info => <button className="text-button mono" type="button"
            onClick={() => select(info.row.original)}>{info.getValue()}</button> },
          { accessorKey: "title", header: "Investigation", cell: info => <strong>{workspace.prefs.presentation ? "Investigation" : info.getValue()}</strong> },
          { accessorKey: "status", header: "Status", cell: info => <Status tone={info.getValue() === "open" ? "info" : "neutral"}>
            {caseStatus[info.getValue() as CaseStatus]}</Status> },
          { accessorKey: "evidence_count", header: "Evidence", cell: info => <span className="mono">{num(info.getValue())}</span> },
          { accessorKey: "finding_count", header: "Findings", cell: info => <span className="mono">{num(info.getValue())}</span> },
          { accessorKey: "run_count", header: "Experiments", cell: info => <span className="mono">{num(info.getValue())}</span> },
          { accessorKey: "updated_at", header: "Updated (UTC)", cell: info => <span className="mono">{utc(info.getValue())}</span> },
        ]} /> :
        <Empty title={q || status ? "No matching investigations" : "No investigations yet"}
          detail={q || status ? "Change the search or status filter to see more cases." : "Create an investigation before registering your first file."}
          action={!q && !status ? <button className="button" type="button" onClick={workspace.openNew}><IconFolderPlus size={16} />Create a case</button> : undefined} />}
      {list.data && !!list.data.total && <Pagination page={page} setPage={setPage} total={list.data.total} size={20} />}
    </Panel>
    <p className="next-link">Next <Link to={workspace.url("/evidence")}>Register evidence</Link></p>
    {detail && active && <Drawer title={workspace.prefs.presentation ? active.id : active.title} description={active.id} close={() =>
      setParams(new URLSearchParams({ case: active.id }))}><CaseDetail investigation={active} edit={() => setEdit(true)} /></Drawer>}
    {edit && active && <CaseForm existing={active} close={() => setEdit(false)} />}
  </Page>;
}

function CaseDetail({ investigation, edit }: { investigation: Investigation; edit: () => void }) {
  const workspace = useWorkspace();
  const base = "/cases/" + investigation.id;
  const evidence = useRead<Evidence[]>(base + "/evidence");
  const findings = useRead<Finding[]>(base + "/findings");
  const audit = useRead<PageResult<Audit>>("/audit?case_id=" + investigation.id + "&size=15");
  const runs = useRead<RunSummary[]>(base + "/runs");
  const reports = useRead<Report[]>(base + "/reports");
  return <Tabbed label="Investigation details" tabs={[
    { id: "summary", label: "Summary", content: <div className="stack">
      <KeyValues items={[["Status", <Status tone={investigation.status === "open" ? "info" : "neutral"}>{caseStatus[investigation.status]}</Status>],
        ["Created (UTC)", utc(investigation.created_at)], ["Last activity (UTC)", utc(investigation.updated_at)],
        ["Evidence registered", num(investigation.evidence_count)], ["Findings", num(investigation.finding_count)]]} />
      {investigation.description && !workspace.prefs.presentation && <p>{investigation.description}</p>}
      <div className="cluster"><button className="button" type="button" onClick={edit}>Edit investigation</button>
        <Link className="button primary" to={workspace.url("/evidence")}>Register evidence</Link></div>
    </div> },
    { id: "evidence", label: "Evidence", content: <div className="stack"><ErrorBox error={evidence.error} />
      {evidence.data?.length ? evidence.data.map(item => <Link className="resource-row" key={item.id}
        to={workspace.url("/evidence", { evidence: item.id })}>{workspace.prefs.presentation ? item.id : item.name}<code>{item.id}</code></Link>) :
        <p className="muted">No evidence attached to this case.</p>}</div> },
    { id: "findings", label: "Findings", content: <div className="stack"><ErrorBox error={findings.error} />
      {findings.data?.length ? findings.data.map(item => <div className="job-card" key={item.id}><strong>{workspace.prefs.presentation ?
        item.id : item.title}</strong><p>{workspace.prefs.presentation ? "" : item.notes}</p><SourceChip source={item.events.anchor.source} /></div>) :
        <p className="muted">No findings saved to this case.</p>}</div> },
    { id: "runs", label: "Experiments", content: <div className="stack"><ErrorBox error={runs.error} />
      {runs.data?.length ? runs.data.map(item => <Link className="resource-row" key={item.id}
        to={workspace.url("/lab", { run: item.id })}>{item.id}<code>{item.config.mechanism}</code></Link>) :
        <p className="muted">No completed experiments in this case.</p>}</div> },
    { id: "reports", label: "Reports", content: <div className="stack"><ErrorBox error={reports.error} />
      {reports.data?.length ? reports.data.map(item => <a className="resource-row" key={item.id}
        href={"/api/reports/" + item.id + "/download"}>{item.type}<code>{item.format.toUpperCase()}</code></a>) :
        <p className="muted">No reports generated for this case.</p>}</div> },
    { id: "activity", label: "Activity", content: <div className="stack"><ErrorBox error={audit.error} />
      {audit.data?.items.map(item => <div className="resource-row" key={item.sequence}><span>{activityName(item.action)}</span><code>{utc(item.time)}</code></div>)}
    </div> },
  ]} />;
}
