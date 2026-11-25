import { useQueryClient } from '@tanstack/react-query';
import { IconDatabaseImport, IconEye, IconFilter, IconTimeline } from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request, useRead, withQuery } from "../api";
import { Confirm, DataTable, Drawer, Empty, ErrorBox, Field, HashText, KeyValues, Loading,
  Origin, Page, Pagination, Panel, SourceChip, Status, Tabbed } from "../components";
import { sensitiveFields } from "../design/tokens";
import { bytes, fieldName, kindName, num, pct, sec, utc } from "../format";
import type { Dataset, Evidence, Event, FieldValue, PageResult } from "../types";
import { useWorkspace } from "../workspace";
import { IngestForm } from "./evidence";

const Chart = lazy(() => import("../chart"));

export function useCaseDatasets(predicate?: (item: Dataset) => boolean, preferSynthetic = false) {
  const { caseId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const query = useRead<Dataset[]>(caseId ? "/cases/" + caseId + "/datasets" : undefined);
  const items = (query.data ?? []).filter(item => predicate?.(item) ?? true);
  const dataset = items.find(item => item.id === params.get("dataset")) ??
    (preferSynthetic ? items.find(item => item.kind === "synthetic") : undefined) ?? items[0];
  function setDataset(id: string) {
    const next = new URLSearchParams(params);
    next.set("dataset", id);
    next.delete("line");
    setParams(next);
  }
  return { query, items, dataset, setDataset, params, setParams };
}

export function DatasetSelect({ items, dataset, setDataset }: {
  items: Dataset[]; dataset?: Dataset; setDataset: (id: string) => void;
}) {
  const workspace = useWorkspace();
  return <Field label="Dataset"><select value={dataset?.id ?? ""} onChange={event => setDataset(event.target.value)}
    disabled={!items.length} title={!items.length ? "Ingest evidence to list datasets." : undefined}>
    {!items.length && <option value="">No ingested datasets</option>}
    {items.map(item => <option value={item.id} key={item.id}>
      {(workspace.prefs.presentation ? item.id : item.name) + " · " + kindName[item.kind]}
    </option>)}
  </select></Field>;
}

export function NeedDataset({ title = "No dataset selected", detail = "Ingest an evidence file or load the example case from Overview." }: {
  title?: string; detail?: string;
}) {
  const workspace = useWorkspace();
  return <Empty title={title} detail={detail} icon="data" action={<div className="cluster">
    <Link className="button" to={workspace.url("/datasets")}>Dataset explorer</Link>
    <Link className="button" to={workspace.url("/")}>Investigation overview</Link></div>} />;
}

export function LabelStatus({ event }: { event: Event }) {
  return <Status tone={event.label_status === "Known red-team" ? "danger outline" : event.label_status === "Fixture reference" ||
    event.label_status === "Synthetic label" ? "fixture" : "neutral"}>{event.label_status}</Status>;
}

export function Legend() {
  return <div className="legend"><Status>Unlabelled</Status><Status tone="danger outline">Known red-team</Status>
    <Status tone="fixture">Synthetic label</Status><Status tone="info">Model flag</Status></div>;
}

export function Explorer() {
  const workspace = useWorkspace();
  const { query, items, dataset, setDataset, params, setParams } = useCaseDatasets();
  const evidence = useRead<Evidence[]>(workspace.caseId ? "/cases/" + workspace.caseId + "/evidence" : undefined);
  const detail = useRead<Dataset>(dataset ? "/datasets/" + dataset.id : undefined);
  const [ingest, setIngest] = useState(false);
  const [q, setQ] = useState("");
  const current = detail.data ?? dataset;
  const openIngest = params.get("ingest");
  const line = Number(params.get("line") || 0);
  function change(key: string, value?: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "line" && dataset) next.set("dataset", dataset.id);
    setParams(next);
  }
  return <Page title="Dataset explorer" summary="Read a sample of your log and open a row to trace it back to its source file."
    actions={evidence.data?.length ? <button className="button primary" type="button" onClick={() => setIngest(true)}>
      <IconDatabaseImport size={17} />Ingest evidence</button> : undefined}>
    <ErrorBox error={query.error || evidence.error || detail.error} />
    {query.isLoading ? <Loading /> : !items.length ? <Panel title="Analytical datasets">
      <Empty title="No ingested datasets" detail={evidence.data?.length ? "Select registered evidence and ingest a sample or physical line range." :
        "Register evidence before creating an analytical dataset."} icon="data" action={evidence.data?.length ?
        <button className="button primary" type="button" onClick={() => setIngest(true)}>Ingest evidence</button> :
        <Link className="button primary" to={workspace.url("/evidence")}>Register evidence</Link>} /></Panel> :
      <div className="split-pane">
        <Panel title="Sources" className="sources-panel">
          <div className="panel-pad"><Field label="Find dataset"><input type="search" placeholder="Search sources"
            value={q} onChange={event => setQ(event.target.value)} /></Field></div>
          <div className="source-list">{items.filter(item => (item.name + kindName[item.kind]).toLowerCase().includes(q.toLowerCase())).map(item =>
            <button className={dataset?.id === item.id ? "active" : ""} type="button" onClick={() => setDataset(item.id)} key={item.id}>
              <strong>{kindName[item.kind]}</strong><small>{workspace.prefs.presentation ? item.id : item.name}</small>
              <span><code>{num(item.rows)} valid</code><Origin origin={item.origin} /></span>
            </button>)}
            {!items.some(item => (item.name + kindName[item.kind]).toLowerCase().includes(q.toLowerCase())) && <p className="panel-pad muted">No matching source.</p>}
          </div>
          {workspace.jobs.filter(job => job.type === "ingest" || job.type === "fixture").slice(0, 3).map(job =>
            <button className="resource-row" type="button" key={job.id} onClick={workspace.showJobs}><span>{job.label}</span><Status>{job.status}</Status></button>)}
        </Panel>
        {current && <div className="stack">
          <section className="dataset-strip" aria-label="Dataset scope">
            <div><strong>{kindName[current.kind]}</strong><small>{workspace.prefs.presentation ? current.id : current.name}</small></div>
            <div className="cluster"><Origin origin={current.origin} /><code>{num(current.rows)} rows</code>
              <HashText hash={current.sha256} label="Copy dataset version hash" /></div>
          </section>
          <section className="panel">
            <Tabbed key={current.id} label="Dataset views" initial="sample" tabs={[
              ...(workspace.prefs.mode === "advanced" ? [{ id: "schema", label: "Schema", content: <Schema dataset={current} /> }] : []),
              { id: "sample", label: "Sample", content: <Sample dataset={current} select={selected => change("line", String(selected))} /> },
              ...(workspace.prefs.mode === "advanced" ? [{ id: "distributions", label: "Distributions", content: <Distribution dataset={current} /> }] : []),
              { id: "validation", label: "Validation", content: <Validation dataset={current} /> },
              ...(workspace.prefs.mode === "advanced" ? [{ id: "provenance", label: "Provenance", content: <DatasetProvenance dataset={current} /> }] : []),
            ]} /></section>
        </div>}
      </div>}
    <p className="next-link">Next <Link to={workspace.url("/correlation", dataset ? { dataset: dataset.id } : {})}>Correlate events</Link></p>
    {(ingest || openIngest) && evidence.data?.length ? <IngestForm evidence={evidence.data} selected={openIngest ?? undefined}
      close={() => { setIngest(false); change("ingest"); }} /> : null}
    {current && line > 0 && <EventDrawer datasetId={current.id} line={line} close={() => change("line")} />}
  </Page>;
}

function Schema({ dataset }: { dataset: Dataset }) {
  return <DataTable label="Dataset schema" data={dataset.meta.fields.map(field => ({
    field, present: dataset.meta.present[field] ?? 0, sensitive: sensitiveFields.has(field),
    type: ["ts", "hour", "attempts", "synthetic_label"].includes(field) ? "Integer" : "Text",
  }))} columns={[
    { accessorKey: "field", header: "Field", cell: info => <code>{fieldName(info.getValue())}</code> },
    { accessorKey: "type", header: "Type" },
    { accessorKey: "present", header: "Null rate", cell: info => <code>{pct(dataset.rows ? 1 - info.getValue() / dataset.rows : null)}</code> },
    { accessorKey: "sensitive", header: "Sensitivity", cell: info => <Status tone={info.getValue() ? "fixture" : "neutral"}>
      {info.getValue() ? "Sensitive field" : "No structured flag"}</Status> },
  ]} />;
}

function Sample({ dataset, select }: { dataset: Dataset; select: (line: number) => void }) {
  const { health, prefs } = useWorkspace();
  const [form, setForm] = useState({ start: "", end: "", user: "", host: "", event_type: "", outcome: "" });
  const [filters, setFilters] = useState(form);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("line");
  const [show, setShow] = useState(false);
  const query = useRead<PageResult<Event>>(withQuery("/datasets/" + dataset.id + "/events", { page, size: 40, sort, ...filters }));
  const key = dataset.kind === "auth" ? "outcome" : dataset.kind === "proc" ? "event_type" :
    dataset.kind === "synthetic" ? "synthetic_label" : "dst_host";
  return <>
    <div className="filters between">
      <button className="button" type="button" aria-expanded={show} onClick={() => setShow(!show)}><IconFilter size={16} />Event filters</button>
      <Field label="Order"><select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
        <option value="line">Source line ↑</option><option value="-line">Source line ↓</option>
        <option value="time">Elapsed time ↑</option><option value="-time">Elapsed time ↓</option></select></Field>
      <span className="muted mono">Query budget {health?.limits.rows ?? 100} rows · {health?.limits.query_seconds ?? 8} s</span>
    </div>
    {show && <form className="filters" onSubmit={event => { event.preventDefault(); setFilters(form); setPage(1); }}>
      {([["start", "From second"], ["end", "To second"], ["user", "Exact account"], ["host", "Exact host"], ["event_type", "Event type"], ["outcome", "Outcome"]] as const).map(([field, label]) =>
        <Field label={label} key={field}><input type={field === "start" || field === "end" ? "number" : "text"} min={1}
          value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} /></Field>)}
      <button className="button primary" type="submit">Apply filters</button>
      <button className="button" type="button" onClick={() => { const blank = { start: "", end: "", user: "", host: "", event_type: "", outcome: "" };
        setForm(blank); setFilters(blank); setPage(1); }}>Clear filters</button>
    </form>}
    <ErrorBox error={query.error} />
    {query.isLoading ? <Loading /> : query.data?.items.length ? <>
      <DataTable label="Validated source records" data={query.data.items} onSelect={row => select(row.line)} columns={[
        { accessorKey: "line", header: "Source line", enableSorting: false, cell: info => <button className="text-button mono" type="button"
          onClick={() => select(info.row.original.line)}>{num(info.getValue())}</button> },
        { accessorKey: "time", header: "Elapsed (s)", enableSorting: false, cell: info => <code>{num(info.getValue())}</code> },
        { accessorFn: row => row.fields.src_user, header: "Account", cell: info => <code>{info.getValue() ?? "—"}</code> },
        { accessorFn: row => row.fields[key], header: fieldName(key), cell: info => <span>{info.getValue() ?? "—"}</span> },
        ...(prefs.mode === "advanced" ? [{ accessorFn: (row: Event) => row.fields.src_host ?? row.fields.device_id,
          header: "Host or device", cell: ({ getValue }: { getValue: () => FieldValue }) => <code>{getValue() ?? "—"}</code> }] : []),
        { id: "status", header: "Label status", cell: info => <LabelStatus event={info.row.original} /> },
      ]} />
      <Pagination page={page} size={40} total={query.data.total} hasMore={query.data.has_more} setPage={setPage} />
    </> : !query.error && <Empty title="No records match" detail="Adjust the filters or choose another data source." />}
    <Legend />
  </>;
}

function Validation({ dataset }: { dataset: Dataset }) {
  return <div className="stack panel-pad">
    <KeyValues items={[["Validated rows", num(dataset.rows)], ["Rejected rows", num(dataset.malformed)],
      ["Source range", num(dataset.first_line) + "–" + num(dataset.last_line)]]} />
    {dataset.meta.error_examples.length ? <DataTable label="Malformed row examples" data={dataset.meta.error_examples} columns={[
      { accessorKey: "line", header: "Physical line", cell: info => <code>{num(info.getValue())}</code> },
      { accessorKey: "reason", header: "Validation reason" },
    ]} /> : <p className="muted">No parse failures in this ingested range.</p>}
  </div>;
}

function DatasetProvenance({ dataset }: { dataset: Dataset }) {
  const workspace = useWorkspace();
  return <div className="stack panel-pad">
    <KeyValues items={[["Dataset", <code>{dataset.id}</code>], ["Evidence", <Link to={workspace.url("/evidence", { evidence: dataset.evidence_id })}>
      {dataset.evidence_id}</Link>], ["Dataset version", <HashText hash={dataset.sha256} />], ["Evidence SHA-256", <HashText hash={dataset.evidence_sha256} />],
      ["Physical lines", num(dataset.first_line) + "–" + num(dataset.last_line)], ["Schema", dataset.meta.schema_version],
      ["Processed at (UTC)", utc(dataset.created_at)], ["Source bytes read", bytes(dataset.meta.bytes_read)], ["Runtime", sec(dataset.meta.duration_s)],
      ["Clock", dataset.meta.clock]]} />
    <button className="button" type="button" onClick={workspace.showJobs}>Inspect ingestion jobs</button>
  </div>;
}

function Distribution({ dataset }: { dataset: Dataset }) {
  const bins = dataset.meta.bins;
  const grouping = useRead<{ field: string | null; items: [string, number][] }>("/datasets/" + dataset.id + "/distribution");
  const options = useMemo(() => ({
    xAxis: { type: "value", name: "Elapsed seconds" }, yAxis: { type: "value", name: "Events per bin" },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 13, bottom: 5, showDetail: false }],
    series: [{ name: "Validated records", type: "bar", data: bins, barMaxWidth: 16 }],
  }), [bins]);
  return <div className="stack panel-pad">
    <ErrorBox error={grouping.error} />
    <Suspense fallback={<Loading label="Preparing charts…" />}>
      {bins.length ? <Chart title="Events over time" options={options}
        description={"Ingested range · " + num(dataset.rows) + " valid rows · " + num(dataset.meta.bin_seconds) + " s bins"}
        headings={["Elapsed seconds", "Validated rows"]} rows={bins} /> :
        <Empty title="No time distribution" detail="This range does not contain validated elapsed-time values." />}
      {!!grouping.data?.field && !!grouping.data.items.length && <Chart title={"Top " + fieldName(grouping.data.field).toLowerCase() + " categories"}
        description={"Counts across the validated ingested range · " + num(dataset.rows) + " rows · up to eight recorded values"}
        options={{ xAxis: { type: "category", name: "Recorded category", data: grouping.data.items.map(([name]) => name) },
          yAxis: { type: "value", name: "Validated rows", nameGap: 40 }, series: [{ type: "bar",
            data: grouping.data.items.map(([, count]) => count), barMaxWidth: 42 }] }}
        headings={["Category", "Validated rows"]} rows={grouping.data.items} />}
    </Suspense>
  </div>;
}

export function EventDrawer({ datasetId, line, close }: { datasetId: string; line: number; close: () => void }) {
  const query = useRead<Event>("/datasets/" + datasetId + "/events/" + line);
  const workspace = useWorkspace();
  return <Drawer title={"Event · line " + num(line)} description="Validated source record with redacted identifiers." close={close}>
    <ErrorBox error={query.error} />{query.isLoading && <Loading />}
    {query.data && <div className="stack"><EventDetail event={query.data} />
      <Link className="button primary" to={workspace.url("/correlation", { dataset: datasetId, line })}><IconTimeline size={17} />Find related events</Link>
    </div>}
  </Drawer>;
}

export function EventDetail({ event }: { event: Event }) {
  const [target, setTarget] = useState<string>();
  const [visible, setVisible] = useState<{ field: string; value: FieldValue }>();
  const { prefs } = useWorkspace();
  const [error, setError] = useState<Error>();
  const pending = useRef<AbortController>();
  const cache = useQueryClient();
  async function reveal(field: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setVisible(undefined);
    setError(undefined);
    try {
      const result = await request<{ value: FieldValue; seconds: number }>(
        "/datasets/" + event.source.dataset_id + "/events/" + event.line + "/reveal",
        "POST", { field, confirmed: true }, controller.signal);
      if (!controller.signal.aborted) setVisible({ field, value: result.value });
      void cache.invalidateQueries({ queryKey: ["api"], predicate: query => String(query.queryKey[1]).startsWith("/audit") });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error : new Error("The value could not be revealed."));
    }
  }
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [visible]);
  useEffect(() => {
    setVisible(undefined);
    return () => pending.current?.abort();
  }, [event.line, event.source.dataset_id, prefs.presentation]);
  return <div className="stack">
    <div className="cluster"><Status tone={event.kind === "proc" ? "fixture" : "info"}>{kindName[event.kind]}</Status><LabelStatus event={event} />
      <Origin origin={event.source.origin} /></div>
    <KeyValues items={Object.entries(event.fields).map(([key, value]) => [
      fieldName(key), <span className="cluster justify-end" key={key}><code>{!prefs.presentation && visible?.field === key ? visible.value ?? "—" : value ?? "—"}</code>
        {!prefs.presentation && sensitiveFields.has(key) && value != null && <button className="icon-button icon-inline" type="button"
          title={"Reveal " + fieldName(key)} aria-label={"Reveal " + fieldName(key)} onClick={() => setTarget(key)}><IconEye size={15} /></button>}</span>,
    ])} />
    <ErrorBox error={error} />
    <section className="inset stack"><h3>Provenance</h3>
      <KeyValues items={[["Evidence ID", <code>{event.source.evidence_id}</code>],
        ["Dataset version", <HashText hash={event.source.dataset_hash} />], ["Physical line", <SourceChip source={event.source} />]]} />
    </section>
    {target && <Confirm title={"Reveal " + fieldName(target).toLowerCase()} detail="The original value will be visible for 10 seconds. This action is recorded in audit history."
      action="Reveal value" close={() => setTarget(undefined)} confirm={() => void reveal(target)} />}
  </div>;
}
