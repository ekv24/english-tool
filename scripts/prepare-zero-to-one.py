#!/usr/bin/env python3
"""Prepare the attached Calibre edition using Poppler's text and image coordinates."""

import argparse
from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha256
from html import escape
from pathlib import Path
from shutil import copyfile
from subprocess import run
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from xml.etree import ElementTree
import json
import re


ROOT = Path(__file__).resolve().parent.parent
BOOK = 'zero-to-one'
ROUTE = '/books/' + BOOK
SOURCE = ROUTE + '/original.pdf'
SOURCE_SHA256 = '220dc128f0a5b08aac0ec21299805a1f79df4b8260343ba90ab9cd2be19f2a7e'

# Page numbers refer to the supplied PDF. Descriptions identify graphics that
# have no selectable title or caption in the source.
IMAGE_LABELS = {
    10: 'Vertical progress means doing new things. Horizontal progress means copying existing things.',
    11: 'Technology moves from zero to one. Globalization moves from one to many.',
    19: 'Dot-com boom, with the NASDAQ peaking at 5,048 on March 10, 2000.',
    23: 'Dot-com bust, with the NASDAQ’s three-week crash ending April 14, 2000, and a decline through 2002.',
    28: ['Perception: firms A and B cluster near the middle of the competition-to-monopoly spectrum.',
         'Reality: firms A and B are near opposite ends of the competition-to-monopoly spectrum.'],
    30: 'Nested circles show four definitions of Google’s advertising market.',
    32: 'Venn diagram showing the intersection of rap stars, teen hackers, and sharks.',
    41: 'Four nearly identical smartphones.',
    45: 'Present value cash flows of a business in decline.',
    46: 'Projected present value cash flows of LinkedIn.',
    59: 'Four outlooks on the future, definite or indefinite and optimistic or pessimistic.',
    63: 'Map of engineering projects proposed for the Mediterranean region.',
    68: 'Philosophers classified by their definite or indefinite optimism or pessimism.',
    70: 'Comparison table of biotech and software startups.',
    72: 'Four world outlooks with axes for investment and savings.',
    75: 'NASDAQ share price of Apple from 2004 to 2013.',
    79: 'J-curve of a successful venture fund, with a marked break-even point.',
    80: 'Actual and perceived rates of investment return by company rank.',
    83: 'Beginning of fund: returns have yet to diverge.',
    84: 'Mid-fund: returns have started to diverge.',
    85: 'Mature fund: returns follow a steep power law by rank.',
    89: 'Spectrum from easy conventions through hard secrets to impossible mysteries.',
    92: 'Two illustrations of people wearing glasses and hoodies.',
    118: 'An organization on the spectrum between nihilism and dogmatism.',
    124: 'Sales and marketing channels by customer acquisition cost and target customer.',
    135: 'Comparison of globalization and technology by labor supply and demand for resources.',
    142: 'Hypothetical loss of human control after AI becomes superhuman.',
    145: 'Renewable Energy Industrial Index from 2003 to 2012.',
    148: 'Successive Intel processor generations, models, and release years.',
    151: 'A company’s solar power production compared with U.S. production.',
    152: 'Solar power production compared at company, U.S., and global scale.',
    153: 'Cleantech power generation compared with total global power generation.',
    155: 'Portraits of Brian Harrison and Elon Musk.',
    163: 'Comparison of the RENIXX and NASDAQ index trajectories.',
    167: 'Group portrait of the PayPal team.',
    169: 'Normal distribution of traits.',
    170: 'Fat-tailed distribution of traits compared with a normal distribution.',
    172: 'Founder distribution of traits compared with normal and fat-tailed distributions.',
    174: 'Feedback loop connecting unusual traits, exaggeration by founders, and exaggeration by others.',
    176: 'Magazine portrait of Richard Branson carrying a woman.',
    177: 'Portraits of Sean Parker and Lady Gaga.',
    180: 'Portraits of Elvis Presley, Michael Jackson, and Britney Spears.',
    181: 'Elvis Presley and Michael Jackson in later years, and Britney Spears with a shaved head.',
    182: 'Portraits of four musicians.',
    183: 'Howard Hughes as a young aviator and on the cover of Time.',
    185: 'Portrait of Bill Gates and his appearance on the cover of Newsweek.',
    186: 'Portraits of Steve Jobs at two ages.',
    190: 'Recurrent collapse: progress rises and falls in repeated cycles.',
    191: 'Plateau: progress gradually approaches a ceiling.',
    192: 'Extinction: progress falls abruptly after a peak.',
    193: 'Takeoff: progress accelerates sharply.',
}
CAPTION_PAGES = {92, 155, 167}
HEADING_FONTS = {'12': 2, '13': 3}
VERSE_PAGES = {43, 101}


@dataclass
class Asset:
    name: str
    width: int
    height: int
    alt: str


@dataclass
class Line:
    page: int
    spans: list

    @property
    def text(self):
        return ''.join(span_text(span) for span in self.spans)

    @property
    def top(self):
        top = int(self.spans[0].get('top'))
        # The source places a decorative initial 13 units above the body line.
        return top + 13 if self.font == '10' and self.left == 108 else top

    @property
    def left(self):
        return int(self.spans[0].get('left'))

    @property
    def font(self):
        return self.spans[0].get('font')


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace('’', '').replace("'", '')).strip('-')


def span_text(span):
    return ''.join(span.itertext())


def offset_text(page, span):
    text = span_text(span)
    if (page == 97 and span.get('font') == '3') or (page == 102 and text == '30'):
        return 'sup'
    if page == 147 and span.get('font') == '0':
        return {'1': 'sup', 'π': 'sub'}.get(text)
    return None


def chapter_from_link(link):
    match = re.fullmatch(r'layout\.html#(\d+)', link)
    return int(match[1]) if match else None


def contents(page):
    labels = defaultdict(list)
    for span in page.findall('text'):
        link = span.find('a')
        if link is not None:
            labels[chapter_from_link(link.get('href'))].append(span_text(span))
    items = []
    for index, (page_num, parts) in enumerate(labels.items()):
        title = ' '.join(''.join(parts).split())
        item = {'title': title, 'slug': slug(title), 'original': f'#page={page_num}', 'type': 'appendix'}
        if index == 0:
            item['slug'] = 'preface'
            item['type'] = 'intro'
        elif index <= 14:
            number, title = title.split(' ', 1)
            if int(number) != index:
                raise ValueError(f'Unexpected number in PDF contents: {number}')
            item.update(title=f'{index:02d} - {title}', slug=f'{index:02d}-{slug(title)}', number=f'{index:02d}', type='chapter')
        elif index == 15:
            item['slug'] = 'conclusion'
        items.append((page_num, item))
    if len(items) != 20 or list(labels) != sorted(labels):
        raise ValueError('The supplied PDF contents have changed')
    return items


def extract_assets(pdf, work, originals, poppler):
    listings = run([poppler('pdfimages'), '-list', pdf], check=True, capture_output=True, text=True).stdout.splitlines()[2:]
    run([poppler('pdfimages'), '-j', pdf, work / 'native'], check=True)
    assets = defaultdict(list)
    for entry in listings:
        page, index, kind, width, height, *metadata = entry.split()
        page = int(page)
        native = work / f'native-{int(index):03d}.jpg'
        if kind != 'image' or 'jpeg' not in metadata or not native.is_file():
            raise ValueError(f'Unexpected embedded image on page {page}')
        # Cover and title page are reachable through the original PDF.
        if page < 6:
            continue
        number = len(assets[page])
        labels = IMAGE_LABELS[page]
        alt = labels[number] if isinstance(labels, list) else labels
        name = f'page-{page:03d}-{number + 1:02d}.jpg'
        copyfile(native, originals / name)
        assets[page].append(Asset(name, int(width), int(height), alt))
    if set(assets) != set(IMAGE_LABELS):
        raise ValueError('The supplied PDF image list has changed')
    return assets


def page_layout(page, assets):
    """Join text spans on a baseline, then interleave figures by vertical position."""
    page_num = int(page.get('number'))
    lines = []
    baseline = None
    for span in page.findall('text'):
        if not span_text(span).strip() and (not lines or int(span.get('left')) < 110):
            continue
        top, height = int(span.get('top')), int(span.get('height'))
        font = span.get('font')
        starts_title = font in HEADING_FONTS or font in {'5', '10'}
        bottom = top + height
        if font == '10' and int(span.get('left')) == 108:
            bottom = top + 33
        elif offset_text(page_num, span) == 'sup':
            bottom = top + 24  # Raised exponents share the surrounding text line.
        elif offset_text(page_num, span) == 'sub':
            bottom = top + 11
        same_line = lines and not starts_title and abs(bottom - baseline) <= 5
        if same_line:
            lines[-1].spans.append(span)
        else:
            lines.append(Line(page_num, [span]))
            baseline = bottom
    positions = page.findall('image')
    if len(positions) != len(assets):
        raise ValueError(f'Image positions and embedded images disagree on page {page_num}')
    events = [(line.top, line) for line in lines]
    events.extend((int(position.get('top')), asset) for asset, position in zip(assets, positions))
    return [event for _, event in sorted(events, key=lambda event: event[0])]


def link_target(href, page, chapter_routes):
    destination = chapter_from_link(href)
    if destination:
        if page < 195 and destination in chapter_routes:
            return chapter_routes[destination]
        return f'{SOURCE}#page={destination}'
    return href if urlsplit(href).scheme in {'http', 'https', 'mailto'} else None


def span_html(span, page, chapter_routes, small_caps=False, trim_line_end=False):
    def styled(node):
        def escaped(value):
            if not value:
                return ''
            return escape(value.lower() if small_caps else value)

        content = escaped(node.text)
        for child in node:
            content += styled(child) + escaped(child.tail)
        if node.tag in {'i', 'b'}:
            tag = 'em' if node.tag == 'i' else 'strong'
            return f'<{tag}>{content}</{tag}>'
        if node.tag == 'a':
            href = link_target(node.get('href'), page, chapter_routes)
            # Poppler sometimes includes the rest of a line's black text after
            # a PDF annotation. The visible source link is blue.
            if href and span.get('font') in {'4', '6', '7', '9'} and content.strip():
                return f'<a href="{escape(href)}">{content}</a>'
        return content

    content = styled(span)
    if trim_line_end:
        content = re.sub(r'\s+(?=(?:</(?:em|strong|a)>)*$)', '', content)
    script = offset_text(page, span)
    if script:
        content = f'<{script}>{content}</{script}>'
    return content


def line_html(line, chapter_routes, first=False):
    content = ''.join(span_html(span, line.page, chapter_routes,
                                small_caps=first and span.get('font') == '0',
                                trim_line_end=index == len(line.spans) - 1)
                      for index, span in enumerate(line.spans))
    return re.sub(r'\s+', ' ', content).strip()


def figure_html(asset, restyled, caption=None):
    shown = restyled.get(asset.name)
    src = f'{ROUTE}/figures/{shown}' if shown else f'{ROUTE}/images/{asset.name}'
    original = f' data-original="{asset.name}"' if shown else ''
    caption_html = f'<figcaption>{caption}</figcaption>' if caption else ''
    return (f'<figure><img src="{src}" alt="{escape(asset.alt)}" width="{asset.width}" '
            f'height="{asset.height}" decoding="async"{original}>{caption_html}</figure>')


def chapter_html(item, layouts, chapter_routes, restyled):
    title = item['title'].removeprefix(item.get('number', '') + ' - ')
    blocks = [f'<h1 id="{item["slug"]}">{escape(title)}</h1>']
    paragraph = ''
    previous = None
    container = None
    list_item = False
    heading_ids = set()

    def flush():
        nonlocal paragraph
        if paragraph:
            blocks.append(f'<p>{paragraph}</p>')
            paragraph = ''

    def close_container():
        nonlocal container, list_item
        flush()
        if list_item:
            blocks.append('</li>')
            list_item = False
        if container:
            blocks.append(f'</{container}>')
            container = None

    def open_container(tag):
        nonlocal container
        if container != tag:
            close_container()
            blocks.append(f'<{tag}>')
            container = tag

    for events in layouts:
        index = 0
        while index < len(events):
            event = events[index]
            index += 1
            if isinstance(event, Asset):
                close_container()
                caption = None
                if index < len(events) and isinstance(events[index], Line):
                    candidate = events[index]
                    if candidate.page in CAPTION_PAGES and candidate.font == '0' and candidate.left > 194:
                        caption = escape(candidate.text.strip())
                        index += 1
                blocks.append(figure_html(event, restyled, caption))
                previous = None
                continue

            # The visible chapter numbers, main heading and first-letter drop
            # cap are distinct PDF spans. Reuse the chapter title from contents.
            if event.font == '5' or (event.font == '10' and event.left != 108):
                continue
            first = event.font == '10'
            text = line_html(event, chapter_routes, first=first)
            if event.font in HEADING_FONTS:
                close_container()
                depth = HEADING_FONTS[event.font]
                anchor = slug(event.text)
                if anchor in heading_ids:
                    raise ValueError(f'Duplicate heading ID in {item["slug"]}: {anchor}')
                heading_ids.add(anchor)
                blocks.append(f'<h{depth} id="{anchor}">{text}</h{depth}>')
                previous = None
                continue

            if event.page == 22 and 169 <= event.top <= 229:
                close_container()
                excerpt = [text]
                while index < len(events) and isinstance(events[index], Line) and events[index].top <= 230:
                    excerpt.append(line_html(events[index], chapter_routes))
                    index += 1
                excerpt[-1] = '—Prince'
                blocks.append(f'<blockquote><p>{"<br>".join(excerpt)}</p></blockquote>')
                previous = None
                continue

            if item['slug'] == 'index':
                if not previous or previous.page != event.page or event.top - previous.top >= 23:
                    flush()
            elif item['slug'] == 'illustration-credits' and event.font == '7':
                flush()
            else:
                marker = re.match(r'^(\d+\. |• )', event.text) if event.left == 151 else None
                if marker:
                    tag = 'ul' if marker[0].startswith('•') else 'ol'
                    open_container(tag)
                    flush()
                    if list_item:
                        blocks.append('</li>')
                    blocks.append('<li>')
                    list_item = True
                    text = re.sub(r'^(<em>)?(?:\d+\. |• )', r'\1', text)
                elif event.left >= 194 and not list_item:
                    open_container('blockquote')
                elif event.left <= 130:
                    if container:
                        close_container()
                    if event.left == 130:
                        flush()
                # Printed line spacing is 24–25 layout units. A larger gap
                # separates paragraphs even when no first-line indent is used.
                if not marker and previous and previous.page == event.page and event.top - previous.top >= 31:
                    flush()

            separator = '' if paragraph.rstrip().endswith('-') else ' '
            if container == 'blockquote' and event.page in VERSE_PAGES and event.font == '11':
                separator = '<br>'
            paragraph += (separator if paragraph else '') + text
            previous = event
    close_container()
    return '\n'.join(blocks) + '\n'


def prepare(pdf, poppler):
    if sha256(pdf.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('This importer accepts the attached Calibre edition of Zero to One')
    destination = ROOT / '.local' / 'books' / BOOK
    original = ROOT / '.local' / 'originals' / BOOK / 'original.pdf'
    destination.parent.mkdir(parents=True, exist_ok=True)
    original.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=f'.{BOOK}-', dir=destination.parent) as directory:
        work = Path(directory)
        staging = work / 'book'
        images_dir = staging / 'images'
        images_dir.mkdir(parents=True)
        run([poppler('pdftohtml'), '-xml', '-hidden', pdf, work / 'layout'], check=True, stdout=-1)
        pages = ElementTree.parse(work / 'layout.xml').getroot().findall('page')
        entries = contents(pages[4])
        chapter_routes = {page: f'{ROUTE}/{item["slug"]}' for page, item in entries}
        assets = extract_assets(pdf, work, images_dir, poppler)
        run([poppler('pdftoppm'), '-f', '1', '-l', '1', '-scale-to', '440', '-jpeg',
             '-singlefile', pdf, images_dir / 'cover'], check=True)
        figure_command = ROOT / 'scripts' / 'restyle-zero-to-one-figures.mjs'
        restyled = json.loads(run(['node', figure_command, images_dir, staging / 'figures'],
                                  check=True, capture_output=True, text=True).stdout)
        layouts = [page_layout(page, assets.get(index, [])) for index, page in enumerate(pages, 1) if index >= 6]
        for index, (start, item) in enumerate(entries):
            end = entries[index + 1][0] if index + 1 < len(entries) else len(pages) + 1
            html = chapter_html(item, layouts[start - 6:end - 6], chapter_routes, restyled['figures'])
            (staging / (item['slug'] + '.html')).write_text(html, encoding='utf-8')
        items = [item for _, item in entries]
        manifest = {
            'cover': 'cover.jpg',
            'id': BOOK,
            'title': 'Zero to One',
            'author': 'Peter Thiel with Blake Masters',
            'source': SOURCE,
            'sourceEdition': 'Crown Business, 2014. User-supplied Calibre PDF.',
            'revision': SOURCE_SHA256,
            'copyright': 'Copyright © 2014 by Peter Thiel',
            'description': 'Notes on Startups, or How to Build the Future',
            'items': items,
            'toc': [
                {'title': title, 'entries': [{'slug': item['slug']} for item in items if item['type'] == kind]}
                for title, kind in [('Chapters', 'chapter'), ('Back matter', 'appendix')]
            ],
            'images': sum(len(page_assets) for page_assets in assets.values()),
            'figures': restyled['figures'],
            'figureMethods': restyled['methods'],
        }
        (staging / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if not original.exists() or sha256(original.read_bytes()).hexdigest() != SOURCE_SHA256:
            incoming = work / 'original.pdf'
            copyfile(pdf, incoming)
            incoming.replace(original)
        backup = work / 'previous'
        if destination.exists():
            destination.rename(backup)
        try:
            staging.rename(destination)
        except OSError:
            if backup.exists():
                backup.rename(destination)
            raise
        print(f'Prepared {len(items)} reading pages and {manifest["images"]} images ({len(restyled["figures"])} restyled).')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path, help='Path to the attached Zero to One PDF')
    parser.add_argument('--poppler-bin', type=Path, help='Directory containing pdftohtml and pdfimages')
    args = parser.parse_args()
    prepare(args.pdf, lambda binary: args.poppler_bin / binary if args.poppler_bin else binary)
