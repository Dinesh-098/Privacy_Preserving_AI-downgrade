import { IconDownload, IconTable } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { init, use, type EChartsCoreOption, type EChartsType } from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { exportCsv } from "./api";
import { Panel } from "./components";
import { chartColors } from "./design/tokens";
import { useWorkspace } from "./workspace";

use([BarChart, LineChart, ScatterChart, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export default function Chart({ title, description, options, headings, rows, height = 260, onPick, onZoom }: {
  title: string; description: string; options: EChartsCoreOption; headings: string[]; rows: (string | number | null)[][];
  height?: number; onPick?: (data: unknown) => void; onZoom?: (start: number, end: number) => void;
}) {
  const { prefs } = useWorkspace();
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType>();
  const pick = useRef(onPick);
  const zoom = useRef(onZoom);
  pick.current = onPick;
  zoom.current = onZoom;
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const instance = init(el, undefined, { renderer: "canvas", useDirtyRect: true });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(el);
    instance.on("click", event => pick.current?.(event.data));
    instance.on("datazoom", event => {
      const payload = (event as { batch?: { start: number; end: number }[] }).batch?.[0] ?? event as { start: number; end: number };
      if (typeof payload.start === "number" && typeof payload.end === "number") zoom.current?.(payload.start, payload.end);
    });
    return () => { resize.disconnect(); instance.dispose(); chart.current = undefined; };
  }, []);
  useEffect(() => {
    const color = getComputedStyle(document.documentElement);
    const muted = color.getPropertyValue("--muted").trim();
    const border = color.getPropertyValue("--border").trim();
    const ink = color.getPropertyValue("--text").trim();
    const surface = color.getPropertyValue("--raised").trim();
    function axis(input: unknown) {
      const settings = { axisLabel: { color: muted, fontSize: 11, fontFamily: "IBM Plex Mono" },
        nameTextStyle: { color: muted, fontSize: 11 }, axisLine: { lineStyle: { color: border } },
        splitLine: { lineStyle: { color: border, opacity: 0.65 } }, nameLocation: "middle", nameGap: 28 };
      return Array.isArray(input) ? input.map(item => ({ ...settings, ...item })) : { ...settings, ...(input && typeof input === 'object' ? input : {}) };
    }
    chart.current?.setOption({
      color: [...chartColors], grid: { left: 61, right: 31, top: 33, bottom: 60, outerBoundsMode: "none" },
      textStyle: { color: ink, fontFamily: "IBM Plex Sans" },
      animation: !prefs.reduced && !matchMedia("(prefers-reduced-motion: reduce)").matches, animationDuration: 380, animationDurationUpdate: 220,
      ...options, xAxis: axis(options.xAxis), yAxis: axis(options.yAxis),
      legend: { textStyle: { color: muted }, ...(options.legend ?? {}) },
      tooltip: { trigger: "item", backgroundColor: surface, confine: true, borderColor: border,
        renderMode: "richText", textStyle: { color: ink }, ...(options.tooltip ?? {}) },
    }, { notMerge: true, lazyUpdate: true });
  }, [options, prefs.theme, prefs.reduced]);
  const slug = title.toLowerCase().replaceAll(/[^a-z\d]+/g, "-");
  function savePng() {
    const instance = chart.current;
    if (!instance) return;
    const link = document.createElement("a");
    link.href = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() });
    link.download = slug + ".png";
    link.click();
  }
  return <Panel className="chart-panel" title={title} actions={<>
    <button className="button tiny" type="button" aria-pressed={show} onClick={() => setShow(!show)}><IconTable size={14} />{show ? "Hide data" : "View data"}</button>
    <button className="button tiny" type="button" title="Download PNG chart" onClick={savePng}><IconDownload size={14} />PNG</button>
    <button className="button tiny" type="button" title="Download CSV chart data" onClick={() => exportCsv(slug + ".csv", headings, rows)}>CSV</button>
  </>}>
    <p className="chart-caption">{description}</p>
    <div className="chart" role="img" aria-label={title + ". " + description} ref={ref} style={{ height }} />
    {show && <div className="table-wrap chart-data"><table aria-label={title + " data"}>
      <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell} className="mono">{value ?? "—"}</td>)}</tr>)}</tbody>
    </table></div>}
  </Panel>;
}
