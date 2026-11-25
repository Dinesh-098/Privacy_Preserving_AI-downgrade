import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { useRead } from "../api";
import { DataTable, Empty, ErrorBox, HashText, KeyValues, Loading, Origin, Page, Panel, Tabbed } from "../components";
import { bytes, kindName, metric, num, sec } from "../format";
import type { Environment } from "../types";
import { useWorkspace } from "../workspace";
import { useCaseDatasets } from "./explorer";
import { Overhead, useRuns } from "./lab";

const Chart = lazy(() => import("../chart"));

export default function PerformancePage() {
  const workspace = useWorkspace();
  const runs = useRuns(workspace.caseId);
  const { items, query } = useCaseDatasets();
  const environment = useRead<Environment>("/environment");
  const [filter, setFilter] = useState("");
  const [ingestField, setIngestField] = useState<"rows_per_s" | "mb_per_s">("rows_per_s");
  const subset = (runs.data ?? []).filter(run => !filter || run.config.mechanism === filter).slice(0, 8);
  const unit = ingestField === "rows_per_s" ? "Valid rows / second" : "Source MB / second";
  return <Page title="Performance analysis" summary="Inspect measured model overhead, ingestion throughput and the local measurement environment.">
    <ErrorBox error={runs.error || query.error || environment.error} />
    <div className="performance-grid">
      <Panel title="Recorded measurements">
        <Tabbed label="Performance measurements" tabs={[
          { id: "runs", label: "Experiments", content: <div className="stack panel-pad">
            <label className="field metric-filter"><span>Configuration</span><select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="">Most recent runs</option>{["E0", "E1", "E2", "E3", "E4"].map(item => <option key={item}>{item}</option>)}</select></label>
            {runs.isLoading ? <Loading /> : <Overhead runs={subset} />}</div> },
          { id: "ingestion", label: "Ingestion", content: <div className="panel-pad stack">
            {query.isLoading ? <Loading /> : items.length ? <>
              <label className="field metric-filter"><span>Throughput unit</span><select value={ingestField}
                onChange={event => setIngestField(event.target.value as typeof ingestField)}>
                <option value="rows_per_s">Valid rows per second</option><option value="mb_per_s">Read MB per second</option></select></label>
              <Suspense fallback={<Loading label="Preparing throughput chart…" />}><Chart title="Ingestion throughput"
                description="Measured from each source range during validation and Parquet writing. Byte rates describe the source stream as stored."
                headings={["Dataset", unit]} rows={items.map(item => [item.id, item.meta[ingestField]])}
                options={{ xAxis: { type: "category", name: "Dataset", data: items.map(item => item.id.slice(-5)) },
                  yAxis: { type: "value", name: unit, nameGap: 45 },
                  series: [{ type: "bar", name: unit, data: items.map(item => item.meta[ingestField]), barMaxWidth: 54 }] }} /></Suspense>
              <DataTable data={items} label="Ingestion performance measurements" columns={[
                { accessorKey: "kind", header: "Source", cell: info => <span className="cluster">{kindName[info.row.original.kind]}<Origin origin={info.row.original.origin} /></span> },
                { accessorKey: "sha256", header: "Version", cell: info => <HashText hash={info.getValue()} /> },
                { accessorKey: "rows", header: "Rows", cell: info => <code>{num(info.getValue())}</code> },
                { accessorFn: item => item.meta.duration_s, header: "Elapsed", cell: info => <code>{sec(info.getValue())}</code> },
                { accessorFn: item => item.meta.rows_per_s, header: "Rows/s", cell: info => <code>{metric(info.getValue(), 0)}</code> },
                { accessorFn: item => item.meta.mb_per_s, header: "MB/s", cell: info => <code>{metric(info.getValue(), 2)}</code> },
              ]} />
            </> : <Empty title="No completed ingestion jobs" detail="Ingest a source range to collect rows per second and source read throughput." />}
          </div> },
        ]} />
      </Panel>
      <Panel title="Measurement environment">
        {environment.isLoading ? <Loading /> : environment.data && <div className="panel-pad stack">
          <KeyValues items={[["OS", environment.data.os], ["Architecture", environment.data.machine],
            ["Logical cores", num(environment.data.cores)], ["Physical memory", bytes(environment.data.ram)],
            ["Disk available", bytes(environment.data.free)], ["Python", environment.data.python],
            ...Object.entries(environment.data.packages).map(([key, value]) => [key, value ?? "—"] as [string, string])]} />
        </div>}
      </Panel>
    </div>
    <p className="next-link">Next <Link to={workspace.url("/reports")}>Generate a performance report</Link></p>
  </Page>;
}
