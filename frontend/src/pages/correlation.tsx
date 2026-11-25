import { IconFilter, IconLink, IconPlus, IconTimeline } from "@tabler/icons-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request, useAction, useRead, withQuery } from "../api";
import { DataTable, Drawer, Empty, ErrorBox, Field, Help, Loading, Origin, Page, Panel, SourceChip, Status } from "../components";
import { laneColors } from "../design/tokens";
import { kindName, num, sec } from "../format";
import type { Dataset, Event, Finding, Kind, Related, Timeline } from "../types";
import { useWorkspace } from "../workspace";
import { DatasetSelect, EventDetail, LabelStatus, Legend, NeedDataset, useCaseDatasets } from "./explorer";

const Chart = lazy(() => import("../chart"));
const lanes: Kind[] = ["auth", "proc", "redteam", "synthetic"];
const marker = { auth: "circle", proc: "rect", redteam: "diamond", synthetic: "triangle" };

export default function CorrelationPage() {
  const workspace = useWorkspace();
  const { items, dataset, setDataset, params, setParams, query } = useCaseDatasets();
  const [form, setForm] = useState({ start: "", end: "", user: "", host: "" });
  const [scope, setScope] = useState(form);
  const [window, setWindow] = useState(120);
  const [match, setMatch] = useState("");
  const [modelFlags, showModelFlags] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [save, setSave] = useState(false);
  const line = Number(params.get("line") ?? "");
  const timeline = useRead<Timeline>(dataset ? withQuery("/datasets/" + dataset.id + "/timeline", {
    ...scope, include_model: modelFlags, cap: workspace.prefs.mode === "advanced" ? 3000 : 600,
  }) : undefined);
  const related = useRead<Related>(line > 0 && dataset ? withQuery("/datasets/" + dataset.id + "/events/" + line + "/related", { window }) : undefined);
  const past = useRead<Finding[]>(workspace.caseId ? "/cases/" + workspace.caseId + "/findings" : undefined);
  const matches = related.data?.related.filter(item => !match || item.rule.id === match) ?? [];
  function select(event: Event) {
    const next = new URLSearchParams(params);
    next.set("dataset", event.source.dataset_id); next.set("line", String(event.line)); setParams(next);
  }
  function clear() {
    const next = new URLSearchParams(params); next.delete("line"); setParams(next);
  }
  return <Page title="Event correlation" summary="Pick a login or reference event to see nearby activity with matching accounts and computers."
    actions={<Help title="Correlation rules">
      <h3>R1 · Red-team reference</h3><p>Exact elapsed second, source account, source host and destination host. Fixture references describe generated observations.</p>
      <h3>R2 · Identifier association</h3><p>A role-paired account and host appears in both events within the selected time window. This association is a lead for investigation.</p>
      <h3>R3 · Synthetic temporal association</h3><p>The generated or imported synthetic source contains a repeated account within the selected window.</p>
    </Help>}>
    <ErrorBox error={query.error || timeline.error || related.error} />
    {!dataset ? query.isLoading ? <Loading /> : <Panel title="Timeline"><NeedDataset /></Panel> :
      <>
        <section className="panel filters correlation-controls" aria-label="Correlation filters">
          <DatasetSelect items={items} dataset={dataset} setDataset={setDataset} />
          <form className="cluster filter-form" onSubmit={event => { event.preventDefault(); setScope(form); }}>
            {([["start", "From second"], ["end", "To second"], ["user", "Exact account"], ["host", "Exact host"]] as const).map(([key, title]) =>
              <Field label={title} key={key}><input type={key === "start" || key === "end" ? "number" : "text"} min={1} value={form[key]}
                onChange={event => setForm({ ...form, [key]: event.target.value })} /></Field>)}
            <button className="button" type="submit"><IconFilter size={16} />Apply</button>
          </form>
          <label className="check-row table-toggle"><input type="checkbox" checked={modelFlags}
            onChange={event => showModelFlags(event.target.checked)} />Model flags</label>
          <Origin origin={dataset.origin} />
        </section>
        <div className="correlation-grid">
          <div className="stack">
            {timeline.isLoading ? <Loading /> : timeline.data?.events.length ?
              <TimelinePlot timeline={timeline.data} selected={related.data?.event} associations={matches} select={select} /> :
              <Panel title="Timeline"><Empty title="No timeline events in scope"
                detail="Choose another dataset or time range. Timeline records require a validated elapsed timestamp." /></Panel>}
            <Panel title="Events shown" actions={<span className="mono muted">{num(timeline.data?.events.length)} in view</span>}>
              {timeline.data?.events.length ? <EventList events={timeline.data.events} select={select} /> :
                <div className="panel-note">Timeline events will appear here.</div>}<Legend />
            </Panel>
          </div>
          <Panel title="Related activity" actions={line > 0 && <button className="text-button" type="button" onClick={clear}>Clear selection</button>}>
            <div className="stack panel-pad">
              <Field label={"Correlation window · " + sec(window)} hint="Updates the identifier search around the selected event.">
                <input type="range" min={5} max={900} step={5} value={window} onChange={event => setWindow(+event.target.value)} />
              </Field>
              <Field label="Association type"><select value={match} onChange={event => setMatch(event.target.value)}>
                <option value="">All supported rules</option><option value="R1">R1 · Red-team reference</option><option value="R2">R2 · Identifier association</option>
                <option value="R3">R3 · Synthetic temporal association</option>
              </select></Field>
              {!line ? <Empty title="Select an event" detail="Choose a point or a record to see the rule behind each relationship." /> : related.isLoading ? <Loading /> :
                related.data && <>
                  <div className="inset stack">
                    <div className="cluster between"><strong>{kindName[related.data.event.kind]}</strong><LabelStatus event={related.data.event} /></div>
                    <div className="cluster between"><SourceChip source={related.data.event.source} /><button className="text-button" type="button"
                      onClick={() => setInspect(true)}>Inspect event</button></div>
                  </div>
                  <div className="cluster between"><h3>Why linked</h3><span className="mono muted">{num(matches.length)} matches</span></div>
                  {matches.length ? <div className="related-list">{matches.map(item => <div className="related-result" key={item.event.source.dataset_id + item.event.line}>
                    <div className="cluster between"><Status tone={item.rule.id === "R1" ? "danger outline" : item.rule.id === "R2" ? "success" : "info"}>
                      {item.rule.id} · {item.rule.type}</Status><code>{sec(item.rule.seconds)}</code></div>
                    <p>{item.rule.why}</p><div className="cluster between"><SourceChip source={item.event.source} /><button className="text-button" type="button"
                      onClick={() => select(item.event)}>Inspect relation</button></div>
                  </div>)}</div> : <p className="muted">No related records for these rules and this time window.</p>}
                  {related.data.truncated && <p className="muted">This view is bounded. Narrow the window for a more specific search.</p>}
                  <button className="button primary" type="button" onClick={() => setSave(true)}><IconPlus size={16} />Save finding</button>
                </>}
            </div>
          </Panel>
        </div>
        <Panel title="Saved findings" actions={<Link className="inline-link" to={workspace.url("/reports")}>Generate report</Link>}>
          {past.data?.length ? <DataTable data={past.data} label="Saved evidence-linked findings" columns={[
            { accessorKey: "title", header: "Finding", cell: info => workspace.prefs.presentation ? info.row.original.id : info.getValue() },
            { accessorKey: "severity", header: "Severity", cell: info => <Status tone={info.getValue() === "critical" || info.getValue() === "high" ? "danger" : "neutral"}>{info.getValue()}</Status> },
            { id: "link", header: "Anchor", cell: info => <SourceChip source={info.row.original.events.anchor.source} /> },
            { id: "related", header: "Related records", accessorFn: item => item.events.related.length },
          ]} /> : <div className="panel-note"><IconLink size={17} />Saved findings retain the source line and rule for each attachment.</div>}
        </Panel>
        {inspect && related.data && <Drawer title="Event record" close={() => setInspect(false)}><EventDetail event={related.data.event} /></Drawer>}
        {save && related.data && <FindingForm dataset={dataset} result={related.data} close={() => setSave(false)} />}
      </>}
    <p className="next-link">Next <Link to={workspace.url("/privacy", dataset ? { dataset: dataset.id } : {})}>Review privacy threats</Link></p>
  </Page>;
}

function EventList({ events, select }: { events: Event[]; select: (item: Event) => void }) {
  const [count, setCount] = useState(25);
  return <>
    <DataTable data={events.slice(0, count)} label="Timeline events" onSelect={select} columns={[
      { accessorKey: "time", header: "Elapsed (s)", cell: info => <button className="text-button mono" type="button"
        onClick={() => select(info.row.original)}>{num(info.getValue())}</button> },
      { accessorKey: "kind", header: "Lane", cell: info => kindName[info.getValue() as Kind] },
      { id: "source", header: "Source", cell: info => <SourceChip source={info.row.original.source} /> },
      { id: "status", header: "Label status", cell: info => <LabelStatus event={info.row.original} /> },
    ]} />
    {events.length > count && <div className="panel-pad"><button className="button small" type="button" onClick={() => setCount(value => value + 25)}>Show 25 more</button></div>}
  </>;
}

function TimelinePlot({ timeline, selected, associations, select }: { timeline: Timeline; selected?: Event;
  associations: Related["related"]; select: (event: Event) => void }) {
  const present = lanes.filter(lane => timeline.events.some(event => event.kind === lane));
  const predictions = timeline.predictions ?? [];
  const predictionTimes = predictions.flatMap(flag => flag.event.time == null ? [] : [flag.event.time]);
  const low = Math.min(timeline.events[0].time ?? 1, ...predictionTimes);
  const high = Math.max(timeline.events.at(-1)?.time ?? low, ...predictionTimes);
  const laneLabels = [...present.map(item => item === "redteam" ? "Red-team" : item === "auth" ? "Authentication" :
    item === "proc" ? "Process" : "Synthetic"), ...(predictions.length ? ["Model flags"] : [])];
  const options = useMemo(() => {
    const actual = timeline.events.map((event, index) => ({ event, value: [event.time, present.indexOf(event.kind), index] }));
    const key = (event: Event) => event.source.dataset_id + ":" + event.line;
    const visible = new Set(timeline.events.map(key));
    const showLines = selected && visible.has(key(selected)) ? associations.filter(item => visible.has(key(item.event)) &&
      item.rule.seconds >= 0).slice(0, 20) : [];
    return {
      grid: { left: 104, right: 24, top: 27, bottom: 63, outerBoundsMode: "none" },
      xAxis: { type: "value", name: "Elapsed seconds", min: low, max: high > low ? high : low + 1, scale: true },
      yAxis: { type: "category", data: laneLabels },
      dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", height: 15, bottom: 8, filterMode: "none" }],
      series: [
        ...present.map(kind => ({
          name: kindName[kind], type: "scatter", symbol: marker[kind], symbolSize: kind === "redteam" ? 9 : 6,
          data: actual.filter(item => item.event.kind === kind).map(item => item.value), itemStyle: { color: laneColors[kind], opacity: 0.85 },
          tooltip: { formatter: (point: { data: number[] }) => kindName[kind] + " · " + point.data[0] + " s, source line " + timeline.events[point.data[2]].line },
        })),
        ...(predictions.length ? [{ name: "Model flags", type: "scatter", symbol: "emptyCircle", symbolSize: 8,
          itemStyle: { color: "#98afcc" }, data: predictions.map((flag, index) => [flag.event.time, present.length, timeline.events.length + index]),
          tooltip: { formatter: (point: { data: number[] }) => {
            const flag = predictions[point.data[2] - timeline.events.length];
            return flag.run_id + " · score " + flag.score.toFixed(3) + " · line " + flag.event.line;
          } },
        }] : []),
        ...showLines.map(item => ({
          type: "line", silent: true, showSymbol: false,
          data: [[selected!.time, present.indexOf(selected!.kind)], [item.event.time, present.indexOf(item.event.kind)]],
          lineStyle: { type: item.rule.id === "R3" ? "dashed" : "solid", width: item.rule.id === "R1" ? 2 : 1.5,
            color: item.rule.id === "R1" ? laneColors.redteam : laneColors.synthetic },
        })),
      ],
    };
  }, [timeline, selected, associations, low, high, present.join(",")]);
  return <Suspense fallback={<Loading label="Preparing event timeline…" />}><Chart title="Event timeline" height={277} options={options}
    description={num(timeline.events.length) + " plotted events across " + num(timeline.scope.length) + " compatible source ranges · " +
      timeline.clock + " · up to " + num(timeline.cap) + " records. Drag the lower window to zoom."}
    headings={["Elapsed seconds", "Lane", "Dataset", "Source line", "Run ID"]} rows={[
      ...timeline.events.map(event => [event.time, kindName[event.kind], event.source.dataset_id, event.line, null]),
      ...predictions.map(flag => [flag.event.time, "Model flag", flag.event.source.dataset_id, flag.event.line, flag.run_id]),
    ]}
    onPick={point => {
      if (!Array.isArray(point)) return;
      const index = Number(point[2]);
      const event = timeline.events[index] ?? predictions[index - timeline.events.length]?.event;
      if (event) select(event);
    }} /></Suspense>;
}

function FindingForm({ dataset, result, close }: { dataset: Dataset; result: Related; close: () => void }) {
  const workspace = useWorkspace();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [notes, setNotes] = useState("");
  const [included, setIncluded] = useState<string[]>(result.related.slice(0, 8).map(item => item.event.source.dataset_id + ":" + item.event.line));
  const save = useAction(() => request<Finding>("/cases/" + dataset.case_id + "/findings", "POST", {
    title, severity, notes, dataset_id: result.event.source.dataset_id, line: result.event.line, window: result.window,
    references: result.related.map(item => ({ dataset_id: item.event.source.dataset_id, line: item.event.line })).filter(item =>
      included.includes(item.dataset_id + ":" + item.line)),
  }), () => { workspace.notice("Finding saved to the investigation."); close(); });
  return <Drawer title="Save finding" description="The selected event and each attached relationship retain a source reference." close={close}>
    <form className="stack" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <Field label="Finding title"><input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label="Severity"><select value={severity} onChange={event => setSeverity(event.target.value)}>
        {["info", "low", "medium", "high", "critical"].map(item => <option key={item}>{item}</option>)}
      </select></Field>
      <Field label="Notes"><textarea rows={4} value={notes} maxLength={5000} onChange={event => setNotes(event.target.value)} /></Field>
      <div className="inset stack"><h3>Attachments</h3><SourceChip source={result.event.source} />
        {result.related.map(item => {
          const key = item.event.source.dataset_id + ":" + item.event.line;
          return <label className="check-row" key={key}><input type="checkbox" checked={included.includes(key)}
            onChange={event => setIncluded(values => event.target.checked ? [...values, key] : values.filter(value => value !== key))} />
            <span>{kindName[item.event.kind]} · Line {num(item.event.line)} · {item.rule.id}</span></label>;
        })}</div>
      <ErrorBox error={save.error} />
      <button className="button primary" type="submit" disabled={!title.trim() || save.isPending}>Save to investigation</button>
    </form>
  </Drawer>;
}
