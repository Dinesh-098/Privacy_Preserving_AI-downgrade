import { IconFileSearch, IconTopologyStar3 } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useRead } from "../api";
import { DataTable, Empty, ErrorBox, Field, Help, KeyValues, Loading, Origin, Page, Panel, SourceChip, Status } from "../components";
import { metric, modelName, num, pct, utc } from "../format";
import type { Mechanism, Run } from "../types";
import { useWorkspace } from "../workspace";
import { DatasetSelect, Legend, NeedDataset, useCaseDatasets } from "./explorer";
import { RunSetup } from "./experiment-form";
import { useRuns } from "./lab";

export default function AnalysisPage() {
  const workspace = useWorkspace();
  const { query, dataset, items, setDataset } = useCaseDatasets(item => item.kind !== "redteam", true);
  const [mechanism, setMechanism] = useState<Mechanism>("E0");
  const [selectedRun, setSelectedRun] = useState("");
  const summaries = useRuns(workspace.caseId);
  const available = summaries.data?.filter(run => run.dataset_id === dataset?.id) ?? [];
  const current = available.find(item => item.id === selectedRun) ?? available[0];
  const detail = useRead<Run>(current ? "/runs/" + current.id : undefined);
  const effective = dataset?.kind !== "synthetic" && mechanism === "E4" ? "E0" : mechanism;
  return <Page title="AI forensic analysis" summary="Score the records, then open a flagged row to check its source evidence."
    actions={<Help title="Detection and triage"><p>Supervised models require synthetic labels. Isolation Forest scores unusual patterns in labelled or unlabelled inputs.</p>
      <p>The review threshold controls which held-out records appear in the flag list. Treat each model flag as a lead for investigation.</p></Help>}>
    <ErrorBox error={query.error || summaries.error || detail.error} />
    {!dataset ? query.isLoading ? <Loading /> : <Panel title="Analysis setup"><NeedDataset /></Panel> : <>
      <section className="panel filters between"><DatasetSelect items={items} dataset={dataset} setDataset={setDataset} />
        <div className="cluster"><Origin origin={dataset.origin} /><span className="muted mono">{num(dataset.rows)} validated records</span></div></section>
      <div className="analysis-grid">
        <RunSetup dataset={dataset} mechanism={effective} setMechanism={setMechanism} analysis key={dataset.id} />
        <div className="stack">
          <Panel title="Evidence-linked model flags" actions={<Status tone="info">Model predictions</Status>}>
            <div className="filters between">
              {(available.length > 1 || workspace.prefs.mode === "advanced") && <Field label="Completed analysis"><select value={current?.id ?? ""} onChange={event => setSelectedRun(event.target.value)} disabled={!available.length}>
                {!available.length && <option value="">No completed analysis</option>}
                {available.map(run => <option value={run.id} key={run.id}>{modelName[run.config.model]} · {run.id}</option>)}
              </select></Field>}
              {detail.data && <span className="muted mono">{utc(detail.data.created_at)}</span>}
            </div>
            {detail.isLoading || summaries.isLoading ? <Loading /> : detail.data ? <Findings run={detail.data} key={detail.data.id} /> :
              <Empty title="No completed analysis" detail="Choose a compatible model and start a run. Saved predictions can be reviewed here." />}
            <Legend />
          </Panel>
          {workspace.prefs.mode === "advanced" && !!detail.data?.results.importance.length && <Panel title="Global feature importance">
            <div className="stack panel-pad">
              <p className="muted">Impurity-based importance from the fitted Random Forest. This measure summarizes the model across its features.</p>
              <div className="importance-bars">{detail.data.results.importance.map(item => <div key={item.feature}>
                <span>{item.feature}</span><progress value={item.weight} max={1} aria-label={item.feature + " importance"} /><code>{pct(item.weight)}</code>
              </div>)}</div>
            </div>
          </Panel>}
        </div>
      </div>
    </>}
    <p className="next-link">Next <Link to={workspace.url("/lab", dataset ? { dataset: dataset.id } : {})}>Compare experiment results</Link></p>
  </Page>;
}

function Findings({ run }: { run: Run }) {
  const workspace = useWorkspace();
  const saved = run.results.threshold;
  const [threshold, setThreshold] = useState(saved);
  const flags = run.results.findings.filter(item => item.score >= threshold);
  const advanced = workspace.prefs.mode === "advanced";
  const visible = advanced ? flags : flags.slice(0, 20);
  const count = threshold === saved ? run.results.counts.flagged :
    run.results.score_bins.filter(([bin]) => bin >= Math.round(threshold * 100)).reduce((total, [, count]) => total + count, 0);
  return <>
    <div className="panel-pad stack">
      <KeyValues items={[["Held-out records", num(run.results.counts.holdout)],
        ["Flagged", num(count)], ...(advanced ? [["Saved threshold", metric(saved)] as [string, string]] : [])]} />
      <p className="muted">A high score is a lead. Open the related activity to check the original record.</p>
      {workspace.prefs.mode === "advanced" && <Field label={"Review threshold · " + metric(threshold)}
        hint="Adjusts the review view using 0.01 score bins. The run and its stored metrics remain fixed.">
        <input type="range" min={Math.ceil(saved * 100) / 100} max={1} step={0.01} value={Math.max(Math.ceil(saved * 100) / 100, threshold)}
          onChange={event => setThreshold(+event.target.value)} /></Field>}
      {run.results.dp && <div className="alert notice"><span>Training ε {metric(run.results.dp.epsilon)} · δ {run.results.dp.delta.toExponential(1)}
        {" · " + run.results.dp.accountant}</span></div>}
    </div>
    {visible.length ? <DataTable data={visible} label="Flagged held-out records" columns={[
      { id: "source", header: "Source", cell: info => <SourceChip source={info.row.original.event.source} /> },
      { accessorKey: "score", header: "Score", cell: info => <code>{metric(info.getValue())}</code> },
      { id: "status", header: "Status", cell: () => <Status tone="info">Model flag</Status> },
      { id: "ground", header: "Source label", cell: info => <Status tone={info.row.original.event.kind === "synthetic" ? "fixture" : "neutral"}>
        {info.row.original.event.fields.synthetic_label ?? info.row.original.event.label_status}</Status> },
      { id: "correlate", header: "Investigate", cell: info => <Link className="inline-link" to={workspace.url("/correlation", {
        dataset: info.row.original.event.source.dataset_id, line: info.row.original.event.line,
      })}><IconFileSearch size={15} />Related activity</Link> },
    ]} /> : <Empty title="No retained flags exceed the threshold" detail="The review list uses the scores saved from the held-out records." />}
    {count > visible.length && <p className="panel-note"><IconTopologyStar3 size={17} />Showing the {num(visible.length)} highest of {num(count)} flags.</p>}
  </>;
}
