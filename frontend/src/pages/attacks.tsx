import { IconBinary, IconFingerprint } from "@tabler/icons-react";
import { useQueries } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { request, useAction } from "../api";
import { DataTable, Empty, ErrorBox, HashText, Help, Loading, Page, Panel, Status, Tabbed } from "../components";
import { fieldName, mechanismName, metric, num, pct } from "../format";
import type { Dataset, Linkability, Run, RunSummary } from "../types";
import { useWorkspace } from "../workspace";
import { DatasetSelect, NeedDataset, useCaseDatasets } from "./explorer";
import { Curve, useRuns } from "./lab";

export default function AttacksPage() {
  const workspace = useWorkspace();
  const summary = useRuns(workspace.caseId);
  const available = summary.data?.filter(run => run.results.membership) ?? [];
  const { dataset, items, setDataset, query } = useCaseDatasets(item => item.kind === "synthetic" && item.origin === "fixture");
  return <Page title="Attack simulation" summary="Measure aggregate training membership and record linkage in the generated experiment fixture."
    actions={<Help title="Scope and limitations"><p>These diagnostic experiments use the built-in generated data and aggregate scores from locally trained models.</p>
      <p>Results depend on the data split, available synthetic attributes and model outputs used. Privacy accounting provides a distinct training guarantee under its assumptions.</p></Help>}>
    <ErrorBox error={summary.error || query.error} />
    <section className="panel">
      <Tabbed label="Privacy leakage experiments" tabs={[
        { id: "membership", label: "Membership inference", content: <Membership available={available} loading={summary.isLoading} /> },
        { id: "linkage", label: "Re-identification", content: dataset ? <Linkage dataset={dataset} key={dataset.id} selector={
          <DatasetSelect items={items} dataset={dataset} setDataset={setDataset} />} /> :
          query.isLoading ? <Loading /> : <NeedDataset title="Generated fixture required"
            detail="Load the example case to measure aggregate linkage against fictional accounts." /> },
      ]} />
    </section>
    <p className="next-link">Next <Link to={workspace.url("/performance")}>Compare computational overhead</Link></p>
  </Page>;
}

function Membership({ available, loading }: { available: RunSummary[]; loading: boolean }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const primary = available.find(item => item.id === first) ?? available[0];
  const compare = second === "off" ? undefined : available.find(item => item.id === second && item.id !== primary?.id) ??
    available.find(item => item.id !== primary?.id && item.config.mechanism === "E0");
  const selection = [primary, compare].filter((item): item is RunSummary => Boolean(item));
  const details = useQueries({ queries: selection.map(run => ({
    queryKey: ["api", "/runs/" + run.id], queryFn: ({ signal }: { signal: AbortSignal }) =>
      request<Run>("/runs/" + run.id, "GET", undefined, signal),
  })) });
  const runs = details.map(item => item.data).filter((run): run is Run => !!run);
  return <div className="stack panel-pad">
    <details className="inset assumptions" open><summary><IconBinary size={17} />Experiment assumptions</summary>
      <p>The diagnostic observes the confidence assigned to the known class. Members are drawn from training and nonmembers from a separate privacy holdout.
        Counts are matched by class. Calibration selects a boundary on one set of records, and a separate set measures accuracy and advantage.</p></details>
    {loading ? <Loading /> : !available.length ?
      <Empty title="No membership measurements" detail="Run a supervised experiment on the built-in authentication fixture to measure aggregate separation." /> : <>
        <div className="form-pair">
          <label className="field"><span>Target run</span><select value={primary?.id ?? ""} onChange={event => setFirst(event.target.value)}>
            {available.map(item => <option value={item.id} key={item.id}>{item.config.mechanism} · {mechanismName[item.config.mechanism]} · {item.id}</option>)}
          </select></label>
          <label className="field"><span>Comparison run</span><select value={compare?.id ?? "off"} onChange={event => setSecond(event.target.value)}>
            <option value="off">Single run</option>{available.filter(item => item.id !== primary?.id).map(item =>
              <option value={item.id} key={item.id}>{item.config.mechanism} · {mechanismName[item.config.mechanism]} · {item.id}</option>)}
          </select></label>
        </div>
        <Panel title="Aggregate membership separation" actions={<Status tone="fixture">Example fixture</Status>}>
          <DataTable data={selection} label="Membership experiment measures" columns={[
            { accessorKey: "id", header: "Run", cell: info => <code>{info.getValue()}</code> },
            { accessorFn: run => run.results.membership!.accuracy, header: "Accuracy", cell: info => <code>{pct(info.getValue())}</code> },
            { accessorFn: run => run.results.membership!.auc, header: "ROC-AUC", cell: info => <code>{metric(info.getValue())}</code> },
            { accessorFn: run => run.results.membership!.advantage, header: "Advantage", cell: info => <code>{metric(info.getValue())}</code> },
            { accessorFn: run => run.results.membership!.members, header: "Members", cell: info => <code>{num(info.getValue())}</code> },
            { accessorFn: run => run.results.membership!.nonmembers, header: "Nonmembers", cell: info => <code>{num(info.getValue())}</code> },
            { accessorFn: run => run.results.membership!.calibration_members + run.results.membership!.calibration_nonmembers,
              header: "Calibration n", cell: info => <code>{num(info.getValue())}</code> },
          ]} />
        </Panel>
        <ErrorBox error={details.find(item => item.error)?.error} />
        {details.some(item => item.isLoading) ? <Loading /> : !!runs.length &&
          <Suspense fallback={<Loading label="Preparing membership ROC…" />}>
            <Curve title="Membership separation ROC" x="False positive rate" y="True positive rate" runs={runs} kind="membership" chance
              description={runs.map(run => run.id + " · " + num((run.results.membership?.members ?? 0) +
                (run.results.membership?.nonmembers ?? 0)) + " evaluated rows · seed " + run.config.seed +
                " · " + run.manifest.dataset_hash.slice(0, 8)).join(" / ")} />
          </Suspense>}
        <p className="muted">The observed advantage is true positive rate minus false positive rate at the calibrated boundary. Chance ROC-AUC is 0.5.</p>
      </>}
  </div>;
}

function Linkage({ dataset, selector }: { dataset: Dataset; selector: React.ReactNode }) {
  const [fields, setFields] = useState<string[]>([]);
  const run = useAction(() => request<Linkability>("/datasets/" + dataset.id + "/linkage", "POST", { fields }));
  return <div className="stack panel-pad">
    <details className="inset assumptions" open><summary><IconFingerprint size={17} />Auxiliary data assumptions</summary>
      <p>The auxiliary slice contains synthetic public identifiers with the selected context fields. The released slice uses one of three identifier policies.
        The HMAC comparison assumes no shared secret or token crosswalk. Reported counts summarize the generated records.</p></details>
    <div className="filters linkage-filters">
      {selector}<div className="cluster">{["location", "device_type", "access"].map(field => <label className="check-row" key={field}>
        <input type="checkbox" checked={fields.includes(field)} onChange={event => setFields(values =>
          event.target.checked ? [...values, field] : values.filter(value => value !== field))} />{fieldName(field)}</label>)}</div>
      <button className="button primary" type="button" disabled={run.isPending} onClick={() => run.mutate()}>
        {run.isPending ? "Measuring…" : "Run linkage benchmark"}</button>
    </div>
    <ErrorBox error={run.error} />
    {run.data ? <Panel title="Synthetic linkage results" actions={<><Status tone="fixture">Example fixture</Status><HashText hash={run.data.dataset_hash} /></>}>
      <p className="panel-note">{num(run.data.n)} release rows · {num(run.data.auxiliary_n)} auxiliary rows · {
        run.data.fields.length ? run.data.fields.map(fieldName).join(", ") : "Public identifier only"}</p>
      <DataTable data={run.data.results} label="Original, masked and pseudonymized linkage" columns={[
        { accessorKey: "mechanism", header: "Released view" },
        { accessorKey: "success", header: "Unique correct matches", cell: info => <code>{pct(info.getValue())}</code> },
        { accessorKey: "linkability", header: "Repeated equivalence-class membership", cell: info => <code>{pct(info.getValue())}</code> },
        { accessorKey: "matches", header: "Correct / evaluated", cell: info => <code>{num(info.getValue())} / {num(info.row.original.possible)}</code> },
        { id: "other", header: "Ambiguous or unmatched", cell: info => <code>{num(info.row.original.possible - info.row.original.matches)}</code> },
      ]} />
      <p className="panel-note">Repeated HMAC tokens can link rows inside the release even when the public directory cannot resolve them.</p>
    </Panel> : <Empty title="Run an aggregate linkage measurement" detail="Select the observed synthetic attributes, then start the benchmark." />}
  </div>;
}
