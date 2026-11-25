import { IconFolder, IconKey, IconShieldCheck } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useRead } from "../api";
import { ErrorBox, Field, KeyValues, Page, Panel } from "../components";
import { bytes, num } from "../format";
import type { Environment } from "../types";
import { useWorkspace } from "../workspace";
import { KeyPanel } from "./privacy";

export default function SettingsPage() {
  const workspace = useWorkspace();
  const { prefs, setPref, health } = workspace;
  const environment = useRead<Environment>("/environment");
  return <Page title="Settings" summary="Adjust local appearance and inspect storage, processing limits and key metadata.">
    <ErrorBox error={environment.error} />
    <div className="settings-grid">
      <div className="stack">
        <Panel title="Appearance and interaction">
          <div className="stack panel-pad">
            <div className="form-pair">
              <Field label="Theme"><select value={prefs.theme} onChange={event => setPref("theme", event.target.value as typeof prefs.theme)}>
                <option value="dark">Dark</option><option value="light">Light</option></select></Field>
              <Field label="Table density"><select value={prefs.density} onChange={event => setPref("density", event.target.value as typeof prefs.density)}>
                <option value="compact">Compact</option><option value="default">Default</option><option value="comfortable">Comfortable</option></select></Field>
            </div>
            <div className="form-pair">
              <Field label="Workspace mode"><select value={prefs.mode} onChange={event => setPref("mode", event.target.value as typeof prefs.mode)}>
                <option value="simple">Simple</option><option value="advanced">Advanced</option></select></Field>
              <Field label="Preview rows"><select value={prefs.preview} onChange={event => setPref("preview", +event.target.value)}>
                {[4, 8, 15, 30].map(value => <option value={value} key={value}>{value}</option>)}</select></Field>
            </div>
            <label className="check-row"><input type="checkbox" checked={prefs.presentation}
              onChange={event => setPref("presentation", event.target.checked)} />Presentation mode</label>
            <label className="check-row"><input type="checkbox" checked={prefs.reduced}
              onChange={event => setPref("reduced", event.target.checked)} />Reduce motion</label>
            <label className="check-row"><input type="checkbox" checked={prefs.rail}
              onChange={event => setPref("rail", event.target.checked)} />Collapse sidebar</label>
          </div>
        </Panel>
        <Panel title="Privacy defaults" actions={<IconShieldCheck size={17} className="subtle" />}>
          <div className="stack panel-pad"><KeyValues items={[
            ["Identifier preview", "Redacted"], ["Reveal duration", "10 seconds"], ["Evidence access", "Local allowed directories"],
            ["Default policy", "Mask structured sensitive fields"], ["Report sensitivity", "Redacted by default"],
          ]} /><Link className="inline-link" to={workspace.url("/protection")}>Edit a dataset policy</Link></div>
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Storage and limits" actions={<IconFolder size={17} className="subtle" />}>
          <div className="stack panel-pad"><KeyValues items={[
            ["Application data", <code>{prefs.presentation ? "Local data directory" : health?.storage ?? "—"}</code>],
            ["Evidence directories", prefs.presentation ? num(environment.data?.evidence_roots.length) :
              environment.data?.evidence_roots.map(path => <code className="path-value" key={path}>{path}</code>) ?? "—"],
            ["Upload limit", bytes(health?.limits.upload_bytes)], ["Parquet chunk size", num(health?.limits.chunk_rows) + " rows"],
            ["Query limit", num(health?.limits.rows) + " rows"], ["Query timeout", num(health?.limits.query_seconds) + " seconds"],
            ["Concurrent background workers", num(health?.limits.workers)], ["Version", health?.version ?? "—"],
          ]} /><Link to={workspace.url("/performance")}>View runtime versions</Link></div>
        </Panel>
        <Panel title="Pseudonym key management" actions={<IconKey size={17} className="subtle" />}><KeyPanel /></Panel>
      </div>
    </div>
    <p className="next-link">Reference <Link to={workspace.url("/design-system")}>Design system</Link></p>
  </Page>;
}
