import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconChevronLeft, IconChevronRight, IconCopy,
  IconDatabase, IconFileSearch, IconFingerprint, IconHelpCircle, IconX } from "@tabler/icons-react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { cloneElement, isValidElement, useId, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Dataset, Job, Source } from "./types";
import { bytes, num, sec } from "./format";

export function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={"badge " + tone}>{children}</span>;
}

export function Origin({ origin }: { origin: Dataset["origin"] }) {
  if (origin === "fixture") return <Status tone="fixture">Example fixture</Status>;
  if (origin === "synthetic") return <Status tone="fixture">Synthetic data</Status>;
  return <Status>Registered source</Status>;
}

export function Panel({ title, actions, children, className = "" }: {
  title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={"panel " + className}><div className="panel-head"><h2>{title}</h2>{actions && <div className="cluster">{actions}</div>}</div>{children}</section>;
}

export function Page({ title, summary, actions, children }: { title: string; summary: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="page">
    <header className="page-head"><div><h1>{title}</h1><p>{summary}</p></div>{actions && <div className="cluster page-actions">{actions}</div>}</header>
    {children}
  </div>;
}

export function ErrorBox({ error }: { error?: Error | null }) {
  return error ? <div className="alert error" role="alert"><IconAlertTriangle aria-hidden="true" size={17} />{error.message}</div> : null;
}

export function Empty({ title, detail, action, icon = "files" }: {
  title: string; detail: string; action?: ReactNode; icon?: "files" | "data" | "privacy";
}) {
  const Icon = { files: IconFileSearch, data: IconDatabase, privacy: IconFingerprint }[icon];
  return <div className="empty">
    <span className="empty-icon"><Icon size={23} stroke={1.45} aria-hidden="true" /></span>
    <strong>{title}</strong><p>{detail}</p>{action}
  </div>;
}

export function Loading({ label = "Loading records…" }: { label?: string }) {
  return <div className="loading" role="status" aria-label={label}>
    <span className="sr-only">{label}</span><i /><i /><i />
  </div>;
}

export function DataTable<T>({ data, columns, label, onSelect }: {
  data: T[]; columns: ColumnDef<T, any>[]; label: string; onSelect?: (row: T) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const refs = useRef<Array<HTMLTableRowElement | null>>([]);
  return <div className="table-wrap">
    <table aria-label={label}><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => {
      const sort = header.column.getIsSorted();
      const text = flexRender(header.column.columnDef.header, header.getContext());
      return <th key={header.id} scope="col" aria-sort={sort ? (sort === "asc" ? "ascending" : "descending") : undefined}>
        {header.column.getCanSort() ? <button className="sort" type="button" onClick={header.column.getToggleSortingHandler()}>
          {text}{sort === "asc" ? <IconArrowUp size={12} /> : sort === "desc" ? <IconArrowDown size={12} /> : null}
        </button> : text}
      </th>;
    })}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map((row, index) => <tr key={row.id} className={onSelect ? "selectable" : ""} ref={el => { refs.current[index] = el; }}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? event => { if (!(event.target as HTMLElement).closest("button,a,input,select")) onSelect(row.original); } : undefined}
      onKeyDown={onSelect ? event => {
        if (event.currentTarget !== event.target) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.original); }
        if (event.key === "j") { event.preventDefault(); refs.current[index + 1]?.focus(); }
        if (event.key === "k") { event.preventDefault(); refs.current[index - 1]?.focus(); }
      } : undefined}>
      {row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
    </tr>)}</tbody></table>
  </div>;
}

export function Pagination({ page, setPage, hasMore, total, size }: {
  page: number; setPage: (page: number) => void; hasMore?: boolean; total?: number | null; size: number;
}) {
  return <div className="pagination"><span>{total != null && total > 0 ?
    num((page - 1) * size + 1) + "–" + num(Math.min(total, page * size)) + " of " + num(total) :
    "Page " + num(page)}</span><div className="cluster">
      <button className="icon-button" aria-label="Previous page" title="Previous page" type="button"
        disabled={page <= 1} onClick={() => setPage(page - 1)}><IconChevronLeft size={16} /></button>
      <button className="icon-button" aria-label="Next page" title="Next page" type="button"
        disabled={!(hasMore ?? (total != null && page * size < total))} onClick={() => setPage(page + 1)}><IconChevronRight size={16} /></button>
    </div></div>;
}

export function HashText({ hash, label = "Copy SHA-256" }: { hash?: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return <span>—</span>;
  return <span className="hash" title={hash}><code>{hash.slice(0, 8)}…{hash.slice(-5)}</code>
    <button className="icon-button icon-inline" type="button" title={copied ? "Copied" : label} aria-label={copied ? "Copied" : label}
      onClick={async () => { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      <IconCopy size={14} aria-hidden="true" /></button></span>;
}

export function SourceChip({ source }: { source: Source }) {
  const [params] = useSearchParams();
  const link = new URLSearchParams({ dataset: source.dataset_id, line: String(source.line) });
  const active = params.get("case");
  if (active) link.set("case", active);
  return <Link className="source-chip" to={"/datasets?" + link.toString()} title={"Dataset SHA-256 " + source.dataset_hash}>
    <IconFingerprint size={14} aria-hidden="true" />Line {num(source.line)} <small>· {source.dataset_hash.slice(0, 6)}</small></Link>;
}

export function KeyValues({ items, className = "" }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return <dl className={"key-values " + className}>{items.map(([label, value], index) => <div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function Field({ label, hint, children, ...props }: { label: ReactNode; hint?: string; children: ReactNode } & HTMLAttributes<HTMLLabelElement>) {
  const id = useId();
  const control = isValidElement<{ "aria-labelledby"?: string; "aria-describedby"?: string }>(children) ?
    cloneElement(children, { "aria-labelledby": id, ...(hint ? { "aria-describedby": id + "-hint" } : {}) }) : children;
  return <label className="field" {...props}><span id={id}>{label}</span>{control}{hint && <small id={id + "-hint"}>{hint}</small>}</label>;
}

export function Drawer({ title, description, children, close, side = true }: {
  title: ReactNode; description?: string; children: ReactNode; close: () => void; side?: boolean;
}) {
  const [width, setWidth] = useState(464);
  const content = useRef<HTMLDivElement>(null);
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Overlay className="overlay" />
      <Dialog.Content ref={content} className={side ? "drawer" : "dialog"} style={side ? { width } : undefined}
        onCloseAutoFocus={event => {
          event.preventDefault();
          document.querySelector<HTMLElement>(".page h1")?.focus();
        }}>
        {side && <div className="drawer-resize" aria-hidden="true" onPointerDown={event => {
          const start = event.clientX;
          const original = width;
          const handle = event.currentTarget;
          handle.setPointerCapture(event.pointerId);
          handle.onpointermove = motion => setWidth(Math.max(360, Math.min(620, original + start - motion.clientX)));
          handle.onlostpointercapture = () => { handle.onpointermove = null; };
        }} />}
        <div className="drawer-head"><div><Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className={description ? "" : "sr-only"}>{description || "Details and available actions."}</Dialog.Description>
        </div><Dialog.Close className="icon-button" aria-label="Close dialog" title="Close"><IconX size={18} /></Dialog.Close></div>
        <div className="drawer-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function Confirm({ title, detail, action, close, confirm, danger = false }: {
  title: string; detail: ReactNode; action: string; close: () => void; confirm: () => void; danger?: boolean;
}) {
  return <Drawer title={title} close={close} side={false}>
    <div className="stack"><p>{detail}</p><div className="cluster end">
      <button className="button" type="button" onClick={close}>Cancel</button>
      <button className={"button " + (danger ? "danger-button" : "primary")} type="button" onClick={() => { close(); confirm(); }}>{action}</button>
    </div></div>
  </Drawer>;
}

export function Tabbed({ tabs, value, change, initial, label }: {
  tabs: { id: string; label: string; content: ReactNode }[]; value?: string; change?: (value: string) => void; initial?: string; label: string;
}) {
  return <Tabs.Root value={value} defaultValue={initial ?? tabs[0].id} onValueChange={change} className="tabs">
    <Tabs.List className="tab-list" aria-label={label}>
      {tabs.map(tab => <Tabs.Trigger className="tab" key={tab.id} value={tab.id}>{tab.label}</Tabs.Trigger>)}
    </Tabs.List>{tabs.map(tab => <Tabs.Content className="tab-content" key={tab.id} value={tab.id}>{tab.content}</Tabs.Content>)}
  </Tabs.Root>;
}

export function JobProgress({ job }: { job: Job }) {
  const detail = job.progress;
  return <div className="job-progress">
    <div className="cluster between"><span>{detail.phase}</span><code>{detail.fraction != null ? Math.round(detail.fraction * 100) + "%" : "—"}</code></div>
    <progress max={1} value={detail.fraction ?? undefined} aria-label={job.label + " progress"} />
    {detail.current != null && <small>
      {detail.unit === "bytes" ? bytes(detail.current) + (detail.total != null ? " of " + bytes(detail.total) : "") :
        num(detail.current) + (detail.total != null ? " / " + num(detail.total) : "") + " " + (detail.unit ?? "")}
      {detail.rate ? " · " + (detail.unit === "bytes" ? bytes(detail.rate) : num(detail.rate, 1)) + "/s" : ""}
      {detail.elapsed ? " · " + sec(detail.elapsed) + " elapsed" : ""}
      {detail.eta ? " · " + sec(detail.eta) + " remaining" : ""}
    </small>}
  </div>;
}

export function Help({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button className="icon-button" type="button" title={"Help for " + title} aria-label={"Help for " + title}
    onClick={() => setOpen(true)}><IconHelpCircle size={18} /></button>
    {open && <Drawer title={title} close={() => setOpen(false)}><div className="prose">{children}</div></Drawer>}</>;
}
