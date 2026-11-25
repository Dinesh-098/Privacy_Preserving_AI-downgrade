import { IconActivity, IconFlask2, IconKey, IconPlayerPlay } from "@tabler/icons-react";
import { useState } from "react";
import { request, useAction, useRead } from "../api";
import { ErrorBox, Field, JobProgress, Panel, Status } from "../components";
import { jobActive } from "../design/tokens";
import { mechanismName, modelName, num } from "../format";
import type { Dataset, Job, KeyStatus, Mechanism, Model, RunConfig } from "../types";
import { useWorkspace } from "../workspace";

export const mechanisms: Mechanism[] = ["E0", "E1", "E2", "E3", "E4"];
const models: Model[] = ["random_forest", "isolation_forest", "neural", "dp_neural"];
const techniqueDescriptions = {
  E0: "Use the original input fields as the baseline.",
  E1: "Mask sensitive values before preparing the model inputs.",
  E2: "Replace identifiers with repeatable tokens made with a secret key.",
  E3: "Tokenize accounts, hosts, devices and processes, then mask the other sensitive fields.",
  E4: "Limit each example’s contribution to a training step and add noise to the update.",
};

export function compatibleModel(dataset: Dataset, model: Model, mechanism: Mechanism) {
  if ((model === "dp_neural") !== (mechanism === "E4")) return "DP Neural Network requires E4.";
  if (dataset.kind !== "synthetic" && model !== "isolation_forest") return "This model requires labelled synthetic data.";
  if (dataset.rows < 60) return "Ingest at least 60 validated records.";
  return "";
}

export function MechanismStrip({ value, change, dataset }: { value: Mechanism; change: (value: Mechanism) => void; dataset?: Dataset }) {
  return <div className="mechanisms" aria-label="Experiment configuration">
    {mechanisms.map(item => {
      const blocked = item === "E4" && dataset && dataset.kind !== "synthetic";
      return <button type="button" key={item} className={item === value ? "chosen" : ""} aria-pressed={item === value}
        disabled={blocked} title={blocked ? "DP-SGD requires labelled synthetic records" : techniqueDescriptions[item]} onClick={() => change(item)}>
        <code>{item}</code><span>{mechanismName[item]}</span></button>;
    })}
  </div>;
}

const defaults = {
  seed: 419, split: "temporal", max_rows: 5_000, threshold: 0.5, contamination: 0.1,
  trees: 60, epochs: 8, batch_size: 128, delta: 0.00001, noise: 1.2, clip: 1, target_epsilon: null,
} satisfies Omit<RunConfig, "dataset_id" | "model" | "mechanism">;

export function RunSetup({ dataset, mechanism, setMechanism, analysis = false }: {
  dataset: Dataset; mechanism: Mechanism; setMechanism?: (mechanism: Mechanism) => void; analysis?: boolean;
}) {
  const workspace = useWorkspace();
  const [selected, setSelected] = useState<Model>(dataset.kind === "synthetic" ? "random_forest" : "isolation_forest");
  const [config, setConfig] = useState<RunConfig>({ dataset_id: dataset.id, model: selected, mechanism, ...defaults });
  const [preset, setPreset] = useState("balanced");
  const key = useRead<KeyStatus>("/keys");
  const model = mechanism === "E4" ? "dp_neural" : selected === "dp_neural" ? "neural" : selected;
  const reason = compatibleModel(dataset, model, mechanism);
  const needsKey = (mechanism === "E2" || mechanism === "E3") && !key.data?.configured;
  const generate = useAction(() => request<KeyStatus>("/keys", "POST", { rotate: false }), () => workspace.notice("Local HMAC key generated."));
  const start = useAction(() => request<Job>("/cases/" + dataset.case_id + "/runs", "POST", {
    ...config, dataset_id: dataset.id, mechanism, model,
  }), workspace.track);
  const advanced = workspace.prefs.mode === "advanced";
  const submitted = start.data;
  const job = submitted && (workspace.jobs.find(item => item.id === submitted.id) ?? submitted);
  const running = !!job && jobActive.has(job.status);
  const options: readonly Model[] = advanced ? models : dataset.kind !== "synthetic" ? ["isolation_forest"] as const :
    analysis ? ["random_forest", "isolation_forest", model] :
    mechanism === "E4" ? ["dp_neural"] as const : ["random_forest", "isolation_forest", "neural"] as const;
  const visibleModels = [...new Set(options)];

  function choose(modelChoice: Model) {
    setSelected(modelChoice);
    if (analysis) {
      if (modelChoice === "dp_neural") setMechanism?.("E4");
      else if (mechanism === "E4") setMechanism?.("E0");
    }
  }

  function number(key: keyof RunConfig, value: number | null) {
    setConfig(previous => ({ ...previous, [key]: value }));
  }

  function usePreset(value: string) {
    setPreset(value);
    setConfig(previous => ({ ...previous, noise: value === "strong" ? 2.5 : defaults.noise, target_epsilon: null }));
  }

  return <Panel title={analysis ? "Analysis setup" : "Experiment setup"} actions={<IconFlask2 size={17} className="subtle" aria-hidden="true" />}>
    <form className="stack panel-pad" onSubmit={event => { event.preventDefault(); start.mutate(); }}>
      <p className="muted">{techniqueDescriptions[mechanism]}</p>
      <Field label="Model"><select value={model} onChange={event => choose(event.target.value as Model)}>
        {visibleModels.map(value => {
          const scope = analysis ? value === "dp_neural" ? "E4" : "E0" : mechanism;
          const message = compatibleModel(dataset, value, scope);
          return <option key={value} value={value} disabled={!!message} title={message}>
            {modelName[value]}{message && (dataset.kind !== "synthetic" ? " · needs labels" : " · incompatible")}
          </option>;
        })}
      </select></Field>
      {dataset.kind !== "synthetic" ? <div className="lab-note"><Status>Unlabelled</Status><span>Use anomaly scores for triage. Classification metrics require a labelled source.</span></div> :
        <div className="lab-note"><Status tone="fixture">Rule-based labels</Status><span>Test the model on login records held back from training.</span></div>}
      {!advanced && mechanism === "E4" && <Field label="DP preset">
        <select value={preset} onChange={event => usePreset(event.target.value)}>
          <option value="balanced">Balanced noise</option><option value="strong">Stronger noise</option>
        </select>
      </Field>}
      {advanced && <div className="stack advanced-config">
        <Field label="Data split"><select value={config.split} onChange={event => setConfig({ ...config, split: event.target.value as RunConfig["split"] })}>
          <option value="temporal">Time-ordered holdout</option><option value="group">Disjoint account groups</option></select></Field>
        <div className="form-pair">
          <Field label="Random seed"><input required type="number" min={0} max={4294967295} value={config.seed} onChange={event => number("seed", +event.target.value)} /></Field>
          <Field label="Maximum records"><input required type="number" min={60} max={50000} value={config.max_rows} onChange={event => number("max_rows", +event.target.value)} /></Field>
        </div>
        <div className="form-pair">
          {(model === "random_forest" || model === "isolation_forest") && <Field label="Number of trees"><input required type="number" min={10} max={300}
            value={config.trees} onChange={event => number("trees", +event.target.value)} /></Field>}
          {model === "isolation_forest" ? <Field label="Target flag fraction"><input required type="number" step=".01" min=".01" max=".45"
            value={config.contamination} onChange={event => number("contamination", +event.target.value)} /></Field> :
            <Field label="Decision threshold"><input required type="number" step=".01" min=".01" max=".99"
              value={config.threshold} onChange={event => number("threshold", +event.target.value)} /></Field>}
        </div>
        {(model === "neural" || model === "dp_neural") && <div className="form-pair">
          <Field label="Epochs"><input required type="number" min="1" max="40" value={config.epochs} onChange={event => number("epochs", +event.target.value)} /></Field>
          <Field label="Batch size"><input required type="number" min="16" max="512" value={config.batch_size} onChange={event => number("batch_size", +event.target.value)} /></Field>
        </div>}
        {mechanism === "E4" && <>
          <div className="form-pair"><Field label="Delta"><input required type="number" min="0.00000001" max="0.01" step="any"
            value={config.delta} onChange={event => number("delta", +event.target.value)} /></Field>
            <Field label="Clip norm"><input required type="number" min=".05" max="10" step=".05" value={config.clip}
              onChange={event => number("clip", +event.target.value)} /></Field></div>
          <Field label="Target ε (optional)" hint="Leave blank to specify the noise multiplier.">
            <input type="number" min=".2" max="64" step="any" placeholder="Use fixed noise" value={config.target_epsilon ?? ""}
              onChange={event => number("target_epsilon", event.target.value ? +event.target.value : null)} /></Field>
          <Field label="Noise multiplier" hint={config.target_epsilon ? "Opacus calculates noise from the target ε." : undefined}>
            <input required type="number" min=".25" max="12" step=".05" value={config.noise} disabled={config.target_epsilon != null}
              onChange={event => number("noise", +event.target.value)} /></Field>
          {config.target_epsilon == null && <NoisePlot clip={config.clip} noise={config.noise} />}
        </>}
      </div>}
      {needsKey && <div className="inset stack"><p>Generate a local key to run HMAC configurations.</p>
        <button className="button" type="button" disabled={generate.isPending} onClick={() => generate.mutate()}><IconKey size={16} />Generate key</button></div>}
      {reason && <p className="alert notice">{reason}</p>}
      <ErrorBox error={start.error || generate.error} />
      <button className="button primary run-button" type="submit" disabled={start.isPending || running || !!reason || needsKey}>
        <IconPlayerPlay size={16} />{start.isPending || running ? "Running…" : analysis ? "Run analysis" : "Run experiment"}</button>
      {job && <div className="inset stack" role="status" aria-label="Run status">
        {running ? <JobProgress job={job} /> : <span>{job.status === "completed" ? "Results saved." :
          job.status === "failed" ? "The run failed." : "Run cancelled."}</span>}
        {job.error && <p className="alert error">{job.error}</p>}
      </div>}
      <p className="muted">Uses up to {num(Math.min(config.max_rows, dataset.rows))} records.</p>
    </form>
  </Panel>;
}

function NoisePlot({ clip, noise }: { clip: number; noise: number }) {
  const width = 218, half = width / 2, base = 66, sigma = Math.max(0.001, clip * noise);
  const extent = Math.max(3.5 * sigma, clip * 1.35);
  const edge = (clip / extent) * (half - 8);
  const curve = Array.from({ length: 45 }, (_, i) => {
    const ratio = i / 44;
    const x = (ratio * 2 - 1) * extent;
    return (8 + ratio * (width - 16)).toFixed(1) + "," + (base - 51 * Math.exp(-x * x / (2 * sigma * sigma))).toFixed(1);
  }).join(" ");
  return <div className="inset noise-explorer">
    <div className="cluster"><IconActivity size={16} /><strong>Noise illustration</strong></div>
    <svg viewBox={"0 0 " + width + " 82"} role="img" aria-label={"Illustrative Gaussian shape, sigma " + num(sigma, 2) + ", clip norm " + num(clip, 2)}>
      <path d={"M8 " + base + "H" + (width - 8)} stroke="var(--border)" />
      <path d={"M" + (half - edge) + " 13V" + base + "M" + (half + edge) + " 13V" + base}
        stroke="var(--warning)" strokeDasharray="3 4" />
      <polyline points={curve} fill="none" stroke="var(--accent)" strokeWidth="1.7" />
      <text x="8" y="79" fill="var(--muted)" fontSize="10">− gradient</text><text x="171" y="79" fill="var(--muted)" fontSize="10">+ gradient</text>
    </svg>
    <small className="muted">Mechanism illustration. Reported ε comes from the completed run.</small>
  </div>;
}
