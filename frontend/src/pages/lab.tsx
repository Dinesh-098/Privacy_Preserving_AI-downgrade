import { IconCheck, IconChevronRight, IconCopy, IconFlask2, IconRefresh, IconScale } from "@tabler/icons-react";
import { useQueries } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { exportCsv, request, useAction, useRead } from "../api";
import { DataTable, Empty, ErrorBox, Field, HashText, Help, KeyValues, Loading, Origin, Page, Panel, Status, Tabbed } from "../components";
import { chartColors } from "../design/tokens";
import { mechanismName, metric, modelName, num, pct, sec, utc } from "../format";
import type { Dataset, Job, Mechanism, Run, RunSummary } from "../types";
import { useWorkspace } from "../workspace";
import { DatasetSelect, NeedDataset, useCaseDatasets } from "./explorer";
import { mechanisms, MechanismStrip, RunSetup } from "./experiment-form";

const Chart = lazy(() => import("../chart"));
export const performanceFields = [
  ["training_s", "Training (s)"], ["inference_s", "Inference (s)"], ["peak_rss_mb", "Peak RSS (MiB)"],
  ["rss_increase_mb", "RSS increase (MiB)"], ["cpu_percent", "CPU (% of one core)"], ["inference_rows_per_s", "Inference (rows/s)"],
] as const;

export function useRuns(caseId?: string) {
  return useRead<RunSummary[]>(caseId ? "/cases/" + caseId + "/runs" : undefined);
}

export default function LabPage() {
  const workspace = useWorkspace();
  const { query, dataset, items, setDataset, params } = useCaseDatasets(item => item.kind !== "redteam", true);
  const summaries = useRuns(workspace.caseId);
  const [mechanism, setMechanism] = useState<Mechanism>("E0");
  const [chosen, setChosen] = useState<string[]>();
  const [tab, setTab] = useState("metrics");
  const advanced = workspace.prefs.mode === "advanced";
  const requestedRun = params.get("run");
  const displayedRuns = (summaries.data ?? []).filter(run =>
    advanced || !dataset || run.dataset_id === dataset.id || run.id === requestedRun);
  const autoRuns = displayedRuns.filter(run => run.dataset_id === dataset?.id).slice(0, 2).map(run => run.id);
  const selected = chosen ?? (requestedRun && displayedRuns.some(run => run.id === requestedRun) ? [requestedRun] :
    autoRuns.length ? autoRuns : displayedRuns.slice(0, 1).map(run => run.id));
  const selection = displayedRuns.filter(item => selected.includes(item.id)).sort((a, b) =>
    selected.indexOf(a.id) - selected.indexOf(b.id));
  const detailed = useQueries({
    queries: selection.map(item => ({
      queryKey: ["api", "/runs/" + item.id], queryFn: ({ signal }: { signal: AbortSignal }) =>
        request<Run>("/runs/" + item.id, "GET", undefined, signal),
      enabled: advanced && (tab === "curves" || tab === "reproduce"),
    })),
  });
  const runs = detailed.map(item => item.data).filter((value): value is Run => value !== undefined);
  const effective = dataset?.kind !== "synthetic" && mechanism === "E4" ? "E0" : mechanism;
  useEffect(() => { setChosen(undefined); }, [workspace.caseId, dataset?.id, requestedRun]);
  function toggle(id: string) {
    setChosen(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id].slice(0, 4));
  }
  return <Page title="Privacy–Utility Lab" summary="Run the baseline and a protection method, then compare how well they detect suspicious logins, how much they reveal, and how long they take."
    actions={<Help title="Interpreting lab results">
      <p>Detection metrics use held-out labelled synthetic records. Compare like-for-like datasets, models, features, splits and seeds when attributing differences to privacy mechanisms.</p>
      <p>Opacus ε applies to row-level training under the configured assumptions. Membership separation and linkage findings estimate leakage in the generated fixture under their stated observations.</p>
    </Help>}>
    <ErrorBox error={query.error || summaries.error} />
    <section className="panel lab-config">
      <div className="cluster between lab-context"><DatasetSelect items={items} dataset={dataset} setDataset={setDataset} />
        <div className="cluster">{dataset && <><Origin origin={dataset.origin} /><span>{num(dataset.rows)} records</span>{advanced && <HashText hash={dataset.sha256} />}</>}
          {advanced && workspace.active && <code className="subtle">{workspace.active.id}</code>}</div></div>
      {advanced ? <MechanismStrip value={effective} change={setMechanism} dataset={dataset} /> :
        <div className="panel-pad">
          <Field label="Protection method"><select value={effective} onChange={event => setMechanism(event.target.value as Mechanism)}
            disabled={!dataset}>
            {mechanisms.filter(code => code !== "E4" || dataset?.kind === "synthetic").map(code =>
              <option value={code} key={code}>{code} · {mechanismName[code]}</option>)}
          </select></Field>
          {effective === "E4" && <p className="panel-note">Pair E4 with an E0 Neural Network run to compare private and plain training.</p>}
        </div>}
    </section>
    <div className={advanced ? "lab-grid" : "lab-grid simple-lab"}>
      {dataset ? <RunSetup key={dataset.id} dataset={dataset} mechanism={effective} /> :
        <Panel title="Experiment setup">{query.isLoading ? <Loading /> : <NeedDataset title="Choose an input dataset" />}</Panel>}
      <section className="panel lab-results" aria-label="Experiment results">
        <div className="panel-head"><h2>Evaluation results</h2><span className="cluster">
          <Status tone={selection.length ? "info" : "neutral"}>{num(selection.length)} selected</Status></span></div>
        {advanced ? <Tabbed label="Evaluation result views" value={tab} change={setTab} tabs={[
          { id: "metrics", label: "Metrics", content: summaries.isLoading ? <Loading /> :
            selection.length ? <Metrics runs={selection} /> : <Empty icon="privacy" title="No completed experiments"
              detail={displayedRuns.length ? "Select up to four saved experiments to compare their measured results." :
                "Configure a baseline run in Experiment setup. Results will appear here when the job completes."} /> },
          { id: "curves", label: "Curves", content: detailed.some(item => item.isLoading) ? <Loading /> :
            <CurveViews runs={runs} error={detailed.find(item => item.error)?.error} /> },
          { id: "frontier", label: "Frontier", content: <Frontier runs={selection} /> },
          { id: "overhead", label: "Overhead", content: <div className="panel-pad stack"><Overhead runs={selection} /></div> },
          { id: "reproduce", label: "Reproduce", content: detailed.some(item => item.isLoading) ? <Loading /> :
            <div className="panel-pad stack"><ErrorBox error={detailed.find(item => item.error)?.error} />
              {runs.length ? runs.map(item => <RunManifest key={item.id} run={item} />) :
                <Empty title="No run selected" detail="Select a completed run to inspect or reuse its configuration." />}</div> },
        ]} /> : summaries.isLoading ? <Loading /> : selection.length ? <SimpleResults runs={selection} /> :
          <Empty icon="privacy" title="No completed experiments"
            detail="Run the baseline to see your first result. Then run a protection method on the same dataset." />}
      </section>
      <Panel title="Saved runs" className="saved-runs" actions={<code className="subtle">{num(displayedRuns.length)}</code>}>
        {displayedRuns.length ? <>
          <div className="panel-note smaller">Select up to four runs.</div>
          <div className="run-list">{displayedRuns.map(run =>
            <label className={selected.includes(run.id) ? "run-row selected" : "run-row"} key={run.id}>
              <input type="checkbox" checked={selected.includes(run.id)} disabled={selected.length >= 4 && !selected.includes(run.id)}
                title={selected.length >= 4 && !selected.includes(run.id) ? "Deselect a run to compare another." : undefined} onChange={() => toggle(run.id)} />
              <span><strong>{run.config.mechanism} · {modelName[run.config.model]}</strong>
                {advanced && <code>{run.id}</code>}<small>{utc(run.created_at)}</small></span>
              {run.manifest.origin === "fixture" && <i className="fixture-mark" title="Example fixture" aria-hidden="true" />}
            </label>)}</div>
        </> : <div className="panel-note smaller">Completed runs will build this history.</div>}
        <div className="panel-pad"><Link className="inline-link" to={workspace.url("/reports")}>Evaluation reports<IconChevronRight size={15} /></Link></div>
      </Panel>
    </div>
    <p className="next-link">Next {advanced ? <Link to={workspace.url("/attacks")}>Review privacy leakage measurements</Link> :
      <Link to={workspace.url("/reports")}>Export the case report</Link>}</p>
  </Page>;
}

const utility = [
  ["accuracy", "Accuracy", "max"], ["precision", "Precision", "max"], ["recall", "Recall", "max"],
  ["f1", "F1 score", "max"], ["roc_auc", "ROC-AUC", "max"], ["pr_auc", "PR-AUC (average precision)", "max"],
  ["fpr", "False positive rate", "min"], ["fnr", "False negative rate", "min"],
] as const;
const privacyRows = [
  ["epsilon", "Epsilon (ε)", "min"], ["delta", "Delta (δ)", "min"], ["mia_auc", "Membership ROC-AUC", "near"],
  ["advantage", "Membership advantage", "near"], ["linkage", "Fixture linkage success", "min"],
] as const;

function reading(run: RunSummary, key: string) {
  if (key === "epsilon") return run.results.dp?.epsilon;
  if (key === "delta") return run.results.dp?.delta;
  if (key === "mia_auc") return run.results.membership?.auc;
  if (key === "advantage") return run.results.membership?.advantage;
  if (key === "linkage") return run.results.linkage?.success;
  return run.results.metrics[key];
}

function comparable(runs: RunSummary[]) {
  const first = runs[0];
  if (!first) return true;
  return runs.every(run => run.manifest.dataset_hash === first.manifest.dataset_hash && run.config.seed === first.config.seed &&
    run.config.max_rows === first.config.max_rows && run.config.split === first.config.split);
}

const simpleMetrics = [
  ["accuracy", "Accuracy", pct],
  ["f1", "F1 score", metric],
  ["linkage", "Account linkage", pct],
  ["advantage", "Membership advantage", metric],
  ["epsilon", "Training epsilon", metric],
  ["training_s", "Training time", sec],
  ["inference_s", "Prediction time", sec],
] as const;

function simpleValue(run: RunSummary, key: string) {
  return key === "training_s" || key === "inference_s" ? run.results.performance[key] : reading(run, key);
}

function modelFamily(run: RunSummary) {
  return run.config.model === "dp_neural" ? "neural" : run.config.model;
}

function SimpleResults({ runs }: { runs: RunSummary[] }) {
  const matched = comparable(runs) && runs.every(run => modelFamily(run) === modelFamily(runs[0]));
  const rows = simpleMetrics.filter(([key]) => runs.some(run => simpleValue(run, key) != null));
  function download() {
    exportCsv("privforensics-results.csv", ["Metric", ...runs.map(run => run.id)],
      rows.map(([key, label]) => [label, ...runs.map(run => simpleValue(run, key) ?? null)]));
  }
  return <div className="lab-metrics">
    <div className="metric-caption cluster between"><span>Measured comparison</span>
      <button className="button tiny" type="button" onClick={download}>Download CSV</button></div>
    {!matched && <p className="panel-note">This selection changes more than protection. Use matching datasets, splits and model families to isolate its effect.</p>}
    <div className="table-wrap">
      <table className="metric-table" aria-label="Experiment metrics comparison">
        <thead><tr><th scope="col">Measurement</th>{runs.map(run => <th scope="col" key={run.id}>
          <strong>{run.config.mechanism} · {mechanismName[run.config.mechanism]}</strong>
          <small>{modelName[run.config.model]} · {num(run.results.counts.holdout)} tested</small>
        </th>)}</tr></thead>
        <tbody>{rows.map(([key, label, format]) => <tr key={key}><th scope="row">{label}</th>
          {runs.map(run => {
            const value = simpleValue(run, key);
            return <td key={run.id}><span className="mono">{value == null ? "—" : format(value)}</span></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <details className="panel-pad">
      <summary>What do these results mean?</summary>
      <ul className="simple-metric-notes">
        <li>F1 balances finding suspicious logins and avoiding false flags.</li>
        <li>Account linkage measures how often the original directory can identify a record in the generated example.</li>
        <li>Membership advantage near zero means this confidence test found little separation between training and held-back records.</li>
        <li>Opacus reports epsilon for the configured training steps.</li>
      </ul>
    </details>
  </div>;
}

function Metrics({ runs }: { runs: RunSummary[] }) {
  const { prefs } = useWorkspace();
  const comparison = comparable(runs);
  const dpSettings = new Set(runs.flatMap(run => run.results.dp ? [run.results.dp.delta + "/" + run.results.dp.accountant] : []));
  const baseline = runs.find(run => run.config.mechanism === "E0");
  const list = [...utility, ...privacyRows];
  function exportTable() {
    exportCsv("privforensics-metrics.csv", ["Metric", ...runs.map(run => run.id)],
      list.map(([key, name]) => [name, ...runs.map(run => reading(run, key) ?? null)]));
  }
  return <div className="lab-metrics">
    <div className="metric-caption cluster between"><span>Held-out detection and privacy measurements</span>
      <button className="button tiny" type="button" onClick={exportTable}>Download CSV</button></div>
    {!comparison && <div className="alert notice">Selected runs differ in dataset, seed, row scope or split. Review provenance before comparing differences.</div>}
    <div className="table-wrap">
      <table className="metric-table" aria-label="Experiment metrics comparison">
        <thead><tr><th scope="col">Metric</th>{runs.map(run => <th scope="col" key={run.id}>
          <strong>{run.config.mechanism} · {mechanismName[run.config.mechanism]}</strong><code>{run.id}</code>
          <small>Holdout n = {num(run.results.counts.holdout)}</small></th>)}</tr></thead>
        <tbody>{list.map(([key, name, direction], index) => {
          const values = runs.map(run => reading(run, key));
          const ranked = values.map(value => value == null ? undefined : direction === "near" ?
            Math.abs(value - (key === "mia_auc" ? 0.5 : 0)) : direction === "max" ? -value : value);
          const available = ranked.filter((value): value is number => value !== undefined);
          const best = comparison && available.length > 1 && (!(key === "epsilon" || key === "delta") || dpSettings.size === 1) ? Math.min(...available) : undefined;
          return <tr key={key} className={index === utility.length ? "section-break" : ""}><th scope="row">{name}</th>
            {runs.map((run, i) => {
              const value = values[i];
              const base = baseline && reading(baseline, key);
              const delta = comparison && baseline?.id !== run.id && value != null && base != null && index < utility.length && prefs.mode === "advanced" ? value - base : undefined;
              return <td key={run.id} className={best !== undefined && ranked[i] === best ? "best-metric" : ""}>
                <span className="mono">{key === "delta" && value != null ? value.toExponential(1) : metric(value)}</span>
                {delta !== undefined && <small className="muted"> {delta >= 0 ? "+" : ""}{delta.toFixed(3)}</small>}
              </td>;
            })}</tr>;
        })}</tbody>
      </table>
    </div>
    <p className="chart-caption">{runs.some(run => run.results.dp) ?
      "ε is shown with δ. Each reported budget comes from Opacus RDP and applies to row-level training." :
      "ε and δ are available for DP-SGD runs. Membership metrics use the generated fixture."}</p>
    {runs.some(run => run.results.linkage) && <p className="chart-caption">Linkage uses the generated identifier-only release comparison, outside training.</p>}
    {runs.some(run => run.results.confusion) && <div className="confusion-grid panel-pad">{runs.map(run => run.results.confusion && <Confusion run={run} key={run.id} />)}</div>}
    {prefs.mode === "simple" && baseline && baseline.results.metrics.f1 != null && <p className="panel-note">
      The selected baseline scored {metric(baseline.results.metrics.f1)} F1 on {num(baseline.results.counts.holdout)} held-out records.</p>}
  </div>;
}

function Confusion({ run }: { run: RunSummary }) {
  const [tn, fp, fn, tp] = run.results.confusion!;
  return <div className="confusion">
    <h3>{run.config.mechanism} · Confusion matrix</h3>
    <table aria-label={run.id + " confusion matrix"}><thead><tr><th scope="col">Actual</th><th scope="col">Pred. normal</th><th scope="col">Pred. suspicious</th></tr></thead>
      <tbody><tr><th scope="row">Normal</th><td className="correct">{num(tn)}</td><td>{num(fp)}</td></tr>
        <tr><th scope="row">Suspicious</th><td>{num(fn)}</td><td className="correct">{num(tp)}</td></tr></tbody></table>
  </div>;
}

function CurveViews({ runs, error }: { runs: Run[]; error?: Error | null }) {
  const labelled = runs.filter(run => run.results.roc.length);
  return <div className="panel-pad stack"><ErrorBox error={error} />
    {!labelled.length ? <Empty title="No labelled curves selected" detail="Choose a completed run evaluated against synthetic labels." /> :
      <Suspense fallback={<Loading label="Preparing evaluation curves…" />}>
        <Curve title="Receiver operating characteristic" x="False positive rate" y="True positive rate" runs={labelled} kind="roc" chance />
        <Curve title="Precision–recall" x="Recall" y="Precision" runs={labelled} kind="pr" />
      </Suspense>}
  </div>;
}

function shortRun(run: RunSummary) { return run.config.mechanism + " · " + run.id.slice(-5); }

function runScope(runs: RunSummary[]) {
  return runs.map(item => shortRun(item) + " n=" + num(item.results.counts.holdout) + ", seed " + item.config.seed +
    ", " + item.manifest.dataset_hash.slice(0, 7)).join(" · ");
}

export function Curve({ title, x, y, runs, kind, chance, description }: { title: string; x: string; y: string;
  runs: Run[]; kind: "roc" | "pr" | "membership"; chance?: boolean; description?: string }) {
  const points = runs.map(run => kind === "membership" ? run.results.membership?.roc ?? [] : run.results[kind]);
  const options = {
    grid: { left: 61, right: 22, top: 45, bottom: 52, outerBoundsMode: "none" },
    xAxis: { type: "value", min: 0, max: 1, name: x }, yAxis: { type: "value", min: 0, max: 1, name: y },
    legend: { top: 6, type: "scroll" },
    series: [
      ...runs.map((run, index) => ({ name: shortRun(run), type: "line", showSymbol: false, data: points[index],
        lineStyle: { width: 1.65, type: index % 2 ? "dashed" : "solid" } })),
      ...(chance ? [{ name: "Chance", type: "line", data: [[0, 0], [1, 1]], showSymbol: false, silent: true,
        lineStyle: { color: "#8b97a5", width: 1, type: "dotted" } }] : []),
    ],
  };
  return <Chart title={title} options={options} description={description ?? runScope(runs)} headings={["Run", x, y]}
    rows={runs.flatMap((run, index) => points[index].map(([a, b]) => [run.id, a, b]))} />;
}

function Frontier({ runs }: { runs: RunSummary[] }) {
  const points = runs.flatMap(run => run.results.metrics.f1 != null && run.results.membership ?
    [{ run, x: Math.abs(run.results.membership.advantage), y: run.results.metrics.f1 }] : []);
  const dp = runs.flatMap(run => run.results.dp && run.results.metrics.f1 != null ?
    [{ run, x: run.results.dp.epsilon, y: run.results.metrics.f1 }] : []);
  const matched = comparable(points.map(point => point.run));
  const sorted = [...points].sort((a, b) => a.x - b.x || b.y - a.y);
  let best = -1;
  const pareto = sorted.filter(point => { if (point.y <= best) return false; best = point.y; return true; });
  const common = (name: string) => ({
    grid: { left: 53, right: 25, top: 33, bottom: 47, outerBoundsMode: "none" },
    xAxis: { type: "value", name, scale: true }, yAxis: { type: "value", name: "Held-out F1", min: 0, max: 1 },
  });
  const plot = (samples: typeof points) => samples.map(point => ({
    name: shortRun(point.run), type: "scatter", symbolSize: 12, symbol: point.run.config.mechanism === "E4" ? "diamond" : "circle",
    data: [[point.x, point.y]], tooltip: { formatter: () => point.run.id + " · F1 " + metric(point.y) +
      " · x " + metric(point.x) + " · " + point.run.manifest.config_hash.slice(0, 8) },
  }));
  return <div className="panel-pad stack"><Suspense fallback={<Loading label="Preparing privacy frontier…" />}>
    {points.length ? <Chart title="Measured privacy–utility frontier"
      description={(matched && points.length >= 2 ? "The line joins non-dominated measured runs. " : "A comparable frontier line needs two measured runs. ") + runScope(points.map(point => point.run))}
      options={{ ...common("|Membership advantage|"), series: [...plot(points),
        ...(matched && pareto.length > 1 ? [{ name: "Pareto frontier", type: "line", data: pareto.map(point => [point.x, point.y]),
          showSymbol: false, lineStyle: { type: "dashed", width: 1.5, color: chartColors[1] } }] : [])] }}
      headings={["Run", "Absolute membership advantage", "F1", "Config hash"]} rows={points.map(point =>
        [point.run.id, point.x, point.y, point.run.manifest.config_hash])} /> :
      <Empty title="No privacy–utility points selected" detail="Select runs with both held-out F1 and an aggregate fixture membership result." icon="privacy" />}
    {dp.length ? <Chart title="F1 versus epsilon" description={dp.map(point =>
      shortRun(point.run) + " · δ " + point.run.results.dp!.delta.toExponential(1) + " · " + point.run.results.dp!.accountant).join(" / ") +
      " · " + runScope(dp.map(point => point.run))}
      options={{ ...common("Training epsilon (ε)"), series: [...plot(dp),
        ...(dp.length > 1 && comparable(dp.map(point => point.run)) &&
          new Set(dp.map(point => point.run.results.dp!.delta + point.run.results.dp!.accountant)).size === 1 ?
          [{ name: "Comparable DP runs", type: "line", showSymbol: false,
            data: [...dp].sort((a, b) => a.x - b.x).map(point => [point.x, point.y]), lineStyle: { width: 1.5 } }] : [])] }}
      headings={["Run", "Epsilon", "Delta", "F1"]} rows={dp.map(point => [point.run.id, point.x, point.run.results.dp!.delta, point.y])} /> :
      <p className="panel-note">Run E4 to plot measured ε and held-out F1.</p>}
  </Suspense></div>;
}

export function Overhead({ runs }: { runs: RunSummary[] }) {
  const [field, setField] = useState<(typeof performanceFields)[number][0]>("training_s");
  const label = performanceFields.find(item => item[0] === field)?.[1] ?? field;
  const options = useMemo(() => ({
    xAxis: { type: "category", data: runs.map(shortRun), name: "Run" }, yAxis: { type: "value", name: label, nameGap: 42 },
    series: [{ name: label, type: "bar", data: runs.map(run => run.results.performance[field] ?? null), barMaxWidth: 51 }],
  }), [runs, label, field]);
  return runs.length ? <>
    <div className="cluster between"><h3>Measured model resources</h3>
      <label className="cluster"><span className="muted">Chart metric</span><select aria-label="Chart metric" className="fit-select" value={field}
        onChange={event => setField(event.target.value as typeof field)}>
        {performanceFields.map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select></label></div>
    <Suspense fallback={<Loading label="Preparing overhead chart…" />}><Chart title={label + " by run"} height={231} options={options}
      description={runScope(runs)} headings={["Run", label]} rows={runs.map(run => [run.id, run.results.performance[field] ?? null])} /></Suspense>
    <DataTable label="Measured experiment overhead" data={runs} columns={[
      { accessorKey: "id", header: "Run", cell: info => <code>{info.getValue()}</code> },
      ...performanceFields.map(([key, title]) => ({ accessorFn: (run: RunSummary) => run.results.performance[key],
        header: title, cell: ({ getValue }: { getValue: () => number }) => <code>{metric(getValue(), 2)}</code> })),
    ]} />
    <p className="muted">RSS and CPU measure the process. CPU uses one logical core as its 100% reference.</p>
  </> : <Empty title="No measured overhead" detail="Select a completed experiment to view its measured runtime and resource use." />;
}

function RunManifest({ run }: { run: Run }) {
  const workspace = useWorkspace();
  const rerun = useAction(() => request<Job>("/runs/" + run.id + "/rerun", "POST"), workspace.track);
  const [copied, setCopied] = useState(false);
  return <section className="inset stack manifest">
    <div className="cluster between"><h3>Run manifest</h3><Origin origin={run.manifest.origin} /></div>
    <KeyValues items={[["Run", <code>{run.id}</code>], ["Configuration", run.config.mechanism + " · " + modelName[run.config.model]],
      ["Config digest", <HashText hash={run.manifest.config_hash} label="Copy configuration hash" />],
      ["Dataset version", <HashText hash={run.manifest.dataset_hash} label="Copy dataset version" />],
      ["Input SHA-256", <HashText hash={run.manifest.source_sha256} label="Copy input hash" />],
      ["Feature / model version", run.manifest.feature_version + " / " + run.manifest.model_version],
      ["Split", run.manifest.split.description], ["Seed", run.config.seed], ["Completed (UTC)", utc(run.created_at)],
      ...(run.manifest.key_version ? [["HMAC key version", run.manifest.key_version] as [string, string]] : []),
      ...(run.results.dp ? [["Accountant", run.results.dp.accountant], ["Privacy budget", "ε " + metric(run.results.dp.epsilon) +
        " · δ " + run.results.dp.delta.toExponential(1)], ["Noise / clip / sampling rate", metric(run.results.dp.noise) + " / " +
        metric(run.results.dp.clip) + " / " + pct(run.results.dp.sampling_rate)], ["Optimizer steps", num(run.results.dp.steps)]] as [string, string][] : []),
    ]} />
    {run.results.dp && <p className="muted">Training uses independent random noise and a research-mode generator. A rerun reproduces settings and can produce different metrics.</p>}
    <details><summary>Configuration and runtime versions</summary>
      <pre>{JSON.stringify({ config: run.config, environment: run.manifest.environment }, null, 2)}</pre></details>
    <ErrorBox error={rerun.error} />
    <div className="cluster"><button className="button primary" type="button" disabled={rerun.isPending} onClick={() => rerun.mutate()}><IconRefresh size={16} />Rerun configuration</button>
      <button className="button" type="button" onClick={async () => {
        await navigator.clipboard.writeText(JSON.stringify({ config: run.config, manifest: run.manifest }, null, 2)); setCopied(true);
      }}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}{copied ? "Manifest copied" : "Copy manifest"}</button></div>
  </section>;
}
