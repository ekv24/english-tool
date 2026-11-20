"""Prepare the verified 2016 English EPUB of Deep Work for the local reader."""
import argparse
import hashlib
import json
import shutil
from html import escape
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
BOOK = "deep-work"
ROUTE = "/books/" + BOOK
DIGEST = "3bfe6d0c1dbe1c046942b0d64a488c60e4290f75b5b1ac2bbd3961d1365fa311"
ORIGINAL = ROOT / ".local/originals" / BOOK / "original.epub"
TARGET = ROOT / ".local/books" / BOOK
SLUGS = {
    "cover": "cover", "titlepage": "title-page", "welcome": "welcome",
    "preface002": "introduction", "part001": "the-idea", "part002": "the-rules",
    "chapter001": "deep-work-is-valuable", "chapter002": "deep-work-is-rare",
    "chapter003": "deep-work-is-meaningful", "chapter004": "work-deeply",
    "chapter005": "embrace-boredom", "chapter006": "quit-social-media",
    "chapter007": "drain-the-shallows", "appendix001": "conclusion",
    "ad-card": "also-by-cal-newport", "endnotes": "notes", "footnotes": "footnotes",
    "newsletterSignup": "newsletters", "toc": "contents", "copyright": "copyright",
}
TAGS = set("section nav div p h1 h2 h3 a em strong span img sup ol li".split())


def render(node, filename, ids, images, in_sql=False):
    tag = node.tag.rsplit("}", 1)[-1]
    if tag not in TAGS:
        raise ValueError(f"Unsupported element {tag} in {filename}")
    cls = node.get("class", "")
    attrs = {k: node.attrib[k] for k in ("id", "title") if k in node.attrib}
    if tag == "a" and node.get("href"):
        href = node.attrib["href"]
        url = urlsplit(href)
        if url.scheme in {"http", "https"} and url.hostname:
            attrs["href"] = href
        else:
            dest = url.path or filename
            if dest not in ids or (url.fragment and url.fragment not in ids[dest]):
                raise ValueError(f"Invalid link in {filename}: {href}")
            attrs["href"] = ROUTE + "/" + SLUGS[Path(dest).stem]
            if url.fragment:
                attrs["href"] += "#" + url.fragment
    if tag == "img":
        asset = images[node.attrib["src"]]
        attrs.update(src=ROUTE + "/images/" + asset, alt=node.get("alt", ""))
        if asset in {"Art_sborn.jpg", "Art_tick.jpg"}:
            attrs["alt"] = ""
            if asset == "Art_tick.jpg":
                attrs["style"] = "display:inline;width:1em;vertical-align:baseline"
    if cls in {"chapter-number", "part-number"}:
        tag, attrs["class"] = "p", "meta"
    elif cls in {"sect1", "sect1c"}:
        tag = "h2"
    elif cls.startswith("sect2"):
        tag = "h3"
    elif cls in {"blockquote", "ecom_a"}:
        tag = "blockquote"
    elif cls == "ecom_b":
        tag, in_sql = "pre", True
    elif tag == "p" and in_sql:
        tag = "code"
    elif cls == "orn":
        tag, attrs["aria-hidden"] = "div", "true"
    elif cls == "underline":
        tag = "u"
    if cls == "hidden-tag":
        attrs["hidden"] = "hidden"

    attributes = "".join(f' {k}="{escape(v, quote=True)}"' for k, v in attrs.items())
    opening = f"<{tag}{attributes}>"
    if tag == "img":
        return opening
    body = escape(node.text or "") + "".join(
        render(child, filename, ids, images, in_sql) + escape(child.tail or "") for child in node
    )
    return opening + body + f"</{tag}>"


def prepare(source):
    if hashlib.sha256(source.read_bytes()).hexdigest() != DIGEST:
        raise ValueError("Unexpected EPUB edition.")
    with ZipFile(source) as archive:
        if archive.testzip():
            raise ValueError("Corrupt EPUB.")
        package = ET.fromstring(archive.read("OEBPS/package.opf"))
        entries = {item.get("id"): item for item in package.find("{*}manifest")}
        spine = [entries[entry.attrib["idref"]].attrib["href"] for entry in package.find("{*}spine")]
        assert set(spine) == {key + ".xhtml" for key in SLUGS} and len(spine) == len(SLUGS)
        nav = ET.fromstring(archive.read("OEBPS/toc.ncx"))
        labels = {p.find("{*}content").attrib["src"]: p.findtext("{*}navLabel/{*}text")
                  for p in nav.iterfind(".//{*}navPoint")}
        labels["footnotes.xhtml"] = "Footnotes"
        docs = {f: ET.fromstring(archive.read("OEBPS/" + f)).find("{*}body") for f in spine}
        ids = {f: {e.attrib["id"] for e in body.iter() if "id" in e.attrib} for f, body in docs.items()}
        for page in nav.iterfind(".//{*}pageTarget"):
            f, anchor = page.find("{*}content").attrib["src"].split("#")
            assert anchor in ids[f], anchor

        images = {e.attrib["href"]: Path(e.attrib["href"]).name for e in entries.values()
                  if e.get("media-type") == "image/jpeg"}
        cover = images[next(e.attrib["href"] for e in entries.values() if e.get("properties") == "cover-image")]
        pages = {SLUGS[Path(f).stem]: "\n".join(render(child, f, ids, images) for child in docs[f])
                 for f in spine}
        # Start the reader at the introduction. Keep the preliminary leaves accessible at the end.
        order = spine[3:] + spine[:3]
        items = [{"title": labels[f], "slug": SLUGS[Path(f).stem], "original": "",
                  "type": "chapter" if f.startswith("chapter") else "intro" if f == "preface002.xhtml" else "appendix"}
                 for f in order]
        groups = [("Part 1: The Idea", order[1:5]), ("Part 2: The Rules", order[5:10]),
                  ("Back matter", order[10:-3]), ("Front matter", spine[:3])]
        manifest = {
            "id": BOOK, "title": "Deep Work", "description": "Rules for Focused Success in a Distracted World",
            "author": "Cal Newport", "source": ROUTE + "/original.epub",
            "canonicalSource": "https://www.hachettebookgroup.com/titles/cal-newport/deep-work/9781455586660/",
            "sourceEdition": "Grand Central Publishing, January 2016. English ebook, ISBN 9781455586660.",
            "sourceFilename": source.name, "revision": DIGEST,
            "copyright": "Copyright © 2016 by Cal Newport. All rights reserved.",
            "cover": cover, "coverOrigin": "Publisher cover from the supplied EPUB (cover-image).",
            "items": items, "toc": [{"title": title, "entries": [{"slug": SLUGS[Path(f).stem]} for f in files]}
                                    for title, files in groups],
        }
        ORIGINAL.parent.mkdir(parents=True, exist_ok=True)
        if source.resolve() != ORIGINAL.resolve():
            shutil.copyfile(source, ORIGINAL)
        (TARGET / "images").mkdir(parents=True, exist_ok=True)
        for filename, name in images.items():
            (TARGET / "images" / name).write_bytes(archive.read("OEBPS/" + filename))
        for slug, html in pages.items():
            (TARGET / (slug + ".html")).write_text(html + "\n", encoding="utf-8")
        (TARGET / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                               encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    prepare(parser.parse_args().source)
