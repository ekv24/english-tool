# Adding articles and books

English Tool reads prepared HTML fragments and JSON metadata from the file system. Keep a separate copy of the original text or PDF. Use material you are allowed to store or share, and import HTML and media from trusted sources. When preparing a fragment, keep the original English wording, section order, figures, captions, and equations. Review the HTML and use local images, plain document markup, and stable heading IDs. For a PDF or scan, extract the text or use OCR first, then check the text and figures against the source while preparing the HTML fragments.

The examples below use `.local/`, the default data directory. If you set `ENGLISH_TOOL_DATA_DIR`, use the same directory layout under that path. Use unique IDs made from lowercase ASCII letters, digits, and hyphens for articles, books, and chapter slugs. Keep them stable so reading positions and saved expressions can still reach their source.

## Article

Create `.local/materials/my-article/` with `metadata.json` and `article.html`. In `metadata.json`, match the `id` to the directory name.

```json
{
  "id": "my-article",
  "title": "Checking a measurement",
  "publisher": "Example publisher",
  "kind": "Article",
  "date": "2026-01-01",
  "source": "https://example.com/my-article",
  "glossaryLanguage": "en"
}
```

Put the body in `article.html`. The reader adds the article title from metadata. Use section headings and anchors in the fragment.

```html
<section>
  <h2 id="checking">Check the baseline</h2>
  <p>Before comparing the readings, check that the baseline is stable.</p>
</section>
```

Place article media in `media/`. For example, use `/read/my-article/media/baseline.png` as an image's `src`. To show a thumbnail on the library card, set `"previewMedia": "baseline.png"` in the metadata. For a PDF you keep with the article, save it as `original.pdf` next to `article.html` and set `source` to `/read/my-article/original.pdf`. Use an empty `source` if an original is unavailable to readers.

Open **Library** or go to `/read/my-article` on the running server.

## Book

Create `.local/books/my-book/` with `manifest.json` and one HTML fragment per page. In this example the files are `introduction.html` and `measurement.html`. Each `items` entry uses the filename without `.html` as its `slug`. The first item appears at the top of the contents automatically. The `toc` groups the other items by slug, and `items` gives the order of the previous and next links.

```json
{
  "id": "my-book",
  "title": "Reading measurements",
  "author": "Example author",
  "description": "A short guide to reading an experiment report.",
  "source": "https://example.com/my-book/",
  "glossaryLanguage": "en",
  "items": [
    {
      "slug": "introduction",
      "title": "Introduction",
      "original": "introduction.html",
      "type": "intro"
    },
    {
      "slug": "measurement",
      "title": "Measurement",
      "original": "measurement.html",
      "type": "chapter"
    }
  ],
  "toc": [
    {
      "title": "Reading a report",
      "entries": [{ "slug": "measurement" }]
    }
  ]
}
```

The reader combines the book's `source` with each page's `original` value. For a PDF, place `original.pdf` next to the manifest, set `source` to `/books/my-book/original.pdf`, and use fragments such as `"#page=3"` for each page's `original`. Use an empty `source` if you have no original link.

Use `<h1>` for the chapter title, `<h2>` for sections, and `<h3>` for subsections. To list a subsection in the outline, put its `<h3>` first inside a `<section>` with an ID. For example, put this in `measurement.html`.

```html
<h1>Measurement</h1>
<section>
  <h2 id="checking">Check the baseline</h2>
  <p>Before comparing the readings, check that the baseline is stable.</p>
</section>
```

Store images under `images/` and link to them as `/books/my-book/images/baseline.png`. You can set `"cover": "cover.png"` to show `images/cover.png` on the library card. For a reader version of a figure, use `src="/books/my-book/figures/baseline.svg"` and `data-original="baseline.png"` on the image. Readers can click the figure to compare it with the original image in `images/`. For TeX, provide the MathJax v3 `tex-mml-chtml.js` bundle and its fonts under `mathjax/es5/`, mark the TeX containers with the class `math`, and set `"math": true` in the manifest.

Open **Library** or go to `/books/my-book` on the running server.

## Glossaries and quizzes

Put an optional `glossary.json` beside the article metadata or book manifest. The keys are words or phrases as readers select them. Each value is an array with a short definition or translation followed by a contextual explanation. A book glossary is shared by its chapters.

```json
{
  "baseline": [
    "a starting measurement used for comparison",
    "Here it is the reference reading taken before the experiment changes anything."
  ]
}
```

Use the same BCP 47 language tag in `glossaryLanguage` and `ENGLISH_TOOL_TARGET_LANGUAGE` to make the glossary available. For custom materials without `glossaryLanguage`, the glossary is assumed to match the configured target. Add the field explicitly if you may change languages later.

Article questions go in `quiz.json` as an array. Each `anchor` is the ID of an element in the article fragment, without the leading `#`.

```json
[
  {
    "question": "Why should you check the baseline before comparing readings?",
    "answer": "An unstable reference makes it harder to tell whether a later change came from the experiment.",
    "anchor": "checking"
  }
]
```

For a book, use `quizzes.json` with an object whose keys are page slugs and whose values are arrays of the same question objects.

```json
{
  "measurement": [
    {
      "question": "What can an unstable baseline hide?",
      "answer": "It can make a real change in the readings harder to distinguish from ordinary variation.",
      "anchor": "checking"
    }
  ]
}
```

Open the material in the reader to check section links, images, lookups, and quiz anchors against the original.
