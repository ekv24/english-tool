#!/usr/bin/env python3
"""Prepare the 2005 Taylor & Francis e-Library edition of Hamming's book."""

import hashlib
import json
import re
from html import escape
from pathlib import Path
from tempfile import TemporaryDirectory

import pymupdf as pdf


ROOT = Path(__file__).resolve().parents[1]
BOOK = 'the-art-of-doing-science-and-engineering'
ROUTE = '/books/' + BOOK
ORIGINAL = ROOT / '.local/originals' / BOOK / 'original.pdf'
SOURCE = 'https://worrydream.com/refs/Hamming_1997_-_The_Art_of_Doing_Science_and_Engineering.pdf'
REVISION = 'ead5a25373124c37fe3e37726e78b5ab043775d0ff5f793ec159bca6c13f54eb'
TARGET = ROOT / '.local/books' / BOOK

# Bounds are in PDF points and include the original rules and cell labels.
TABLES = {
    13: [(345, 475)], 16: [(565, 592)], 17: [(46, 223)], 19: [(132, 187)],
    29: [(96, 164), (245, 326)], 37: [(300, 329)], 40: [(445, 551)],
    68: [(293, 445)], 70: [(346, 510)], 88: [(509, 589)],
    92: [(345, 477), (535, 589)], 93: [(49, 67), (248, 301)],
    94: [(48, 122), (288, 343), (541, 589)], 95: [(48, 135)], 102: [(204, 278)],
}
INLINE_FORMULAS = {15, 30, 67, 68, 101, 155}
CAPTION = re.compile(r'^Figure\s+\d+\.\s*[IVXlL0-9]+\b', re.IGNORECASE)


def plain(line):
    return ''.join(char['c'] for span in line['spans'] for char in span['chars']).strip()


def slug(title):
    return re.sub('[^a-z0-9]+', '-', title.lower()).strip('-')


def read_contents(document):
    printed_titles = {}
    contents = ' '.join(page.get_text() for page in (document[4], document[5]))
    rows = re.findall(r'(?:^|\n)\s*(\d{1,2})[ \t]*\n([^\n]+)\n\s*(\d+)', contents)
    for number, title, printed_page in rows:
        printed_titles[int(number)] = (title.strip(), int(printed_page) + 9)

    bookmarks = document.get_toc()
    if set(printed_titles) != set(range(1, 31)) or len(bookmarks) != 38:
        raise ValueError('Unexpected table of contents or PDF bookmarks')

    sections = []
    for _, label, start in bookmarks:
        number, _, _ = label.partition(' ')
        if number.isdecimal():
            title, listed_page = printed_titles[int(number)]
            if listed_page != start:
                raise ValueError(f'Contents and bookmark disagree for chapter {number}')
            item = {'slug': f'{int(number):02}-{slug(title)}', 'number': number,
                    'title': f'{number} - {title}', 'type': 'chapter'}
        else:
            item = {'slug': slug(label), 'title': label,
                    'type': 'intro' if label in {'Preface', 'Introduction'} else 'appendix'}
        sections.append((start, {**item, 'original': f'#page={start}'}))
    return sections


def render_span(span, baseline, links):
    runs = []
    for char in span['chars']:
        rect = pdf.Rect(char['bbox'])
        midpoint = pdf.Point((rect.x0 + rect.x1) / 2, char['origin'][1] - 3)
        href = next((href for box, href in links if box.contains(midpoint)), '')
        if runs and runs[-1][0] == href:
            runs[-1][1].append(char['c'])
        else:
            runs.append((href, [char['c']]))
    body = ''.join(f'<a href="{escape(href)}">{escape("".join(chars))}</a>' if href else
                   escape(''.join(chars)) for href, chars in runs)
    if span['size'] < 8 and baseline - span['origin'][1] > 1:
        body = f'<sup>{body}</sup>'
    elif span['size'] < 8 and span['origin'][1] - baseline > 1:
        body = f'<sub>{body}</sub>'
    if 'Italic' in span['font']:
        body = f'<em>{body}</em>'
    if 'Bold' in span['font']:
        body = f'<strong>{body}</strong>'
    return body


def render_line(line, links):
    baseline = max(line['spans'], key=lambda span: span['size'])['origin'][1]
    return ''.join(render_span(span, baseline, links) for span in line['spans']).strip()


def graphic(page, box, images, index, label, inline=False):
    clip = (pdf.Rect(box) + (-1, -1, 1, 1)) & page.rect
    pixmap = page.get_pixmap(matrix=pdf.Matrix(3, 3), clip=clip, annots=False)
    name = f'p{page.number + 1:03}-{index:02}.png'
    pixmap.save(images / name)
    url = ROUTE + '/images/' + name
    width, height = round(clip.width * 1.6), round(clip.height * 1.6)
    attributes = (f'src="{url}" alt="{escape(label)}" width="{width}" height="{height}"')
    if inline:
        return (f'<img {attributes} style="display:inline;vertical-align:middle;'
                'margin:0" loading="eager">')
    return f'<a href="{url}" target="_blank" rel="noopener"><img {attributes}></a>'


def page_events(page, images, destinations, section_start):
    number = page.number + 1
    raw = page.get_text('rawdict', flags=pdf.TEXTFLAGS_RAWDICT & ~pdf.TEXT_PRESERVE_IMAGES)
    lines = [line for block in raw['blocks'] if block['type'] == 0 for line in block['lines']
             if 39 < line['bbox'][1] < 599 and plain(line)]
    if number == section_start and number >= 7:
        # The chapter label is rendered once as the HTML heading.
        lines = [line for line in lines if line['bbox'][1] >= 100]

    links = [(entry['from'], destinations[entry['page'] + 1]) for entry in page.get_links()
             if entry.get('page', -1) >= 0]
    boxes = [pdf.Rect(item['bbox']) for item in page.get_image_info()]
    events = []
    for top, bottom in TABLES.get(number, ()):
        lines = [line for line in lines if not top <= line['bbox'][1] < bottom]
        boxes = [box for box in boxes if not top <= box.y0 < bottom]
        events.append((top, 'table', pdf.Rect(52, top, 488, bottom)))

    rows = []
    for line in sorted(lines, key=lambda line: line['bbox'][1]):
        top = line['bbox'][1]
        if not rows or top - rows[-1][0] > 1.8:
            rows.append((top, []))
        rows[-1][1].append((line['bbox'][0], render_line(line, links), plain(line), line['bbox'][2]))

    for index, box in enumerate(boxes, 1):
        if number in INLINE_FORMULAS and box.width < 55:
            row = next((pieces for top, pieces in rows if box.y0 - 2 <= top < box.y1 - 6), None)
            if row is not None:
                row.append((box.x0, graphic(page, box, images, index, 'Inline notation', True), ' ', box.x1))
                continue
        events.append((box.y0, 'graphic', (index, box)))

    for top, pieces in rows:
        pieces.sort()
        events.append((top, 'line', pieces))
    return sorted(events, key=lambda event: event[0])


def render_pages(document, start, end, item, images, destinations):
    heading = item['title'].split(' - ', 1)[-1] if item.get('number') else item['title']
    prefix = f'<p class="meta">Chapter {item["number"]}</p>\n' if item.get('number') else ''
    output = [prefix + f'<h1>{escape(heading)}</h1>']
    paragraph = []
    last_text = ''
    last_right = 0
    last_top = 0
    last_left = 0
    figures = []

    def finish_paragraph():
        if paragraph:
            output.append('<p>' + ''.join(paragraph) + '</p>')
            paragraph.clear()

    def finish_figures(caption='', label=''):
        if not figures:
            return
        body = ''.join(graphic(page, box, images, index, label or 'Original illustration or notation')
                       for page, index, box in figures)
        if caption:
            body += f'<figcaption>{caption}</figcaption>'
        output.append(f'<figure class="book-figure">{body}</figure>')
        figures.clear()

    for number in range(start, end):
        page = document[number - 1]
        anchor = f'<span id="pdf-page-{number}"></span>'
        if number <= 6:
            output.append(anchor + '<figure class="book-figure">'
                          + graphic(page, page.rect, images, 1, item['title']) + '</figure>')
            continue
        if item['slug'] == 'index':
            output.append(anchor)
            for left, right in ((52, 269), (271, 488)):
                rect = pdf.Rect(left, 40 if number > start else 100, right, 598)
                output.extend(f'<p>{escape(line)}</p>' for line in page.get_text(clip=rect).splitlines()
                              if line.strip())
            continue

        new_page = True
        for top, kind, content in page_events(page, images, destinations, start):
            if kind != 'line':
                finish_paragraph()
                if new_page:
                    output.append(anchor)
                    new_page = False
                if kind == 'graphic':
                    index, box = content
                    figures.append((page, index, box))
                else:
                    finish_figures()
                    name = 'Table from the original edition'
                    output.append('<figure class="book-figure">'
                                  + graphic(page, content, images, 90 + int(top) // 10, name) + '</figure>')
                continue

            left, _, _, _ = content[0]
            body = ' '.join(piece[1] for piece in content).strip()
            wording = ' '.join(piece[2] for piece in content).strip()
            if CAPTION.match(wording) and figures:
                finish_figures(body, wording)
                continue
            finish_figures()
            indented = 59 < left < 68
            if new_page:
                if indented or last_right < 464:
                    finish_paragraph()
                    output.append(anchor)
                else:
                    paragraph.append(anchor)
                new_page = False
            elif top - last_top > 17 or (indented and (last_left < 59 or last_right < 464)):
                finish_paragraph()

            if paragraph and not last_text.endswith(('-', '\u00ad')):
                paragraph.append('<br>\n' if indented and last_left > 59 else ' ')
            paragraph.append(body)
            last_text, last_right, last_top, last_left = wording, content[-1][3], top, left
        if new_page:
            output.append(anchor)
        finish_figures()
    finish_paragraph()
    return '\n'.join(output) + '\n'


def prepare():
    if hashlib.sha256(ORIGINAL.read_bytes()).hexdigest() != REVISION:
        raise ValueError('Unexpected source edition; verify page and graphic bounds before importing')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with pdf.open(ORIGINAL) as document, TemporaryDirectory(dir=TARGET.parent.parent) as temporary:
        sections = read_contents(document)
        if len(document) != 227:
            raise ValueError('Unexpected page count')
        output = Path(temporary) / BOOK
        images = output / 'images'
        images.mkdir(parents=True)
        destinations = {}
        for (start, item), (end, _) in zip(sections, sections[1:] + [(len(document) + 1, None)]):
            for number in range(start, end):
                destinations[number] = f'{ROUTE}/{item["slug"]}#pdf-page-{number}'

        for (start, item), (end, _) in zip(sections, sections[1:] + [(len(document) + 1, None)]):
            body = render_pages(document, start, end, item, images, destinations)
            (output / (item['slug'] + '.html')).write_text(body, encoding='utf-8')

        items = [item for _, item in sections]
        first = {'Preface', 'Introduction'}
        chapters = [item for item in items if item['type'] == 'chapter']
        manifest = {
            'id': BOOK, 'title': 'The Art of Doing Science and Engineering',
            'description': 'Learning to Learn', 'author': 'Richard W. Hamming',
            'source': ROUTE + '/original.pdf', 'canonicalSource': SOURCE,
            'sourceEdition': 'Taylor & Francis e-Library, 2005, from the 1997 Gordon and Breach edition.',
            'sourceFilename': 'original.pdf', 'revision': REVISION,
            'copyright': '© 1997 OPA (Overseas Publishers Association)',
            'cover': 'p001-01.png', 'coverOrigin': 'Front cover in the source PDF',
            'figureMethods': {'default': 'Original PDF region, rendered without redrawing.'},
            'items': [item for item in items if item['title'] in first] + chapters
                     + [items[-1]] + [item for item in items[:5]],
            'toc': [
                {'title': 'Introduction', 'entries': [{'slug': 'introduction'}]},
                {'title': 'Chapters', 'entries': [{'slug': item['slug']} for item in chapters]},
                {'title': 'Reference', 'entries': [{'slug': item['slug']} for item in [items[-1], *items[:5]]]},
            ],
        }
        (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                                              encoding='utf-8')
        if TARGET.exists():
            # Publish a complete replacement without leaving stale pages or assets.
            previous = Path(temporary) / 'previous'
            TARGET.rename(previous)
            try:
                output.rename(TARGET)
            except OSError:
                previous.rename(TARGET)
                raise
        else:
            output.rename(TARGET)
    print(f'Prepared {len(chapters)} chapters and {len(items) - len(chapters)} other sections.')


if __name__ == '__main__':
    prepare()
