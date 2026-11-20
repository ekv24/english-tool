"""Prepare the pinned Graddy and Lieberman PDF with PyMuPDF and Pillow."""
import hashlib
import json
import re
import unicodedata
from html import escape
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ID = "death-bereavement-and-creativity"
SOURCE = ROOT / ".local" / "originals" / ID / "original.pdf"
OUTPUT = ROOT / ".local" / "materials" / ID
MEDIA = OUTPUT / "media"
META = json.loads((ROOT / "materials" / f"{ID}.json").read_text())
ROUTE = f"/read/{ID}/media/"

# Bounds in points on the pinned edition. Each table stores column cuts and
# vertical boundaries for its caption, headings, body and notes.
TABLES = {
    1: (3, [53, 210, 250, 298, 338, 379, 422, 468, 518, 558], 70, 90, 107, 441, 446, 34),
    2: (4, [53, 184, 223, 267, 307, 344, 390, 436, 472, 517, 559], 70, 90, 107, 262, 267, 16),
    3: (4, [53, 135, 185, 244, 301], 523, 544, 561, 705, 740, 9),
    4: (5, [53, 145, 192, 229, 264, 301], 420, 439, 456, 686, 740, 13),
    5: (5, [310, 401, 439, 478, 516, 558], 651, 670, 688, 723, 740, 3),
    6: (6, [310, 409, 446, 484, 522, 558], 70, 90, 107, 356, 401, 14),
    7: (7, [310, 451, 505, 558], 70, 90, 107, 478, 523, 20),
    8: (8, [53, 199, 252, 301], 70, 90, 107, 478, 523, 20),
    9: (8, [310, 451, 510, 558], 70, 90, 107, 315, 370, 12),
}
FIGURES = {
    1: (5, 312, 556, 70, 84, 247, 269),
    2: (6, 312, 556, 530, 555, 717, 741),
    3: (7, 55, 300, 70, 95, 264, 289),
    4: (8, 312, 556, 534, 559, 717, 741),
}
PALETTE = {
    "#24426f": "#496a89", "#4b732b": "#527450", "#8d2836": "#9a463f",
    "#c21a35": "#ad675c", "#202c4f": "#38312b", "#231f20": "#302a25",
    "#100e0d": "#302a25", "#000000": "#302a25", "#ffffff": "#faf7ef",
}
PAINT = re.compile(r'\b(fill|stroke|stop-color)="([^"]+)"')
COMPOUNDS = set("""age-related art-historical birth-year 20-year confidence-interval
quality-adjusted positive-affect well-known long-term seventh-century
first-stage four-year standard-error time-invariant""".split())


class Layout:
    def __init__(self, page):
        self.lines = [line for block in page.get_text("rawdict")["blocks"]
                      for line in block.get("lines", []) if line["dir"] == (1, 0)]
        # The trace also exposes real punctuation where PDF text grouping
        # otherwise treats a glyph as a layout space.
        self.glyphs = {(round(x, 2), round(y, 2)): chr(code)
                       for span in page.get_texttrace() if span["dir"] == (1, 0)
                       for code, _, (x, y), _ in span["chars"]}

    def span_text(self, span):
        chars = []
        for c in span["chars"]:
            origin = tuple(round(x, 2) for x in c["origin"])
            chars.append(self.glyphs.get(origin, c["c"]) if c["c"].isspace() else c["c"])
        return unicodedata.normalize("NFKC", "".join(chars)).replace("\x03", "=")

    def select(self, box):
        left, top, right, bottom = box
        lines = (line for line in self.lines if left <= line["bbox"][0] < right
                 and top <= line["bbox"][1] < bottom)
        return sorted(lines, key=lambda line: (line["bbox"][1], line["bbox"][0]))

    def plain(self, line):
        return "".join(self.span_text(span) for span in line["spans"]).strip()

    def runs(self, line, note_links=False):
        spans = line["spans"]
        baseline = max(spans, key=lambda span: span["size"])["origin"][1]
        out = []
        for span in spans:
            text = self.span_text(span)
            font = span["font"]
            raised = span["flags"] & 1 or span["origin"][1] < baseline - 0.9
            if raised and text.strip():
                tag = "note" if note_links and text.strip().isdigit() else "sup"
            elif span["origin"][1] > baseline + 0.9:
                tag = "sub"
            elif "Ital" in font:
                tag = "em"
            else:
                tag = ""
            out.extend((char, tag) for char in text)
        return trim(out)


def trim(runs):
    start, end = 0, len(runs)
    while start < end and runs[start][0].isspace():
        start += 1
    while end > start and runs[end-1][0].isspace():
        end -= 1
    return runs[start:end]


def join_lines(lines):
    out = []
    for runs in lines:
        if not runs:
            continue
        if out:
            previous = "".join(char for char, _ in out)
            current = "".join(char for char, _ in runs)
            left = re.search(r"([\w-]+)-$", previous)
            right = re.match(r"(\w+)", current)
            if left and right:
                pair = f"{left[1]}-{right[1]}".lower()
                if pair not in COMPOUNDS and not (left[1][-1:].isdigit() and right[1].isdigit()):
                    out.pop()
            elif not (previous.endswith((".", "/")) and re.search(r"https?://\S+$", previous)):
                out.append((" ", ""))
        out.extend(runs)
    return out


def markup(runs):
    out = []
    tag = ""
    buffer = ""
    for char, style in [*runs, ("", None)]:
        if style != tag:
            value = escape(buffer)
            if tag == "note":
                out.append(f'<sup><a href="#note-{buffer.strip()}">{value}</a></sup>')
            elif tag:
                out.append(f"<{tag}>{value}</{tag}>")
            else:
                out.append(value)
            buffer, tag = "", style
        buffer += char
    return "".join(out)


def paragraph(runs):
    text = markup(join_lines(runs))
    text = re.sub(r"\b(Table|Figure) ([1-9])\b",
                  lambda m: f'<a href="#{m[1].lower()}-{m[2]}">{m[0]}</a>', text)
    text = re.sub(r"\b(Equation \(1\))", r'<a href="#equation-1">\1</a>', text)
    return f"<p>{text}</p>"


def region(layout, box):
    return markup(join_lines(layout.runs(line) for line in layout.select(box)))


def source_links(text, page):
    urls = {link['uri'] for link in page.get_links() if 'uri' in link}
    for url in sorted(urls, key=len, reverse=True):
        url = url.replace('http:www.', 'http://www.')
        if not url.startswith(('http://', 'https://', 'mailto:')):
            continue
        label = url.removeprefix('mailto:')
        pattern = r'\s*'.join(map(re.escape, escape(label)))
        text = re.sub(pattern, lambda _: f'<a href="{escape(url)}">{escape(label)}</a>', text)
    return text


def tables(layouts):
    result = {}
    for index, (page, cuts, top, header, first, notes, bottom, count) in TABLES.items():
        layout = layouts[page - 1]
        caption = region(layout, (cuts[0], top, cuts[-1], header))
        header_lines = layout.select((cuts[0], header, cuts[-1], first))
        lines = layout.select((cuts[0], first, cuts[-1], notes))
        begins = [l["bbox"][1] for l in lines if l["bbox"][0] < cuts[0] + 7]
        assert len(begins) + 1 == count, (index, len(begins), count)
        assert begins and begins[0] > first
        row_bounds = [first, *(y - 3 for y in begins[1:]), notes]
        row_lines = [[l for l in lines if y0 <= l["bbox"][1] < y1]
                     for y0, y1 in zip(row_bounds, row_bounds[1:])]

        def cells(entries):
            collected = [[] for _ in range(len(cuts) - 1)]
            for line in entries:
                by_column = [[] for _ in collected]
                for span in line["spans"]:
                    for char in span["chars"]:
                        x = char["origin"][0]
                        column = next((j for j in range(len(collected)) if cuts[j] <= x < cuts[j+1]), None)
                        if column is not None:
                            by_column[column].append({**span, "chars": [char]})
                for j, spans in enumerate(by_column):
                    if spans:
                        runs = layout.runs({"spans": spans})
                        if runs:
                            collected[j].append(runs)
            output = []
            for j, parts in enumerate(collected):
                if j == 0:
                    output.append(markup(join_lines(parts)))
                else:
                    output.append("<br>".join(markup(part) for part in parts))
            return output

        headings = cells(header_lines)
        table = [f'<figure id="table-{index}" class="book-article">',
                 f'<figcaption id="table-{index}-caption">{caption}</figcaption>',
                 f'<div class="book-table" tabindex="0" role="region" aria-labelledby="table-{index}-caption">',
                 '<table><thead><tr>',
                 *(f'<th scope="col" style="white-space:nowrap">{label}</th>' for label in headings),
                 '</tr></thead><tbody>']
        for entries in row_lines:
            label, *values = cells(entries)
            assert label, (index, entries)
            table.extend(['<tr>', f'<th scope="row" style="min-width:11rem;overflow-wrap:normal">{label}</th>',
                          *(f'<td style="white-space:nowrap;text-align:end">{v}</td>' for v in values), '</tr>'])
        table.append('</tbody></table></div>')
        note = region(layout, (cuts[0], notes, cuts[-1], bottom))
        if note:
            table.append(f'<p style="font:13px/1.5 var(--sans)">{note}</p>')
        table.append('</figure>')
        result[index] = "".join(table)
    return result


def figures(document, layouts):
    result = {}
    for number, (page, left, right, title, top, bottom, note_end) in FIGURES.items():
        box = fitz.Rect(left, top, right, bottom)
        with fitz.open() as crop:
            view = crop.new_page(width=box.width, height=box.height)
            view.show_pdf_page(view.rect, document, page - 1, clip=box)
            svg = view.get_svg_image(text_as_path=True)
        assert not re.search(r"<(?:script|foreignObject|a)\b|\son\w+\s*=", svg, re.I)
        assert all(href.startswith(("#", "data:image/png;base64,"))
                   for href in re.findall(r'(?:xlink:)?href="([^"]+)"', svg))
        root_end = svg.index(">") + 1
        original = svg[:root_end] + '<rect width="100%" height="100%" fill="#ffffff"/>' + svg[root_end:]
        styled = re.sub(r'(<path\b[^>]*stroke-dasharray="5,10\.01"[^>]*stroke=")#231f20',
                        r'\g<1>#b0a596', original)
        styled = PAINT.sub(lambda m: f'{m[1]}="{PALETTE.get(m[2].lower(), m[2])}"', styled)
        assert PAINT.sub("", original) == PAINT.sub("", styled)
        stem = f"figure-{number}"
        (MEDIA / f"{stem}-original.svg").write_text(original)
        (MEDIA / f"{stem}.svg").write_text(styled)
        heading = region(layouts[page - 1], (left, title, right, top))
        note = region(layouts[page - 1], (left, bottom, right, note_end))
        result[number] = (f'<figure id="{stem}"><img src="{ROUTE}{stem}.svg" '
                          f'data-original="{stem}-original.svg" width="{int(box.width)}" '
                          f'height="{int(box.height)}" alt="{escape(re.sub("<[^>]+>", "", heading), quote=True)}">'
                          f'<figcaption>{heading}<br>{note}</figcaption></figure>')
        if number == 1:
            with fitz.open(stream=styled.encode(), filetype="svg") as image:
                pix = image[0].get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
                plot = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            ImageOps.pad(plot, (480, 360), color="#faf7ef").save(MEDIA / META["previewMedia"])
    return result


def equation():
    def sub(symbol, lower):
        return f"<msub><mi>{symbol}</mi><mrow>{lower}</mrow></msub>"

    def name(symbol, lower="i"):
        return sub(symbol, f"<mi>{lower}</mi>")

    def alpha(index, variable):
        return sub("α", f"<mn>{index}</mn>") + name(variable)

    def age(power):
        beta = f"<msubsup><mi>β</mi><mn>{power}</mn><mi>c</mi></msubsup>"
        term = name("Age") if power == 1 else f"<msubsup><mi>Age</mi><mi>i</mi><mn>{power}</mn></msubsup>"
        return beta + term

    def total(lower, upper):
        return f"<munderover><mo>∑</mo><mrow>{lower}</mrow><mrow>{upper}</mrow></munderover>"

    def indicator(inner):
        return "<mi>I</mi><mo>(</mo>" + inner + "<mo>)</mo>"

    plus = "<mo>+</mo>"
    equal = "<mo>=</mo>"
    rows = [
        sub("ln(Price)", "<mi>ij</mi>"),
        equal + plus.join(alpha(i, n) for i, n in enumerate(("Prior3", "Prior2", "Prior1"), 1)),
        plus + plus.join(alpha(i, n) for i, n in enumerate(("Current", "After1", "After2", "After3"), 4)),
        plus + total("<mi>c</mi><mo>=</mo><mn>1</mn>", "<mn>4</mn>") + "<mo>[</mo>"
        + plus.join(map(age, range(1, 5))) + "<mo>]</mo>" + indicator(name("cohort") + equal + "<mi>C</mi>"),
        plus + total("<mi>k</mi><mo>=</mo><mn>1</mn>", "<mn>48</mn>") + name("ψ", "k")
        + indicator("<mi>i</mi>" + equal + "<mi>k</mi>") + plus
        + total("<mi>y</mi><mo>=</mo><mn>1972</mn>", "<mn>2014</mn>") + name("θ", "y")
        + indicator(name("Sale_year", "j") + equal + "<mi>y</mi>"),
        plus + total("<mi>y</mi><mo>=</mo><mn>1840</mn>", "<mi>y</mi><mo>=</mo><mn>1972</mn>")
        + name("ω", "y") + indicator(name("Painting_date")) + plus
        + name("ϵ", "ij") + "<mo>.</mo>",
    ]
    content = "".join("<mtr><mtd>" + row + "</mtd></mtr>" for row in rows)
    return ('<figure id="equation-1"><div class="math" role="region" tabindex="0" aria-label="Equation 1" '
            'style="overflow:auto;max-width:100%;padding:12px 0">'
            '<math display="block"><mtable columnalign="left">' + content +
            '</mtable></math></div><figcaption>Equation (1) · '
            f'<a href="/read/{ID}/original.pdf#page=4">PDF, pages 4–5 ↗</a></figcaption></figure>')


def article(document, layouts, table, figure):
    first = layouts[0]
    names = region(first, (55, 132, 560, 145))
    affil = region(first, (55, 146, 562, 170))
    contact = source_links(region(first, (55, 170, 562, 190)), document[0])
    abstract = region(first, (195, 198, 562, 319)).removeprefix("Abstract. ")
    history = region(first, (195, 320, 560, 344))
    history = history.replace(META["source"], f'<a href="{META["source"]}">{META["source"]}</a>')
    dates = region(first, (55, 199, 195, 282))
    dates = dates.replace(META["source"], f'<a href="{META["source"]}">{META["source"]}</a>')
    keywords = region(first, (55, 350, 560, 362))
    out = [f"<p><strong>{names}</strong></p>", f"<p><small>{affil}<br>{contact}</small></p>",
           '<section id="abstract"><h2>Abstract</h2>', f"<p>{abstract}</p>",
           f"<p><small>{history}</small></p>", f"<p><small>{dates}</small></p>",
           f"<p>{keywords}</p></section>"]
    pending = []
    floats = []
    section = False

    def flush():
        if pending:
            text = paragraph(pending)
            out.append(source_links(text, document[9]) if text.startswith('<p>Stamberg') else text)
            pending.clear()
        out.extend(floats)
        floats.clear()

    def heading(label, anchor, level):
        nonlocal section
        flush()
        if section:
            out.append("</section>")
        out.append(f'<section id="{anchor}"><h{level}>{escape(label)}</h{level}>')
        section = True

    def prose(page, right=False, top=69, bottom=745):
        layout = layouts[page - 1]
        left = 310 if right else 53
        base = 314.82 if right else 57.78
        lines = layout.select((left, top, 558 if right else 301, bottom))
        skip = False
        for pos, line in enumerate(lines):
            if skip:
                skip = False
                continue
            text = layout.plain(line)
            if not text:
                continue
            font = line["spans"][0]["font"]
            if font == "TeXGyreHeros-Bold":
                num = re.match(r"(\d+(?:\.\d+)?)[.] ", text)
                if num:
                    label = num[1]
                    if label == "6.3":
                        assert layout.plain(lines[pos + 1]) == "Modern Americans"
                        text += " Modern Americans"
                        skip = True
                    heading(text, "section-" + label.replace(".", "-"), 3 if "." in label else 2)
                    continue
                if text == "Acknowledgments":
                    heading(text, "acknowledgments", 2)
                    continue
            if 6 < line["bbox"][0] - base < 13:
                flush()
            pending.append(layout.runs(line, note_links=True))

    prose(1, top=377)
    prose(1, right=True, top=377)
    prose(2)
    prose(2, right=True)
    floats.append(table[1])
    prose(3, top=452)
    prose(3, right=True, top=452)
    floats.append(table[2])
    prose(4, top=270, bottom=522)
    floats.append(table[3])
    prose(4, right=True, top=270, bottom=660)
    flush()
    out.append(equation())
    prose(5, top=146, bottom=411)
    floats.extend([table[4], figure[1]])
    prose(5, right=True, top=280, bottom=643)
    floats.append(table[5])
    prose(6)
    floats.append(table[6])
    prose(6, right=True, top=407, bottom=520)
    floats.append(figure[2])
    floats.append(figure[3])
    prose(7, top=299)
    floats.append(table[7])
    prose(7, right=True, top=533)
    floats.append(table[8])
    prose(8, top=532)
    floats.append(table[9])
    prose(8, right=True, top=381, bottom=528)
    floats.append(figure[4])
    prose(9)
    prose(9, right=True, bottom=132)
    heading("Endnotes", "endnotes", 2)
    layout = layouts[8]
    notes = []
    for line in layout.select((310, 148, 558, 745)):
        lead = layout.span_text(line["spans"][0])
        if lead.isdigit() and line["spans"][0]["font"] == "TeXGyreHeros-Bold":
            notes.append((lead, []))
            line = {**line, "spans": line["spans"][1:]}
        if line["spans"]:
            notes[-1][1].append(layout.runs(line))
    assert [int(num) for num, _ in notes] == list(range(1, 15))
    out.append('<ol>')
    for num, lines in notes:
        note = source_links(markup(join_lines(lines)), document[8])
        out.append(f'<li id="note-{num}">{note}</li>')
    out.append('</ol>')

    heading("References", "references", 2)
    layout = layouts[9]
    for right in (False, True):
        x = 314.82 if right else 57.78
        for line in layout.select((x - 3, 69 if right else 83, 557 if right else 300, 389)):
            if abs(line["bbox"][0] - x) < 1.5:
                flush()
            pending.append(layout.runs(line))
    flush()
    out.append("</section>")
    return "\n".join(out) + "\n"


def main():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == META["sha256"]
    with fitz.open(SOURCE) as document:
        assert len(document) == 10
        layouts = list(map(Layout, document))
        table = tables(layouts)
        MEDIA.mkdir(parents=True, exist_ok=True)
        figure = figures(document, layouts)
        body = article(document, layouts, table, figure)
        ids = re.findall(r'\bid="([^"]+)"', body)
        assert len(set(ids)) == len(ids)
        assert set(re.findall(r'href="#([^"]+)"', body)) <= set(ids)
        assert len(table) == 9 and len(figure) == 4
        quiz = json.loads((ROOT / "materials" / f"{ID}.quiz.json").read_text())
        assert {item["anchor"] for item in quiz} <= set(ids)
        (OUTPUT / "article.html").write_text(body)
        (OUTPUT / "metadata.json").write_text(json.dumps(META, ensure_ascii=False, indent=2) + "\n")
        print(f"Prepared {len(document)} pages, {len(table)} tables and {len(figure)} plots.")


if __name__ == "__main__":
    main()
