import { IconClipboardList, IconDatabase, IconDownload, IconFileCertificate, IconFlask2, IconHistory,
  IconReportAnalytics, IconShieldCheck, IconTimeline } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request, useAction, useRead, withQuery } from "../api";
import { Confirm, DataTable, Drawer, Empty, ErrorBox, Field, HashText, Help, KeyValues, Loading, Page,
  Pagination, Panel, Status } from "../components";
import { activityName, bytes, mechanismName, num, utc } from "../format";
import type { Audit, PageResult, Report, ReportData, ReportFormat, ReportType } from "../types";
import { useWorkspace } from "../workspace";
import { useRuns } from "./lab";

const reportTypes = [
  ["investigation", "Investigation summary", IconClipboardList], ["evidence", "Evidence integrity", IconFileCertificate],
  ["correlation", "Event correlation", IconTimeline], ["privacy", "Privacy assessment", IconShieldCheck],
  ["evaluation", "Privacy–utility evaluation", IconFlask2], ["leakage", "Privacy leakage evaluation", IconDatabase],
  ["performance", "Computational performance", IconReportAnalytics], ["audit", "Audit history", IconHistory],
] as const;

export function ReportsPage() {
  const workspace = useWorkspace();
  const [params] = useSearchParams();
  const preset = params.get("type");
  const first = reportTypes.find(([key]) => key === preset)?.[0] ?? "investigation";
  return <Page title="Reports" summary="Download a summary of the case, its evidence and the measured results."
    actions={<Help title="Report exports"><p>Reports use saved case records, validated dataset versions and measured experiment results. The preview shows the sections and redaction settings that will be exported.</p></Help>}>
    {!workspace.caseId ? <Panel title="Report workspace"><Empty title="Select an investigation" detail="Choose an active case before generating a report."
      action={<Link className="button" to={workspace.url("/investigations")}>Investigations</Link>} /></Panel> :
      <ReportWorkspace key={workspace.caseId} caseId={workspace.caseId} first={first} />}
    <p className="next-link">Next <Link to={workspace.url("/audit")}>Review the audit ledger</Link></p>
  </Page>;
}

function ReportWorkspace({ caseId, first }: { caseId: string; first: ReportType }) {
  const workspace = useWorkspace();
  const advanced = workspace.prefs.mode === "advanced";
  const [type, setType] = useState<ReportType>(first);
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [includeSensitive, setSensitive] = useState(false);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [sectionNames, setSections] = useState<string[]>();
  const [confirm, setConfirm] = useState(false);
  const base = "/cases/" + caseId + "/reports";
  const reports = useRead<Report[]>(base);
  const runs = useRuns(caseId);
  const include = includeSensitive && !workspace.prefs.presentation;
  const args = { type, run_ids: runIds, include_sensitive: include };
  const preview = useQuery({ queryKey: ["api", base + "/preview", args], queryFn: ({ signal }) =>
    request<ReportData>(base + "/preview", "POST", args, signal) });
  const available = preview.data?.sections.map(item => item.title) ?? [];
  const chosen = sectionNames?.filter(item => available.includes(item)) ?? available;
  const create = useAction(() => request<Report>(base, "POST", {
    ...args, sections: chosen, format, confirmed: true,
  }), result => {
    workspace.notice("Report generated and saved to history.");
    const link = document.createElement("a");
    link.href = "/api/reports/" + result.id + "/download"; link.download = result.id + "." + result.format; link.click();
  });
  function chooseReport(value: ReportType) {
    setType(value);
    setSections(undefined);
  }
  return <>
    <ErrorBox error={reports.error || runs.error || preview.error || create.error} />
    <div className="report-grid">
      <div className="stack">
        <Panel title="Report type">
          {advanced ? <div className="report-types" role="group" aria-label="Report type">
            {reportTypes.map(([id, label, Icon]) => <button type="button" key={id} aria-pressed={type === id}
              onClick={() => chooseReport(id)}><Icon size={17} stroke={1.55} /><span>{label}</span></button>)}
          </div> : <div className="panel-pad"><Field label="Report to export">
            <select value={type} onChange={event => chooseReport(event.target.value as ReportType)}>
              {reportTypes.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
            </select>
          </Field></div>}
        </Panel>
        <Panel title="Export options">
          <div className="stack panel-pad">
            <Field label="File format"><select value={format} onChange={event => setFormat(event.target.value as ReportFormat)}>
              <option value="pdf">PDF</option><option value="csv">CSV</option><option value="html">HTML</option><option value="md">Markdown</option>
            </select></Field>
            {["investigation", "evaluation", "leakage", "performance"].includes(type) && !!runs.data?.length && <details>
              <summary>Choose included experiments</summary>
              <div className="report-checks"><p className="muted">With no explicit selection, include up to 12 recent runs.</p>
                {runs.data.slice(0, 24).map(run => <label className="check-row" key={run.id}>
                  <input type="checkbox" checked={runIds.includes(run.id)} disabled={runIds.length >= 12 && !runIds.includes(run.id)}
                    onChange={event => setRunIds(list => event.target.checked ? [...list, run.id] : list.filter(id => id !== run.id))} />
                  <span>{run.config.mechanism} · <span className="mono">{run.id}</span></span>
                </label>)}</div>
            </details>}
            {available.length > 0 && <details><summary>Choose sections</summary><div className="report-checks">
              {available.map(name => <label className="check-row" key={name}><input type="checkbox" checked={chosen.includes(name)}
                onChange={event => setSections(event.target.checked ? [...chosen, name] : chosen.filter(item => item !== name))} />{name}</label>)}
            </div></details>}
            {(advanced || includeSensitive) && <label className="check-row"><input type="checkbox" checked={include} disabled={workspace.prefs.presentation}
              onChange={event => setSensitive(event.target.checked)} />Include sensitive case labels and notes</label>}
            {workspace.prefs.presentation && <p className="muted">Presentation mode keeps sensitive report fields redacted.</p>}
            {!chosen.length && preview.data && <p className="muted">Choose at least one section to export.</p>}
            <button className="button primary" type="button" disabled={!preview.data || !chosen.length || create.isPending}
              onClick={() => setConfirm(true)}><IconDownload size={17} />{create.isPending ? "Generating…" : "Generate report"}</button>
          </div>
        </Panel>
      </div>
      <Panel title="Report preview" className="preview-panel" actions={<Status tone={include ? "warning" : "success"}>{include ? "Sensitive notes included" : "Redacted"}</Status>}>
        {preview.isLoading ? <Loading label="Preparing report preview…" /> : preview.data ? <article className="paper">
          <div className="paper-brand"><img src="/mark.svg" width="26" height="26" alt="" /><strong>PrivForensics</strong><code>{preview.data.case_id}</code></div>
          <h3>{preview.data.title}</h3>
          <p className="paper-note">{preview.data.subtitle} · {utc(preview.data.generated_at)}</p>
          <p className="paper-note">{preview.data.redaction}</p>
          {preview.data.sections.filter(item => chosen.includes(item.title)).map(item => <section key={item.title}>
            <h4>{item.title}</h4>
            {item.text && <p>{item.text}</p>}
            {item.columns.length > 0 && (item.rows.length ?
              <div className="paper-table"><table aria-label={item.title}><thead><tr>
                {item.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
                  {item.rows.slice(0, 12).map((row, index) => <tr key={index}>
                    {row.map((value, col) => <td key={col}>{value ?? "—"}</td>)}</tr>)}
                </tbody></table></div> : <p className="paper-note">No records in this scope.</p>)}
            {item.rows.length > 12 && <p className="paper-note">Preview shows 12 of {num(item.rows.length)} rows. The export includes this full section.</p>}
          </section>)}
        </article> : <Empty title="Preview unavailable" detail="Choose a report type and review the active case." />}
      </Panel>
    </div>
    <Panel title="Export history">
      {reports.isLoading ? <Loading /> : reports.data?.length ?
        <DataTable data={reports.data} label="Generated report history" columns={[
          { accessorKey: "type", header: "Report type", cell: info => reportTypes.find(([id]) => id === info.getValue())?.[1] ?? info.getValue() },
          { accessorKey: "id", header: "Report ID", cell: info => <code>{info.getValue()}</code> },
          { accessorKey: "sha256", header: "SHA-256", cell: info => <HashText hash={info.getValue()} /> },
          { accessorKey: "created_at", header: "Generated (UTC)", cell: info => <code>{utc(info.getValue())}</code> },
          { accessorKey: "size", header: "Size", cell: info => <code>{bytes(info.getValue())}</code> },
          { id: "download", header: "File", cell: info => <a className="inline-link" href={"/api/reports/" + info.row.original.id + "/download"} download>
            <IconDownload size={15} />{info.row.original.format.toUpperCase()}</a> },
        ]} /> : <p className="panel-note">Generated exports will appear here with their SHA-256.</p>}
    </Panel>
    {confirm && preview.data && <Confirm title="Generate report" detail={preview.data.redaction + " The export and its hash will be stored locally."}
      action="Generate and download" close={() => setConfirm(false)} confirm={() => create.mutate()} />}
  </>;
}

export function AuditPage() {
  const workspace = useWorkspace();
  const [unscoped, setUnscoped] = useState(false);
  const [filters, setFilters] = useState({ q: "", action: "", actor: "", entity: "", after: "", before: "" });
  const [active, setActive] = useState(filters);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Audit>();
  const caseId = unscoped ? undefined : workspace.caseId;
  const values = { ...active, case_id: caseId };
  const query = useRead<PageResult<Audit>>(withQuery("/audit", { ...values, page, size: 40 }));
  const verify = useAction(() => request<{ valid: boolean; checked: number; failed_at: number | null }>("/audit/verify"));
  const typeLabel = (item: Audit) => item.entity.split("-")[0];
  const objectLink = (item: Audit) => {
    const extras = item.case_id ? { case: item.case_id } : {};
    const suffix = new URLSearchParams(extras as Record<string, string>);
    if (typeLabel(item) === "EV") suffix.set("evidence", item.entity);
    if (typeLabel(item) === "DATA") suffix.set("dataset", item.entity);
    if (typeLabel(item) === "RUN") suffix.set("run", item.entity);
    if (typeLabel(item) === "CASE") suffix.set("detail", item.entity);
    const path = { EV: "/evidence", DATA: "/datasets", CASE: "/investigations", RUN: "/lab", REP: "/reports", KEY: "/settings",
      FIND: "/correlation" }[typeLabel(item)];
    return path ? path + "?" + suffix.toString() : undefined;
  };
  return <Page title="Audit history" summary="Trace local operations and check the sequence of recorded entries."
    actions={<><a className="button" href={"/api" + withQuery("/audit/export", values)} download><IconDownload size={16} />Export CSV</a>
      <button type="button" className="button primary" onClick={() => verify.mutate()} disabled={verify.isPending}><IconShieldCheck size={17} />Verify chain</button></>}>
    <ErrorBox error={query.error || verify.error} />
    {verify.data && <div className={"alert " + (verify.data.valid ? "notice" : "error")} role="status"><IconShieldCheck size={18} />
      {verify.data.valid ? "Verified " + num(verify.data.checked) + " linked audit entries." : "Verification failed at sequence " + num(verify.data.failed_at) + "."}</div>}
    <Panel title="Operation ledger" actions={<Status>{caseId ? "Active investigation" : "All investigations"}</Status>}>
      <form className="filters" onSubmit={event => { event.preventDefault(); setActive(filters); setPage(1); }}>
        <Field label="Search ledger"><input type="search" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="Action or reference" /></Field>
        <Field label="Action code"><input value={filters.action} onChange={event => setFilters({ ...filters, action: event.target.value })} placeholder="evidence.verified" /></Field>
        <Field label="Actor"><input value={filters.actor} onChange={event => setFilters({ ...filters, actor: event.target.value })} placeholder="Local operator" /></Field>
        {workspace.prefs.mode === "advanced" && <>
          <Field label="Entity ID"><input value={filters.entity} onChange={event => setFilters({ ...filters, entity: event.target.value })} /></Field>
          <Field label="From (UTC)"><input type="datetime-local" value={filters.after} onChange={event => setFilters({ ...filters, after: event.target.value })} /></Field>
          <Field label="Through (UTC)"><input type="datetime-local" value={filters.before} onChange={event => setFilters({ ...filters, before: event.target.value })} /></Field>
        </>}
        {workspace.caseId && <label className="check-row table-toggle"><input type="checkbox" checked={unscoped}
          onChange={event => { setPage(1); setUnscoped(event.target.checked); }} />All cases</label>}
        <button type="submit" className="button">Apply filters</button>
      </form>
      {query.isLoading ? <Loading /> : query.data?.items.length ?
        <><DataTable data={query.data.items} label="Recorded local actions" onSelect={setDetail} columns={[
          { accessorKey: "sequence", header: "Seq.", cell: info => <button type="button" className="text-button mono" onClick={() => setDetail(info.row.original)}>
            {num(info.getValue())}</button> },
          { accessorKey: "time", header: "Time (UTC)", cell: info => <code>{utc(info.getValue())}</code> },
          { accessorKey: "action", header: "Action", cell: info => <span>{activityName(info.getValue())}</span> },
          { accessorKey: "actor", header: "Actor" },
          { accessorKey: "entity", header: "Reference", cell: info => {
            const link = objectLink(info.row.original);
            return link ? <Link className="mono" to={link}>{info.getValue()}</Link> : <code>{info.getValue()}</code>;
          } },
          { accessorKey: "case_id", header: "Case", cell: info => <code>{info.getValue() ?? "—"}</code> },
        ]} /><Pagination page={page} size={40} hasMore={query.data.has_more} setPage={setPage} /></> :
        !query.error && <Empty title="No audit entries in scope" detail="Register evidence, save a policy or run an experiment to populate the ledger." />}
    </Panel>
    <p className="muted">The local hash chain checks recorded order and content. Its trust depends on access to this workstation and storage.</p>
    {detail && <Drawer title={activityName(detail.action)} description={"Audit entry " + detail.sequence} close={() => setDetail(undefined)}>
      <div className="stack"><KeyValues items={[["Actor", detail.actor], ["Time (UTC)", utc(detail.time)], ["Case", detail.case_id ?? "—"],
        ["Reference", objectLink(detail) ? <Link to={objectLink(detail)!} onClick={() => setDetail(undefined)}>{detail.entity}</Link> : detail.entity]]} />
        <section className="inset stack"><h3>Provenance</h3>
          <KeyValues items={[["Entry digest", <HashText hash={detail.entry_hash} />], ["Previous digest", <HashText hash={detail.previous_hash} />]]} /></section>
        <details><summary>Recorded detail</summary><pre>{JSON.stringify(detail.detail, null, 2)}</pre></details>
      </div>
    </Drawer>}
  </Page>;
}
