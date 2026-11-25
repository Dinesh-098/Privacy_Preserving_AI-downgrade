import { IconArrowRight, IconCheck, IconDownload, IconKey, IconShieldCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { downloadPost, request, useAction, useRead } from "../api";
import { Confirm, DataTable, Empty, ErrorBox, Field, Help, KeyValues, Loading, Origin, Page, Panel, SourceChip, Status } from "../components";
import { sensitiveFields } from "../design/tokens";
import { fieldName, num, utc } from "../format";
import type { Dataset, KeyStatus, Policy, Preview, PrivacyProfile } from "../types";
import { useWorkspace } from "../workspace";
import { DatasetSelect, NeedDataset, useCaseDatasets } from "./explorer";

export function PrivacyAnalysis() {
  const { query, dataset, items, setDataset } = useCaseDatasets();
  const profile = useRead<PrivacyProfile>(dataset ? "/datasets/" + dataset.id + "/privacy" : undefined);
  const workspace = useWorkspace();
  return <Page title="Privacy analysis" summary="See which fields can reveal an identity, then choose how to protect them." actions={
    <Help title="How the privacy profile is scored"><p>Each triggered rule contributes one point. The total describes which conditions appear in the sample.</p>
      <p>Structured fields and validated text patterns find identifiers. LANL identifiers are de-identified by the source. Repeated values can still link activity across sources.</p></Help>}>
    <ErrorBox error={query.error || profile.error} />
    {!dataset ? query.isLoading ? <Loading /> : <Panel title="Privacy profile"><NeedDataset /></Panel> : <>
      <div className="panel filters between"><DatasetSelect items={items} dataset={dataset} setDataset={setDataset} /><div className="cluster">
        <Origin origin={dataset.origin} /><Status tone="fixture">Heuristic assessment</Status>
        <span className="mono muted">{num(profile.data?.sample_rows)} sampled records</span></div></div>
      {profile.isLoading ? <Loading /> : profile.data && <>
        <div className="privacy-grid">
          <Panel title="Sensitive-field inventory" actions={<span className="mono muted">{num(profile.data.inventory.length)} fields</span>}>
            {profile.data.inventory.length ? <DataTable data={profile.data.inventory} label="Sensitive-field detectors" columns={[
              { accessorKey: "field", header: "Field", cell: info => <strong>{fieldName(info.getValue())}</strong> },
              { accessorKey: "types", header: "Detected type", cell: info => (info.getValue() as string[]).join(", ") },
              { accessorKey: "detector", header: "Detector" },
              { accessorKey: "count", header: "Events", cell: info => <code>{num(info.getValue())}</code> },
              { accessorKey: "risk", header: "Risk", cell: info => <Status tone={info.getValue() === "high" ? "danger" : "warning"}>{info.getValue()}</Status> },
              { id: "sample", header: "Redacted value", cell: info => <span className="cluster"><code>{info.row.original.samples[0]?.value}</code>
                {info.row.original.samples[0] && <SourceChip source={info.row.original.samples[0].source} />}</span> },
            ]} /> : <Empty title="No sensitive fields detected" detail="The configured detectors found no supported identifiers in this sampled range." icon="privacy" />}
            <p className="panel-note">{profile.data.scope}</p>
          </Panel>
          <Panel title="Privacy risk rules" actions={<Status tone="fixture">{profile.data.score} of 7 triggered</Status>}>
            <div className="rule-list">{profile.data.rules.map(item =>
              <details key={item.name} className="rule-row">
                <summary><span>{item.name}</span><Status tone={item.triggered ? "warning" : "neutral"}>{item.triggered ? "Triggered" : "Clear"}</Status></summary>
                <p>{item.rule}</p>
              </details>)}</div>
          </Panel>
        </div>
        <div className="alert notice"><IconShieldCheck size={19} /><span>Detectors use patterns and field structure. Review the sampling scope before extending findings to the wider source.</span></div>
      </>}
    </>}
    <p className="next-link">Next <Link to={workspace.url("/protection", dataset ? { dataset: dataset.id } : {})}>Configure privacy protection</Link></p>
  </Page>;
}

export function PrivacyProtection() {
  const { query, dataset, items, setDataset } = useCaseDatasets();
  const workspace = useWorkspace();
  return <Page title="Privacy protection" summary="Mask or replace sensitive values and preview the result before sharing the CSV."
    actions={<Help title="Protection and linkage">
      <p>Masking replaces portions of a value. HMAC makes a consistent token for the same value, domain, scope and key version.</p>
      <p>Combining remaining fields can still identify patterns. Review the fields and linkage scope before exporting. DP-SGD is configured in the evaluation lab.</p>
    </Help>}>
    <ErrorBox error={query.error} />
    {!dataset ? query.isLoading ? <Loading /> : <Panel title="Protection policy"><NeedDataset /></Panel> : <>
      <div className="panel filters between"><DatasetSelect items={items} dataset={dataset} setDataset={setDataset} /><Origin origin={dataset.origin} /></div>
      <ProtectionWorkspace dataset={dataset} key={dataset.id} />
    </>}
    <p className="next-link">Next <Link to={workspace.url("/analysis", dataset ? { dataset: dataset.id } : {})}>Flag suspicious logins</Link>
      {" · "}<Link to={workspace.url("/lab", dataset ? { dataset: dataset.id } : {})}>Evaluate privacy and utility</Link></p>
  </Page>;
}

export function KeyPanel() {
  const workspace = useWorkspace();
  const key = useRead<KeyStatus>("/keys");
  const [rotate, setRotate] = useState(false);
  const create = useAction((value: boolean) => request<KeyStatus>("/keys", "POST", { rotate: value, confirm: value }), () =>
    workspace.notice(key.data?.configured ? "Pseudonym key rotated." : "Pseudonym key generated."));
  return <div className="stack panel-pad">
    <ErrorBox error={key.error || create.error} />
    <KeyValues items={[["Status", <Status tone={key.data?.configured ? "success" : "neutral"}>{key.data?.configured ? "Configured" : "Not configured"}</Status>],
      ["Version", <code>{key.data?.version ?? "—"}</code>], ["Created (UTC)", utc(key.data?.created_at)]]} />
    <button className="button" type="button" disabled={create.isPending || key.isLoading}
      onClick={() => key.data?.configured ? setRotate(true) : create.mutate(false)}><IconKey size={16} />
      {key.data?.configured ? "Rotate key" : "Generate key"}</button>
    {rotate && <Confirm title="Rotate pseudonym key" detail="New previews and exports will use the new key. Existing exports retain their original tokens, and saved experiments can still reference their stored key version."
      action="Rotate key" close={() => setRotate(false)} confirm={() => create.mutate(true)} />}
  </div>;
}

const ruleNames = { keep: "Keep", mask: "Mask", hmac: "HMAC pseudonym", drop: "Drop" };

function ProtectionWorkspace({ dataset }: { dataset: Dataset }) {
  const workspace = useWorkspace();
  const path = "/datasets/" + dataset.id + "/policy";
  const saved = useRead<Policy>(path);
  const key = useRead<KeyStatus>("/keys");
  const [rules, setRules] = useState<Policy["rules"]>();
  const [scope, setScope] = useState<Policy["scope"]>();
  const [field, setField] = useState(dataset.meta.fields.find(item => sensitiveFields.has(item)) ?? dataset.meta.fields[0]);
  const [confirm, setConfirm] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [count, setCount] = useState(Math.max(1, Math.min(10_000, dataset.rows)));
  const policy = { rules: rules ?? saved.data?.rules ?? {}, scope: scope ?? saved.data?.scope ?? "case" };
  const actions = Object.values(policy.rules);
  const unprotected = dataset.meta.fields.filter(item => sensitiveFields.has(item) && policy.rules[item] === "keep");
  const needsKey = actions.includes("hmac") && !key.data?.configured;
  const preview = useAction(() => request<Preview>(path + "/preview", "POST", { ...policy, count: workspace.prefs.preview }));
  const save = useAction(() => request<Policy>(path, "PUT", policy), () => workspace.notice("Protection policy saved."));
  const download = useAction(() => downloadPost(path + "/export", { ...policy, confirm: true, count }, dataset.id + "-protected.csv"),
    () => workspace.notice("Protected dataset downloaded."));
  const options = workspace.prefs.mode === "advanced" || advanced ? dataset.meta.fields : dataset.meta.fields.filter(item => sensitiveFields.has(item));
  const displayed = preview.data?.rows[0];
  const activeRule = preview.data?.rules[field];
  useEffect(() => {
    if (saved.data && !preview.data && !preview.isPending && !preview.isError && !needsKey) preview.mutate();
  }, [saved.data, needsKey]);
  return <>
    <ErrorBox error={saved.error || key.error || preview.error || save.error || download.error} />
    <div className="protection-grid">
      <Panel title="Policy builder" actions={saved.data?.updated_at && <Status tone="success">Saved policy</Status>}>
        {saved.isLoading ? <Loading /> : <div className="stack panel-pad">
          <Field label="Identifier scope" hint="Scope controls where equal HMAC tokens can be linked.">
            <select value={policy.scope} onChange={event => setScope(event.target.value as Policy["scope"])}>
              <option value="dataset">This dataset</option><option value="case">This investigation</option><option value="workspace">Entire local workspace</option>
            </select></Field>
          {!options.length && <p className="muted">This schema has no structured sensitive fields.</p>}
          <div className="policy-rows">{options.map(item => <label className="policy-row" key={item}>
            <span>{fieldName(item)}</span><select aria-label={fieldName(item)} value={policy.rules[item] ?? "keep"} onChange={event =>
              setRules({ ...policy.rules, [item]: event.target.value as Policy["rules"][string] })}>
              {Object.entries(ruleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>)}</div>
          {workspace.prefs.mode === "simple" && <button className="text-button" type="button" aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}>{advanced ? "Show sensitive fields" : "Show all fields"}</button>}
          {needsKey && <p className="alert notice">Generate a key before applying an HMAC rule.</p>}
          <div className="cluster">
            <button className="button primary" type="button" disabled={save.isPending || !!needsKey} onClick={() => save.mutate()}><IconCheck size={16} />Save policy</button>
            <button className="button" type="button" disabled={preview.isPending || !!needsKey} onClick={() => preview.mutate()}>Preview protection</button>
          </div>
        </div>}
      </Panel>
      <Panel title="Safe preview" actions={displayed && <SourceChip source={displayed.source} />}>
        <div className="stack panel-pad">
          <Field label="Preview field"><select value={field} onChange={event => setField(event.target.value)}>
            {dataset.meta.fields.map(item => <option value={item} key={item}>{fieldName(item)}</option>)}</select></Field>
          {preview.isPending ? <Loading label="Applying selected rules…" /> : displayed ?
            <div className="transform" key={preview.submittedAt + field}>
              <div><span>Source preview</span><code>{displayed.before[field] ?? "—"}</code><small>Redacted</small></div>
              <IconArrowRight size={20} aria-hidden="true" />
              <div><span>Export preview</span><code className={activeRule && activeRule !== "keep" ? "text-teal" : ""}>
                {activeRule === "drop" ? "Field omitted" : displayed.after[field] ?? "—"}</code>
                <small>{ruleNames[activeRule ?? "keep"]}</small></div>
            </div> : <Empty title="Preview a field transformation" detail="Run the selected rules on a small redacted sample." icon="privacy" />}
          {preview.data?.rows.length ? <DataTable data={preview.data.rows} label="Redacted before and after sample" columns={[
            { id: "source", header: "Source", cell: info => <SourceChip source={info.row.original.source} /> },
            { accessorFn: row => row.before[field], header: "Before", cell: info => <code>{info.getValue() ?? "—"}</code> },
            { accessorFn: row => row.after[field], header: "After", cell: info => <code>{activeRule === "drop" ? "Omitted" : info.getValue() ?? "—"}</code> },
          ]} /> : null}
          <p className="muted">Source previews redact identifiers. HMAC tokens are shortened in this view.</p>
        </div>
      </Panel>
      <div className="stack">
        <Panel title="Policy impact">
          <div className="panel-pad stack">
            <KeyValues items={[["Masked", num(actions.filter(item => item === "mask").length)], ["Pseudonymized", num(actions.filter(item => item === "hmac").length)],
              ["Dropped", num(actions.filter(item => item === "drop").length)], ["Detected categories kept", num(unprotected.length)]]} />
            <p className="muted">Consistent tokens preserve links within the selected scope. Other attributes may also support linkage.</p>
            <Field label="Maximum rows to export"><input type="number" min={1} max={100_000} value={count} onChange={event => setCount(+event.target.value)} /></Field>
            <button className="button" type="button" disabled={download.isPending || !!needsKey || count < 1 || count > 100_000 || !dataset.rows || !saved.data}
              onClick={() => setConfirm(true)}><IconDownload size={16} />Export protected CSV</button>
          </div>
        </Panel>
        <Panel title="HMAC key"><KeyPanel /></Panel>
      </div>
    </div>
    {confirm && <Confirm title="Export protected data" detail={"Export up to " + num(count) + " rows with the displayed rules. " +
      (unprotected.length ? "These identifiers will be retained as configured: " + unprotected.map(fieldName).join(", ") + ". " : "") +
      "The output may preserve identifying relationships."} action="Export CSV" close={() => setConfirm(false)} confirm={() => download.mutate()} />}
  </>;
}
