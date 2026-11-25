import { IconArrowRight, IconCheck, IconFileDescription, IconFilePlus, IconFlask2, IconFolderPlus,
  IconLayersIntersect, IconPlus, IconShieldCheck, IconTimeline } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { request, useAction, useRead } from "../api";
import { ErrorBox, JobProgress, KeyValues, Page, Panel, Status } from "../components";
import { jobActive } from "../design/tokens";
import { num } from "../format";
import { useWorkspace } from "../workspace";
import type { Dataset, Investigation, Job } from "../types";

const exampleTitle = "Authentication review · Example fixture";

export function Overview() {
  const workspace = useWorkspace();
  const { active, caseId, url, prefs } = workspace;
  const datasets = useRead<Dataset[]>(caseId ? "/cases/" + caseId + "/datasets" : undefined);
  const showFixture = datasets.data?.some(item => item.origin === "fixture");
  const example = useAction(async () => {
    const existing = workspace.cases.find(item => item.title === exampleTitle);
    const sample = existing ?? await request<Investigation>("/cases", "POST", {
      title: exampleTitle, description: "Generated login, process and reference records for the demo.",
    });
    const job = await request<Job>("/cases/" + sample.id + "/demo", "POST");
    return { sample, job };
  }, result => { workspace.switchCase(result.sample.id); workspace.track(result.job); });
  const submitted = example.data?.job;
  const loadJob = submitted && (workspace.jobs.find(job => job.id === submitted.id) ?? submitted);
  const loading = example.isPending || workspace.activeJobs.some(job => job.type === "fixture");

  const steps = [
    { label: "Create a case", detail: "Group files and findings", path: "/investigations", done: !!active, icon: IconFolderPlus },
    { label: "Check evidence", detail: "Record and verify hashes", path: "/evidence", done: !!active?.evidence_count && active.verified_count === active.evidence_count, icon: IconFilePlus },
    { label: "Review activity", detail: "Save a source-linked finding", path: "/datasets", done: !!active?.finding_count, icon: IconTimeline },
    { label: "Protect identifiers", detail: "Save a masking or HMAC policy", path: "/privacy", done: !!active?.policy_count, icon: IconShieldCheck },
    { label: "Compare results", detail: "Measure accuracy and privacy", path: "/lab", done: !!active?.run_count, icon: IconFlask2 },
    { label: "Write a report", detail: "Export the case summary", path: "/reports", done: !!active?.report_count, icon: IconFileDescription },
  ];
  const next = steps.find(step => !step.done);
  return <Page title="Investigation overview" summary="Can we investigate a suspicious login while keeping other people’s activity private?"
    actions={<>
      <button className="button primary" type="button" onClick={() => example.mutate()} disabled={loading}>
        <IconLayersIntersect size={16} />{loading ? "Loading example case…" : "Load example case"}</button>
      <button className="button" type="button" onClick={workspace.openNew}><IconPlus size={17} />New investigation</button>
    </>}>
    <ErrorBox error={example.error} />
    <section className="case-band" aria-label="Active investigation">
      <div className="case-band-main">
        <h2>{active ? prefs.presentation ? active.id : active.title : "Start with an example or your own log"}</h2>
        <div className="case-band-meta">
          {showFixture ? <><Status tone="fixture">Example fixture</Status><span>Generated data with rule-based login labels.</span></> :
            <span>{active ? "Add files and work through the case checklist." : "The example includes login, process and red-team reference records."}</span>}
        </div>
      </div>
      {active && next && <Link className="button" to={url(next.path)}>{next.label}<IconArrowRight size={16} /></Link>}
    </section>
    {loadJob && jobActive.has(loadJob.status) && <Panel title="Loading example records">
      <div className="panel-pad"><JobProgress job={loadJob} /></div></Panel>}
    {loadJob?.error && <p className="alert error" role="alert">{loadJob.error}</p>}
    <Panel title="Case checklist">
      <ol className="workflow">{steps.map(step => {
        const Icon = step.done ? IconCheck : step.icon;
        return <li key={step.path} className={step === next ? "current" : undefined}>
          <Link to={url(step.path)}>
            <Icon size={18} aria-hidden="true" />
            <span><strong>{step.label}</strong><small>{step.done ? "Complete · " : ""}{step.detail}</small></span>
          </Link>
        </li>;
      })}</ol>
    </Panel>
    {active && <Panel title="Case progress">
      <div className="panel-pad"><KeyValues items={[
        ["Evidence files verified", num(active.verified_count) + " / " + num(active.evidence_count)],
        ["Findings saved", num(active.finding_count)],
        ["Experiments saved", num(active.run_count)],
        ["Reports exported", num(active.report_count)],
      ]} /></div>
    </Panel>}
  </Page>;
}
