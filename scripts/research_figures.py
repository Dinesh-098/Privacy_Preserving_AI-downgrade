"""Render publication charts and summary tables from recorded experiment measurements."""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs" / "research"
FIGURES = RESEARCH / "figures"
FIGURES.mkdir(parents=True, exist_ok=True)
DATA = json.loads((RESEARCH / "measurements.json").read_text())
BASE = "#255b86"
PRIVATE = "#16716a"
WARNING = "#ab722e"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
    "axes.labelcolor": "#223b50", "xtick.color": "#223b50", "ytick.color": "#223b50", "pdf.fonttype": 42,
    "axes.edgecolor": "#8499ab", "grid.color": "#d5e0ea", "savefig.dpi": 240,
})


def save(fig, name):
    for extension in ("pdf", "png"):
        fig.savefig(FIGURES / f"{name}.{extension}", bbox_inches="tight", pad_inches=0.07, facecolor="white")
    plt.close(fig)


def average(values):
    return mean(values), stdev(values) if len(values) > 1 else 0.0


def derive(run):
    cfg, values = run["config"], run["results"]
    mechanism, model = cfg["mechanism"], cfg["model"]
    family = "RF" if model == "random_forest" else "NN"
    label = f"{mechanism} {family}"
    if values["dp"]:
        label = f"E4 (noise {cfg['noise']:g})"
    return label, values


groups = defaultdict(list)
for run in DATA["runs"]:
    label, values = derive(run)
    groups[label].append(values)
labels = list(groups)


def series(label, group, field):
    return [row[group][field] for row in groups[label] if row.get(group) is not None and row[group].get(field) is not None]


with (RESEARCH / "summary.csv").open("w", newline="", encoding="utf-8") as stream:
    writer = csv.writer(stream)
    writer.writerow(["configuration", "runs", "mean_f1", "sd_f1", "mean_roc_auc", "mean_membership_auc",
                     "mean_membership_advantage", "mean_training_s", "mean_inference_s", "mean_peak_rss_mib",
                     "mean_epsilon", "delta"])
    for label in labels:
        f1, sd = average(series(label, "metrics", "f1"))
        fields = [(g, m) for g, m in (
            ("metrics", "roc_auc"), ("membership", "auc"), ("membership", "advantage"),
            ("performance", "training_s"), ("performance", "inference_s"), ("performance", "peak_rss_mb"),
            ("dp", "epsilon"), ("dp", "delta"),
        )]
        writer.writerow([label, len(groups[label]), f1, sd, *(mean(values) if (values := series(label, g, m)) else ""
                         for g, m in fields)])

fig, ax = plt.subplots(figsize=(4.25, 2.45), layout="constrained")
private = [label for label in labels if label.startswith("E4")]
x, xsd = zip(*(average(series(label, "dp", "epsilon")) for label in private))
y, ysd = zip(*(average(series(label, "metrics", "f1")) for label in private))
ax.axhline(mean(series("E0 NN", "metrics", "f1")), color=BASE, linestyle="--", linewidth=1.35, label="Standard neural network")
ax.errorbar(x, y, xerr=xsd, yerr=ysd, color=PRIVATE, fmt="o-", linewidth=1.55, markersize=4.5, capsize=3, label="Opacus DP-SGD")
for label, a, b in zip(private, x, y):
    ax.annotate(label.split()[-1].rstrip(")"), (a, b), xytext=(0, -15), textcoords="offset points", ha="center", fontsize=8)
ax.set(xlabel="Training epsilon (delta = 10⁻⁵)", ylabel="Held-out F1", ylim=(0.56, 0.73), xlim=(0.35, 5.47))
ax.grid(axis="y")
ax.legend(frameon=False, loc="upper right", fontsize=7.6)
save(fig, "f1-epsilon")

fig, panels = plt.subplots(1, 2, figsize=(7.05, 2.6), layout="constrained")
positions = range(len(labels))
names = [label.replace(" (noise ", " / ").rstrip(")") for label in labels]
colors = [PRIVATE if label.startswith("E4") else BASE for label in labels]
for ax, group, field, axis, lower, higher in (
    (panels[0], "metrics", "f1", "Detection F1", .50, .76),
    (panels[1], "membership", "auc", "Membership ROC-AUC", .46, .61),
):
    averages, spread = zip(*(average(series(label, group, field)) for label in labels))
    ax.errorbar(positions, averages, yerr=spread, fmt="none", ecolor="#49657b", capsize=3, zorder=2)
    ax.scatter(positions, averages, c=colors, marker="o", s=27, zorder=3)
    ax.set_xticks(list(positions), names, rotation=42, ha="right")
    ax.set(ylabel=axis, ylim=(lower, higher))
    if field == "auc":
        ax.axhline(0.5, color=WARNING, linestyle="--", linewidth=1.2, label="Chance")
        ax.legend(frameon=False, fontsize=7.8)
    ax.grid(axis="y")
save(fig, "detection-membership")

fig, ax = plt.subplots(figsize=(4.4, 2.58), layout="constrained")
entries = DATA["aggregate_linkage"][0]["results"]
indexes = list(range(len(entries)))
ax.bar([pos - .18 for pos in indexes], [row["success"] * 100 for row in entries],
       label="Unique correct matches", width=.34, color=BASE)
ax.bar([pos + .18 for pos in indexes], [row["linkability"] * 100 for row in entries],
       label="In repeated classes", width=.34, color=PRIVATE, hatch="//")
ax.set_xticks(indexes, ["Original", "Masked", "HMAC tokens"])
ax.set(ylabel="Released rows (%)", ylim=(0, 119))
ax.legend(frameon=False, fontsize=7.7, loc="upper center", ncols=2)
ax.grid(axis="y")
ax.set_axisbelow(True)
save(fig, "linkage")

fig, axes = plt.subplots(1, 2, figsize=(7.05, 2.45), layout="constrained")
neural = ["E0 NN", *private]
for ax, field, axis in ((axes[0], "training_s", "Training wall time (s)"), (axes[1], "peak_rss_mb", "Process peak RSS (MiB)")):
    for index, label in enumerate(neural):
        values = series(label, "performance", field)
        ax.scatter([index - .1, index, index + .1], values, color=BASE if index == 0 else PRIVATE, s=27, zorder=2)
        ax.hlines(mean(values), index - .19, index + .19, colors="#182e41", linewidth=1.5, zorder=3)
    ax.set_xticks(range(4), ["E0 NN", "E4 / .85", "E4 / 1.20", "E4 / 2.50"], rotation=16, ha="right")
    ax.set_ylabel(axis)
    ax.grid(axis="y")
save(fig, "model-overhead")

fig, ax = plt.subplots(figsize=(7.15, 2.15), layout="constrained")
ax.set(xlim=(0, 12), ylim=(0, 3.4))
ax.axis("off")
nodes = [
    (0.15, 2.16, "Original evidence", "SHA-256 and case registration"),
    (4.27, 2.16, "Stream validated rows", "Gzip / text to Parquet"),
    (8.39, 2.16, "Investigate events", "DuckDB and source pointers"),
    (0.15, 0.35, "Report and audit", "Exports, hashes and manifests"),
    (4.27, 0.35, "Evaluate models", "Utility, leakage and overhead"),
    (8.39, 0.35, "Protect fields", "Masking and scoped HMAC"),
]
for i, (x, y, title, detail) in enumerate(nodes):
    ax.add_patch(FancyBboxPatch((x, y), 3.4, .94, boxstyle="round,pad=.09,rounding_size=.08",
                                fc="#eff5f8" if i != 5 else "#e7f4f0", ec="#49657b", lw=1.1))
    ax.text(x + .16, y + .63, title, color="#1a364e", fontsize=10, fontweight="bold", va="center")
    ax.text(x + .16, y + .27, detail, color="#3d596f", fontsize=7.5, va="center")
for x, y, end_x, end_y in [(3.69, 2.64, 4.12, 2.64), (7.8, 2.64, 8.25, 2.64),
                            (10.11, 2.01, 10.11, 1.44), (8.24, .81, 7.83, .81), (4.13, .81, 3.71, .81)]:
    ax.annotate("", xy=(end_x, end_y), xytext=(x, y), arrowprops={"arrowstyle": "->", "lw": 1.25, "color": BASE})
save(fig, "architecture")

fig, axes = plt.subplots(2, 1, figsize=(4.3, 3.95), sharex=True, layout="constrained")
for ax, group, field, axis, lower, higher in (
    (axes[0], "metrics", "f1", "Detection F1", .56, .745),
    (axes[1], "membership", "auc", "Membership AUC", .47, .605),
):
    averages, spread = zip(*(average(series(label, group, field)) for label in labels))
    ax.errorbar(positions, averages, yerr=spread, fmt="none", ecolor="#49657b", capsize=2.7, zorder=2)
    ax.scatter(positions, averages, c=colors, s=27, zorder=3)
    ax.set(ylabel=axis, ylim=(lower, higher))
    ax.grid(axis="y")
axes[-1].axhline(.5, color=WARNING, linestyle="--", linewidth=1)
axes[-1].set_xticks(list(positions), names, rotation=34, ha="right")
save(fig, "detection-membership-paper")

fig, axes = plt.subplots(2, 1, figsize=(4.35, 3.65), sharex=True, layout="constrained")
for ax, field, axis in ((axes[0], "training_s", "Training time (s)"), (axes[1], "peak_rss_mb", "Peak RSS (MiB)")):
    for index, label in enumerate(neural):
        values = series(label, "performance", field)
        ax.scatter([index - .1, index, index + .1], values, color=BASE if index == 0 else PRIVATE, s=24, zorder=2)
        ax.hlines(mean(values), index - .19, index + .19, colors="#182e41", linewidth=1.35, zorder=3)
    ax.set_ylabel(axis)
    ax.grid(axis="y")
axes[-1].set_xticks(range(4), ["E0 NN", "E4 / .85", "E4 / 1.20", "E4 / 2.50"])
save(fig, "model-overhead-paper")
