"""Typeset the B.Tech report with figures and tables from measured research artifacts."""
from __future__ import annotations

import csv
import json
import re
from html import escape
from pathlib import Path
from xml.sax.saxutils import quoteattr

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs" / "research"
OUTPUT = ROOT / "output" / "pdf" / "privforensics-btech-report.pdf"
INK = colors.HexColor("#18304A")
BODY = colors.HexColor("#243C52")
MUTED = colors.HexColor("#496176")
TEAL = colors.HexColor("#177D73")
RULE = colors.HexColor("#C7D5E2")
PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 24 * mm
WIDTH = PAGE_WIDTH - 2 * MARGIN

base = getSampleStyleSheet()
base.add(ParagraphStyle("Body", fontName="Helvetica", fontSize=10.6, leading=15, textColor=BODY, spaceAfter=10))
base.add(ParagraphStyle("Chapter", fontName="Helvetica-Bold", fontSize=23, leading=27, textColor=INK, spaceAfter=17,
                        keepWithNext=True))
base.add(ParagraphStyle("Section", fontName="Helvetica-Bold", fontSize=13.4, leading=16, textColor=INK, spaceBefore=10,
                        spaceAfter=6, keepWithNext=True))
base.add(ParagraphStyle("Overline", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=TEAL, spaceAfter=10,
                        charSpace=1.4))
base.add(ParagraphStyle("CoverTitle", fontName="Helvetica-Bold", fontSize=38, leading=43, textColor=INK, spaceAfter=15))
base.add(ParagraphStyle("CoverSub", fontName="Helvetica", fontSize=16, leading=22, textColor=MUTED, spaceAfter=12))
base.add(ParagraphStyle("Caption", fontName="Helvetica", fontSize=8.8, leading=12, textColor=MUTED, spaceAfter=9))
base.add(ParagraphStyle("TableBody", fontName="Helvetica", fontSize=9, leading=12, textColor=BODY))
base.add(ParagraphStyle("TableHead", parent=base["TableBody"], fontName="Helvetica-Bold", textColor=colors.white))
base.add(ParagraphStyle("ContentsEntry", fontName="Helvetica", fontSize=11.5, leading=18, spaceAfter=6, textColor=INK))


def paragraph(text, style="Body"):
    safe = escape(" ".join(text.split()))
    safe = re.sub(r"(https?://[^\s]+)", lambda match:
                  "<link href=" + quoteattr(match.group(0)) + ">" + match.group(0) + "</link>", safe)
    return Paragraph(safe, base[style])


def table(headings, rows, widths=None):
    data = [[paragraph(cell, "TableHead") for cell in headings]]
    data.extend([paragraph(str(cell), "TableBody") for cell in row] for row in rows)
    result = Table(data, colWidths=widths or [WIDTH / len(headings)] * len(headings), repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0F5F8")]),
        ("LINEBELOW", (0, -1), (-1, -1), .5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return result


class ProjectReport(BaseDocTemplate):
    def afterFlowable(self, item):
        if isinstance(item, Paragraph) and item.style.name == "Chapter":
            text = item.getPlainText()
            label = "chapter-" + str(self.page)
            self.canv.bookmarkPage(label)
            self.canv.addOutlineEntry(text, label)
            self.notify("TOCEntry", (0, text, self.page, label))


def decorate(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.setFillColor(TEAL)
        canvas.rect(MARGIN, PAGE_HEIGHT - 27 * mm, 36 * mm, 1.35 * mm, fill=1, stroke=0)
    else:
        canvas.setStrokeColor(RULE)
        canvas.line(MARGIN, PAGE_HEIGHT - 18 * mm, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 18 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(MARGIN, PAGE_HEIGHT - 14.7 * mm, "PRIVFORENSICS")
        canvas.drawRightString(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 14.7 * mm, "B.TECH PROJECT REPORT")
    canvas.setStrokeColor(RULE)
    canvas.line(MARGIN, 17 * mm, PAGE_WIDTH - MARGIN, 17 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(MARGIN, 12.5 * mm, "Privacy-Preserving AI in Forensics")
    canvas.drawRightString(PAGE_WIDTH - MARGIN, 12.5 * mm, str(doc.page))
    canvas.restoreState()


def visual(name, caption, max_height=71 * mm):
    path = RESEARCH / "figures" / f"{name}.png"
    image = Image(path)
    factor = min(WIDTH / image.imageWidth, max_height / image.imageHeight)
    image.drawWidth, image.drawHeight = image.imageWidth * factor, image.imageHeight * factor
    image.hAlign = "CENTER"
    return KeepTogether([image, Spacer(1, 4), paragraph(caption, "Caption")])


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    metrics = json.loads((RESEARCH / "measurements.json").read_text())
    with (RESEARCH / "summary.csv").open() as stream:
        summary = list(csv.DictReader(stream))
    med = metrics["medium_ingestion"]
    sample = metrics["fixture"]
    team = [
        ("Withheld", "Student 1"),
        ("Withheld", "Student 2"),
        ("Withheld", "Student 3"),
        ("Withheld", "Student 4"),
    ]
    doc = ProjectReport(
        str(OUTPUT), pagesize=A4, title="Privacy-Preserving AI in Forensics",
        author=", ".join(name for _, name in team), subject="PrivForensics B.Tech project report",
    )
    doc.addPageTemplates(PageTemplate(
        id="report", frames=[Frame(MARGIN, 23 * mm, WIDTH, PAGE_HEIGHT - 47 * mm,
                                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=decorate,
    ))
    toc = TableOfContents()
    toc.levelStyles = [base["ContentsEntry"]]
    toc.dotsMinLevel = 0
    story = [
        Spacer(1, 31 * mm), paragraph("B.TECH COMPUTER SCIENCE AND ENGINEERING", "Overline"),
        paragraph("Privacy-Preserving AI in Forensics", "CoverTitle"),
        paragraph("PrivForensics", "CoverSub"),
        paragraph("Evidence-linked investigation and measurable privacy protection.", "Body"),
        Spacer(1, 13 * mm),
        table(["Registration number", "Student"], team, [WIDTH * .34, WIDTH * .66]),
        Spacer(1, 15 * mm), paragraph("Department of Computer Science and Engineering", "Section"),
        paragraph("Institution [to be completed by the project team]"),
        paragraph("Project guide [to be completed by the project team]"),
        paragraph("Project report draft · November 2026", "Caption"),
        PageBreak(), paragraph("Contents", "CoverTitle"), toc,
        Spacer(1, 12 * mm), paragraph("Study scope", "Overline"),
        paragraph("Evidence, training and leakage observations use local, explicitly generated data. The report identifies the measured scale and records the limits of the evaluation."),
    ]
    tokens = {
        "[[architecture]]": [visual("architecture", "Figure 1. Information flow from original source bytes to evidence-linked reports.")],
        "[[detection-membership]]": [visual("detection-membership", "Figure 2. Detection F1 and membership ROC-AUC by configuration. Bars show sample standard deviation across three seeds.")],
        "[[f1-epsilon]]": [visual("f1-epsilon", "Figure 3. Held-out F1 versus training epsilon at three noise scales. Delta = 10^-5. Error bars show sample standard deviations.", 56 * mm)],
        "[[model-overhead]]": [visual("model-overhead", "Figure 4. Process timing and memory observations for the matched neural architecture.", 55 * mm)],
        "[[linkage]]": [visual("linkage", "Figure 5. Aggregate linkage against the 1,500-row synthetic release with an identifier-only auxiliary view.", 65 * mm)],
        "[[fixture]]": [table(["Recorded source scope", "Value"], [
            ["Dataset version", sample["sha256"]], ["Physical source range", f"{sample['first_line']:,} - {sample['last_line']:,}"],
            ["Validated observations", f"{sample['rows']:,}"], ["Generated label counts", "6,220 normal / 3,780 suspicious"],
        ], [WIDTH * .34, WIDTH * .66])],
        "[[ingestion]]": [paragraph("Ingestion benchmark", "Section"), table(["Measurement", "Observed value"], [
            ["Valid lines / rejected", f"{med['rows']:,} / {med['malformed']:,}"],
            ["Elapsed processing", f"{med['duration_s']:.2f} s"], ["Valid rows per second", f"{med['rows_per_s']:,.0f}"],
            ["Source read throughput", f"{med['mb_per_s']:.2f} MB/s"],
        ])],
        "[[utility-table]]": [table(["Configuration", "Mean F1", "F1 SD", "Detection AUC", "Membership AUC", "Mean epsilon"],
          [[row["configuration"], *[f"{float(row[key]):.3f}" if row[key] else "—" for key in
              ("mean_f1", "sd_f1", "mean_roc_auc", "mean_membership_auc", "mean_epsilon")]]
             for row in summary], [WIDTH * .26, *[WIDTH * .148] * 5]), Spacer(1, 9)],
    }
    count = 0
    for block in re.split(r"\n\s*\n", (RESEARCH / "project-report.md").read_text().strip()):
        if block.startswith("# "):
            count += 1
            story.extend([PageBreak(), paragraph(f"CHAPTER {count:02d}", "Overline"), paragraph(block[2:], "Chapter")])
        elif block.startswith("## "):
            story.append(paragraph(block[3:], "Section"))
        elif block in tokens:
            story.extend(tokens[block])
        else:
            story.append(paragraph(block))
    doc.multiBuild(story)


if __name__ == "__main__":
    build()
