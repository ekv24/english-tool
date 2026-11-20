"""Import the supplied English EPUB of The Nvidia Way into English Tool."""
import argparse
import hashlib
import json
import posixpath
import re
import shutil
from html import escape
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
ID = "the-nvidia-way"
ROUTE = "/books/" + ID
ORIGINAL = ROOT / ".local" / "originals" / ID / "original.epub"
TARGET = ROOT / ".local" / "books" / ID
EDITION_HASH = "96a5a6e4afeff0d52ad7c88379179a7b53aab68d770179b43d4a3e744f605323"
ISBN = "9781324086727"
EPUB_TYPE = "{http://www.idpf.org/2007/ops}type"
TAGS = set("a b blockquote br div em figcaption figure h1 h2 h3 h4 i img li ol p section small span strong sub sup ul".split())
TAIL = ["Conclusion", "Appendix", "Acknowledgments", "Notes", "Copyright"]
FRONT = ["Cover", "Title", "Dedication", "Contents", "Halftitle"]


def local_path(base, relative):
    return posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(relative)))


def name(element):
    return element.tag.rsplit("}", 1)[-1]


def prepare(source):
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    if checksum != EDITION_HASH:
        raise ValueError("The file differs from the verified English edition.")
    with ZipFile(source) as archive:
        if archive.testzip() or "META-INF/encryption.xml" in archive.namelist():
            raise ValueError("EPUB is damaged or encrypted.")

        def xml(path):
            return ET.fromstring(archive.read(path))

        package_path = xml("META-INF/container.xml").find(".//{*}rootfile").attrib["full-path"]
        package = xml(package_path)
        metadata = package.find("{*}metadata")
        if metadata.findtext("{*}identifier") != ISBN or metadata.findtext("{*}language") != "en":
            raise ValueError("Unexpected edition or language.")

        manifest = {element.attrib["id"]: element for element in package.find("{*}manifest")}
        paths = {key: local_path(package_path, element.attrib["href"]) for key, element in manifest.items()}
        spine = package.find("{*}spine")
        ncx_path = paths[spine.attrib["toc"]]
        ncx = xml(ncx_path)
        navmap = ncx.find("{*}navMap")
        nav = {local_path(ncx_path, point.find("{*}content").attrib["src"].split("#")[0]): point
               for point in navmap.iterfind(".//{*}navPoint")}

        def title(key):
            point = nav.get(paths[key])
            return point.findtext("{*}navLabel/{*}text") if point is not None else "Half title"

        parts = {f"Part{i:02}": [f"Chapter{j:02}" for j in chapters]
                 for i, chapters in enumerate((range(1, 4), range(4, 8), range(8, 11), range(11, 15)), 1)}
        narrative = ["Introduction", *(entry for key, chapters in parts.items() for entry in (key, *chapters)), *TAIL]
        actual_order = [element.attrib["idref"] for element in spine]
        if len(actual_order) != len(set(actual_order)) or actual_order != [*FRONT, *narrative]:
            raise ValueError("EPUB reading order does not match the expected chapters and front/back matter.")

        documents = {paths[key]: xml(paths[key]).find("{*}body") for key in actual_order}
        identifiers = {path: {element.get("id") for element in document.iter() if "id" in element.attrib}
                       for path, document in documents.items()}
        page_list = ncx.find("{*}pageList")
        pages = {}
        for target in page_list:
            path, anchor = target.find("{*}content").attrib["src"].split("#")
            if anchor not in identifiers[local_path(ncx_path, path)]:
                raise ValueError(f"Missing print-page anchor: {anchor}")
            value = target.attrib["value"]
            if value.isdecimal():
                pages[int(value)] = anchor
        if set(pages) != set(range(1, 262)):
            raise ValueError("The print-page sequence is incomplete.")
        for key in (key for key in actual_order if key.startswith("Chapter")):
            if len("".join(documents[paths[key]].find("{*}section").itertext()).split()) < 1000:
                raise ValueError(f"Missing reading text in {key}")

        items = {}
        for key in [*narrative, *FRONT]:
            label = title(key)
            slug = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")
            number, separator, chapter_name = label.partition(". ")
            chapter = bool(separator and number.isdecimal())
            if chapter:
                slug = number.zfill(2) + "-" + re.sub(r"[^a-z0-9]+", "-", chapter_name.lower()).strip("-")
                label = number + " - " + chapter_name
            item = {"slug": slug, "title": label, "type": "chapter" if chapter else
                    "intro" if key == "Introduction" else "appendix", "original": ""}
            if chapter:
                item["number"] = number
            items[key] = item

        local_documents = {paths[key]: item["slug"] for key, item in items.items()}
        images = {paths[key]: Path(paths[key]).name for key, element in manifest.items()
                  if element.attrib["media-type"] == "image/jpeg"}
        cover_key = next(key for key, element in manifest.items() if element.get("properties") == "cover-image")

        def render(element, path):
            tag = name(element)
            if tag not in TAGS:
                raise ValueError(f"Unexpected element {tag} in {path}")
            attrs = {key: element.attrib[key] for key in ("id", "title", "lang") if key in element.attrib}
            source_class = element.get("class", "")
            if source_class == "chap-n":
                tag, attrs["class"] = "p", "meta"
            elif source_class in {"chap-h", "fmt", "fmbm", "fmch1"} and tag == "h2":
                tag = "h1"
            elif source_class == "fig":
                tag, attrs["class"] = "figcaption", "caption"
            if element.get(EPUB_TYPE) == "pagebreak":
                attrs["aria-hidden"] = "true"
            if tag == "a" and (href := element.get("href")):
                url = urlsplit(href)
                if url.scheme in {"https", "http"} and url.hostname:
                    attrs["href"] = href
                elif not url.scheme and not url.netloc and not url.query:
                    target = local_path(path, url.path) if url.path else path
                    if target not in local_documents or (url.fragment and
                            unquote(url.fragment) not in identifiers[target]):
                        raise ValueError(f"Broken document link in {Path(path).name}: {href}")
                    attrs["href"] = ("" if target == path and url.fragment else ROUTE + "/" +
                                     local_documents[target]) + ("#" + url.fragment if url.fragment else "")
                else:
                    raise ValueError(f"Unexpected link in {path}")
            if tag == "img":
                asset = images[local_path(path, element.attrib["src"])]
                attrs["src"] = ROUTE + "/images/" + asset
                attrs["alt"] = element.attrib.get("alt", "")
            attributes = "".join(f' {key}="{escape(value, quote=True)}"' for key, value in attrs.items())
            if tag in {"img", "br"}:
                return f"<{tag}{attributes}>"
            children = list(element)
            body = escape(element.text or "")
            index = 0
            while index < len(children):
                child = children[index]
                if child.get("class") == "image":
                    caption = children[index + 1] if index + 1 < len(children) else None
                    figure = "".join(render(image, path) for image in child)
                    if caption is not None and caption.get("class") == "fig":
                        figure += render(caption, path)
                        index += 1
                        child = caption
                    body += "<figure>" + figure + "</figure>"
                else:
                    body += render(child, path)
                body += escape(child.tail or "")
                index += 1
            return f"<{tag}{attributes}>{body}</{tag}>"

        html = {}
        for key, item in items.items():
            document = documents[paths[key]]
            # The added distributor notice is outside the book section in every XHTML file.
            sections = document.findall("{*}section")
            if key == "Cover":
                sections = [next(element for element in document.iter() if element.get("class") == "cover")]
            html[item["slug"]] = "\n".join(render(section, paths[key]) for section in sections)
            if not html[item["slug"]].strip():
                raise ValueError(f"No readable content in {key}")

        result = {
            "id": ID, "title": metadata.findtext("{*}title"), "author": metadata.findtext("{*}creator"),
            "description": "Jensen Huang and the Making of a Tech Giant",
            "source": ROUTE + "/original.epub",
            "canonicalSource": "https://wwnorton.co.uk/books/9781324086710-the-nvidia-way",
            "sourceEdition": f"W. W. Norton & Company, 2024. English EPUB, ISBN {ISBN}. User-supplied file.",
            "sourceFilename": source.name, "revision": checksum,
            "copyright": metadata.findtext("{*}rights"),
            "cover": images[paths[cover_key]],
            "coverOrigin": "Cover image declared in the EPUB package.",
            "items": list(items.values()),
            "toc": [{"title": title(key), "entries": [{"slug": items[chapter]["slug"]} for chapter in chapters]}
                    for key, chapters in parts.items()] +
                   [{"title": "Back matter", "entries": [{"slug": items[key]["slug"]} for key in TAIL]},
                    {"title": "Front matter", "entries": [{"slug": items[key]["slug"]} for key in FRONT]}],
        }
        (TARGET / "images").mkdir(parents=True, exist_ok=True)
        for path, filename in images.items():
            (TARGET / "images" / filename).write_bytes(archive.read(path))
        ORIGINAL.parent.mkdir(parents=True, exist_ok=True)
        if source.resolve() != ORIGINAL.resolve():
            shutil.copyfile(source, ORIGINAL)
        for slug, body in html.items():
            (TARGET / (slug + ".html")).write_text(body + "\n", encoding="utf-8")
        (TARGET / "manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Prepared {len(items)} reading pages. Verified 14 chapters and print pages 1–261.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("epub", type=Path, nargs="?", default=ORIGINAL)
    prepare(parser.parse_args().epub)
