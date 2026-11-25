import { useState } from "react";
import { Confirm, Drawer, Empty, Field, KeyValues, Page, Panel, Status, Tabbed } from "../components";
import { useWorkspace } from "../workspace";

export default function DesignSystem() {
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const workspace = useWorkspace();
  return <Page title="Design system" summary="Inspect the shared controls, surfaces and interaction patterns.">
    <div className="settings-grid">
      <Panel title="Visual tokens"><div className="panel-pad stack">
        <div className="token-colors">{["bg", "sidebar", "panel", "raised", "border", "accent", "teal", "warning", "danger"].map(value =>
          <div key={value}><span style={{ background: "var(--" + value + ")" }} /><code>--{value}</code></div>)}</div>
        <KeyValues items={[["Interface", "IBM Plex Sans"], ["Identifiers and numbers", "IBM Plex Mono"],
          ["Spacing", "4 px base grid"], ["Motion", "Reduced motion follows system and settings"]]} />
      </div></Panel>
      <Panel title="Controls and states"><div className="panel-pad stack">
        <div className="cluster"><button className="button primary" type="button" onClick={() => setPreview(true)}>Open drawer</button>
          <button className="button" type="button" onClick={() => setConfirm(true)}>Open confirmation</button></div>
        <div className="cluster"><Status>Unlabelled</Status><Status tone="fixture">Example fixture</Status><Status tone="info">Model flag</Status>
          <Status tone="success">Verified</Status><Status tone="danger">Hash mismatch</Status></div>
        <Tabbed label="Sample tabs" tabs={[
          { id: "form", label: "Inputs", content: <div className="panel-pad"><Field label="Sample input"><input placeholder="Enter text" /></Field></div> },
          { id: "empty", label: "Empty state", content: <Empty title="No records in view" detail="A clear next step belongs here when the user can take one." /> },
        ]} />
      </div></Panel>
    </div>
    {preview && <Drawer title="Example detail drawer" close={() => setPreview(false)}><div className="stack"><h3>Provenance</h3>
      <p>Detail drawers keep source metadata next to related actions.</p></div></Drawer>}
    {confirm && <Confirm title="Confirm control example" detail="This action displays a local status message." action="Confirm preview"
      close={() => setConfirm(false)} confirm={() => workspace.notice("Design-system example confirmed.")} />}
  </Page>;
}
