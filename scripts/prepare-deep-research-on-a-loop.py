"""Prepare the pinned DRIL author PDF. Requires pdfplumber, pypdf, pypdfium2 and Pillow."""
import hashlib
import json
import re
import unicodedata
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape, quoteattr

import pdfplumber
import pypdfium2
from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf.generic import FloatObject

ROOT = Path(__file__).resolve().parents[1]
ID = "deep-research-on-a-loop"
META = json.loads((ROOT / "materials" / f"{ID}.json").read_text())
SOURCE = ROOT / ".local" / "originals" / ID / "original.pdf"
DEST = ROOT / ".local" / "materials" / ID
MEDIA = DEST / "media"

# Crop rectangles in PDF points (left, top, right, bottom).
FIGURES = {
    4: ((122, 68, 490, 237), (70, 240, 526, 279), "figure.caption.1",
        "Figure 1. Three tiers of AI involvement"),
    5: ((108, 68, 487, 229), (70, 233, 526, 273), "figure.caption.2",
        "Figure 2. The DRIL architecture"),
    7: ((351, 69, 480, 188), (305, 193, 526, 269), "figure.caption.8",
        "Figure 3. Sources retrieved per unit"),
}

# These compounds actually retain the visible hyphen at a column or line wrap.
COMPOUNDS = set("""
218-jurisdiction agent-driven agent-produced chunk-review companion-metadata
data-and-code deep-research design-stage document-parsing four-tier GPT-5
item-level judge-case open-ended re-execution
revenue-foregone two-stage value-added
report-level negative-search tax-expenditure
""".lower().split())

# LaTeX exports a few manually positioned accents as separate characters.
ACCENTS = {
    "Bojic´": "Bojić", "Vukovic´": "Vuković", "Cˇ abarkapa": "Čabarkapa",
    "Cˇabarkapa": "Čabarkapa", "Cˇ abrilo": "Čabrilo", "Cˇabrilo": "Čabrilo",
    "Maric´": "Marić", "Veseljevic´": "Veseljević", "Jerkovic´": "Jerković",
    "Jovancˇevic´": "Jovančević", "Sˇ": "Š", "Zˇ": "Ž",
}

PALETTE = {
    (.839, .894, .941): "#e1e9ed",
    (.290, .486, .710): "#48657b",
    (.831, .647, .455): "#9d5b33",
    (.941, .957, 1): "#f1e7dd",
    (.961, .961, .961): "#f0eae0",
    (1, .953, .878): "#f2e4d1",
    (.910, .918, .965): "#eae5ee",
}


def linkbox(page, annotation):
    action = annotation.get_object().get("/A", {})
    target = action.get("/D")
    uri = action.get("/URI", "")
    if isinstance(target, str):
        href = "#" + target
    elif uri and urlsplit(uri).scheme in {"https", "http"}:
        href = uri
    else:
        return None
    x0, y0, x1, y1 = annotation.get_object()["/Rect"]
    return (float(x0), page.height - float(y1), float(x1), page.height - float(y0), href)


def lines(page, box):
    x0, y0, x1, y1 = box
    inside = page.filter(lambda c: c["object_type"] == "char"
                         and x0 <= (c["x0"] + c["x1"]) / 2 < x1
                         and y0 <= (c["top"] + c["bottom"]) / 2 < y1)
    return inside.extract_text_lines(x_tolerance=1.15, y_tolerance=2.5)


def char_style(char, links):
    x = (char["x0"] + char["x1"]) / 2
    y = (char["top"] + char["bottom"]) / 2
    href = next((href for x0, y0, x1, y1, href in links if x0 <= x <= x1 and y0 <= y <= y1), "")
    font = char["fontname"]
    if href in {"#Hfootnote.1", "#Hfootnote.2"}:
        return href, "sup"
    if "Inconsolata" in font:
        return href, "code"
    if "Medi" in font:
        return href, "strong"
    if "Ital" in font or "CMMI" in font:
        return href, "em"
    return href, ""


def styled_line(line, links):
    # The text map points to the same PDF glyph for every letter in a ligature.
    chars = list({id(char): char for char in line["chars"]}.values())
    result = []
    for index, char in enumerate(chars):
        word_gap = index and char["x0"] - chars[index - 1]["x1"] > 1.15
        if word_gap:
            previous_style = result[-1][1]
            current_style = char_style(char, links)
            if previous_style[1] != "sup" and current_style[1] != "sup":
                result.append((" ", current_style if current_style == previous_style else ("", "")))
        style = char_style(char, links)
        result.extend((value, style) for value in char["text"])
    return result


def join_lines(items):
    joined = []
    for item in items:
        if not item:
            continue
        if joined:
            left = re.search(r"([\w–-]+)-$", "".join(c for c, _ in joined))
            right = re.match(r"[\w-]+", "".join(c for c, _ in item))
            if left and right:
                if (left[1] + "-" + right[0]).lower() not in COMPOUNDS:
                    joined.pop()
            elif not (joined[-1][0] == "–" and item[0][0].isdigit()):
                last_style, next_style = joined[-1][1], item[0][1]
                joined.append((" ", last_style if last_style == next_style else ("", "")))
        joined.extend(item)
    return joined


def markup(chars, styles=True):
    html = []
    run = ""
    previous = ("", "")
    for value, style in [*chars, ("", (None, None))]:
        if style != previous:
            if run:
                run = re.sub(r" ?[\u0301´]", "´", run)
                for before, after in ACCENTS.items():
                    run = run.replace(before, after)
                contents = escape(unicodedata.normalize("NFKC", run))
                href, tag = previous
                if tag and styles:
                    contents = f"<{tag}>{contents}</{tag}>"
                if href:
                    contents = f"<a href={quoteattr(href)}>{contents}</a>"
                html.append(contents)
            run = ""
        previous = style
        run += value
    return "".join(html)


def fragment(page, box, links=(), styles=True):
    return markup(join_lines([styled_line(line, links) for line in lines(page, box)]), styles)


def crop_image(page, box):
    x0, top, x1, bottom = box
    return page.render(scale=3, crop=(x0, page.get_height() - bottom,
                                       page.get_width() - x1, top)).to_pil().convert("RGB")


def recolored_page(pdf, index):
    writer = PdfWriter()
    page = writer.add_page(pdf.pages[index])
    content = page.get_contents()
    for operands, operator in content.operations:
        if operator in {b"rg", b"RG"}:
            color = PALETTE.get(tuple(round(float(part), 3) for part in operands))
            if color:
                operands[:] = [FloatObject(int(color[i:i+2], 16)/255) for i in (1, 3, 5)]
        elif operator in {b"g", b"G"} and float(operands[0]) == 0:
            operands[0] = FloatObject(.16)
        elif operator == b"g" and float(operands[0]) == 1:
            operands[0] = FloatObject(.98)
    page.replace_contents(content)
    output = BytesIO()
    writer.write(output)
    return pypdfium2.PdfDocument(output.getvalue())


def histogram():
    bins = [("6–8", 5), ("9–11", 33), ("12–14", 34), ("15–17", 12), ("18–20", 2)]
    baseline = 226
    pieces = ['<svg xmlns="http://www.w3.org/2000/svg" width="540" height="310" viewBox="0 0 540 310">',
              '<rect width="540" height="310" fill="#faf7ef"/>',
              '<g font-family="system-ui,sans-serif" text-anchor="middle" fill="#302a25">']
    for tick in (10, 20, 30):
        y = baseline - tick * 5.25
        pieces.append(f'<path d="M44 {y}H496" stroke="#ded8cb"/>')
    for index, (label, count) in enumerate(bins):
        x = 53 + 89 * index
        height = count * 5.25
        y = baseline - height
        pieces.extend([
            f'<rect x="{x}" y="{y}" width="78" height="{height}" fill="#b9cbd5" stroke="#48657b"/>',
            f'<text x="{x+39}" y="{y-8}" font-size="19">{count}</text>',
            f'<text x="{x+39}" y="251" font-size="19">{label}</text>',
        ])
    pieces.extend(['<path d="M44 226H496" stroke="#302a25"/>',
                   '<text x="270" y="286" font-size="21">Sources retrieved per unit</text></g></svg>'])
    return "".join(pieces)


def figure(pdf, pdf_image, page):
    number = page.page_number
    box, caption_box, anchor, label = FIGURES[number]
    stem = f"figure-{list(FIGURES).index(number)+1}"
    original_name = stem + "-original.png"
    original = crop_image(pdf_image[number - 1], box)
    original.save(MEDIA / original_name)
    if number == 7:
        filename = stem + ".svg"
        (MEDIA / filename).write_text(histogram())
    else:
        filename = stem + ".png"
        recolored = recolored_page(pdf, number - 1)
        updated = crop_image(recolored[0], box)
        assert updated.size == original.size
        updated.save(MEDIA / filename)
        if number == 5:
            implementation_stage = updated.crop((522, 0, updated.width, updated.height))
            preview = ImageOps.contain(implementation_stage, (738, 536), Image.Resampling.LANCZOS)
            card = Image.new("RGB", (768, 576), "#faf7ef")
            card.paste(preview, tuple((a-b)//2 for a, b in zip(card.size, preview.size)))
            card.save(MEDIA / META["previewMedia"])
    caption = fragment(page, caption_box)
    return (f'<figure id="{anchor}"><img src="/read/{ID}/media/{filename}" '
            f'data-original="{original_name}" width="{540 if number == 7 else original.width}" '
            f'height="{310 if number == 7 else original.height}" alt={quoteattr(label)}>'
            f'<figcaption>{caption}</figcaption></figure>')


def table(page):
    cols = (305, 373, 454, 526)
    rows = (71, 100, 130, 160, 210, 250, 285)
    parts = ['<figure id="table.caption.7"><div role="table" aria-label="Table 1">']
    for index, (y0, y1) in enumerate(zip(rows, rows[1:])):
        parts.append('<div role="row">')
        for column, (x0, x1) in enumerate(zip(cols, cols[1:])):
            role = "columnheader" if index == 0 else "rowheader" if column == 0 else "cell"
            parts.append(f'<div role="{role}">' + fragment(page, (x0, y0, x1, y1)) + '</div>')
        parts.append('</div>')
    parts.append('</div><figcaption>' + fragment(page, (305, 290, 526, 318)) + '</figcaption></figure>')
    return "".join(parts)


def evidence_box(page):
    bounds = (72, 84, 94, 114, 122, 130, 162, 180, 189, 197, 220, 247, 282)
    paragraphs = [fragment(page, (73, a, 288, b)) for a, b in zip(bounds, bounds[1:])]
    return ('<blockquote id="figure.caption.9">' +
            "".join(f"<p>{p}</p>" for p in paragraphs if p) + "</blockquote>")


def body(pdf, pdf_image, layout):
    page = layout.pages[0]
    output = ['<div aria-label="Authors">']
    for x0, top, x1 in ((70, 105, 299), (300, 105, 526), (70, 159, 299), (300, 159, 526)):
        author, affiliation, email = [l["text"] for l in lines(page, (x0, top, x1, top+44))]
        name = escape(author.rstrip("*"))
        if author.endswith("*"):
            name += '<sup><a href="#Hfootnote.1">*</a></sup>'
        output.append(f'<p><strong>{name}</strong><br>{escape(affiliation)}<br>'
                      f'<a href="mailto:{escape(email)}">{escape(email)}</a></p>')
    output.append('</div>')
    pending = []
    pending_id = ""
    side_content = []
    section_open = False
    in_references = False

    def flush():
        nonlocal pending_id
        if pending:
            attr = f' id={quoteattr(pending_id)}' if pending_id else ""
            output.append(f"<p{attr}>" + markup(join_lines(pending)) + "</p>")
            pending.clear()
            pending_id = ""
        output.extend(side_content)
        side_content.clear()

    for page in layout.pages:
        number = page.page_number
        annotations = pdf.pages[number-1].get("/Annots", [])
        links = [box for annotation in annotations if (box := linkbox(page, annotation))]
        citations = [
            (float(dest.left), page.height - float(dest.top), name)
            for name, dest in pdf.named_destinations.items()
            if name.startswith("cite.") and pdf.get_destination_page_number(dest) + 1 == number
        ]
        for right in (False, True):
            if not right:
                top = {1: 218, 4: 296, 5: 290, 8: 300}.get(number, 0)
                x0, x1 = 0, 303
            else:
                top = {1: 218, 4: 296, 5: 290, 6: 334, 7: 290}.get(number, 0)
                x0, x1 = 303, page.width

            if not right and number in {4, 5} or right and number == 7:
                side_content.append(figure(pdf, pdf_image, page))
            if right and number == 6:
                side_content.append(table(page))
            if not right and number == 8:
                side_content.append(evidence_box(page))

            bottom = 688 if number == 7 and not right else 755 if number == 1 and not right else 779
            entries = lines(page, (x0, top, x1, bottom))
            for line in entries:
                value = line["text"]
                first = line["chars"][0]
                y = first["top"]
                bold = "Medi" in first["fontname"]
                base_x = 306.142 if right else 70.866
                section = re.match(r"^(\d(?:\.\d)?|A) ", value) if bold else None
                if section or value in {"Abstract", "Limitations", "Ethical considerations", "References"}:
                    flush()
                    if section_open:
                        output.append("</section>")
                    label = section[1] if section else ""
                    heading = "h3" if "." in label else "h2"
                    anchor = ("subsection." + label if heading == "h3" else
                              "appendix.A" if label == "A" else "section." + label if label else
                              value.lower().replace(" ", "-"))
                    in_references = value == "References"
                    output.append(f'<section id="{anchor}"><{heading}>{escape(value)}</{heading}>')
                    section_open = True
                    continue
                if in_references:
                    starts = abs(line["x0"] - base_x) < 1.6
                else:
                    starts = 9 < line["x0"] - base_x < 13 or (bold and not (
                        number == 3 and right and value.startswith(("pipelines.", "ecutors."))))
                if starts:
                    flush()
                    if in_references:
                        pending_id = next((name for x, yy, name in citations
                                           if abs(x + 5 - base_x) < 1 and abs(y - yy) < 10), "")
                pending.append(styled_line(line, links))
            if number == 1 and not right:
                side_content.append('<p id="Hfootnote.1"><small>*Corresponding author.</small></p>')
            if number == 7 and not right:
                note = fragment(page, (70, 691, 293, 776))
                note = re.sub(r"^1 ?", "<sup>1</sup> ", note)
                side_content.append(f'<p id="Hfootnote.2"><small>{note}</small></p>')

    flush()
    if section_open:
        output.append("</section>")
    return "\n".join(output) + "\n"


def main():
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != META["sha256"]:
        raise SystemExit("The original PDF does not match the pinned edition.")
    MEDIA.mkdir(parents=True, exist_ok=True)
    pdf = PdfReader(SOURCE)
    pdf_image = pypdfium2.PdfDocument(SOURCE)
    with pdfplumber.open(SOURCE) as layout:
        article = body(pdf, pdf_image, layout)
    (DEST / "article.html").write_text(article)
    (DEST / "metadata.json").write_text(json.dumps(META, ensure_ascii=False, indent=2) + "\n")
    print(f"Prepared {ID}: {len(pdf.pages)} pages")


if __name__ == "__main__":
    main()
