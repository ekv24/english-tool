"""Redraw charts from chapters 12–16 of the pinned published book.

Use the environment documented in redraw-book-plots.py plus joblib 1.3.2,
scikit-learn 1.3.2, and toolz 0.12.1. The data argument points to the upstream
book's data directory at revision 4df1445987d3b6f9824d508863a1a2f0a503e888.
"""

import argparse
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import warnings


NOTEBOOKS = {
    "12-Doubly-Robust-Estimation": (
        "122c5b53fd63e160960273d60063d8c4be7284a825ad13151a1429f03f9f3798",
        (2, 3, 7, 9, 10, 12, 14),
    ),
    "13-Difference-in-Differences": (
        "bf22d63bd3ce94984c4f4b47564e38612b2ed031a2616e5a4d1b09de946c8aab",
        (2, 3, 5, 7, 9, 11, 15),
    ),
    "14-Panel-Data-and-Fixed-Effects": (
        "b609219ee72aa8e0d46e23a53e54dd1b2099cf7b96bec81fc4593c041a5dc145",
        (2, 24, 26),
    ),
    "15-Synthetic-Control": (
        "f98d189741b2c847ab0a4236c138c675899c023f57a850e718bb8a3a255068ca",
        (2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 37, 39, 41, 45),
    ),
    "16-Regression-Discontinuity-Design": (
        "0db4f91106036fc9411e8855566994f575417bebaeec407f1cb49fb6908e5019",
        (2, 4, 6, 8, 10, 12, 14, 16, 17, 19, 20, 22, 24, 26, 28, 30, 32, 34, 35, 37),
    ),
}

DATA = {
    "learning_mindset.csv": "00e904b1bcc688857cc679d9035dac1b3ba892c3a03a4d5050eb43f101256fa7",
    "billboard_impact.csv": "fc1e2e8ab3e95d6944a96c609b8e373b8569e4677d63bbdc315421702e1a4f3a",
    "smoking.csv": "bae31804ce53635822a4bda2b2622d92b707f8c35cf017ea2918a8fdb6083b89",
    "drinking.csv": "ab623016d7bbdc31667d5634e87f21023530a4ec779e02cb2564e76f12bdb71b",
    "sheepskin.csv": "a021aa54b9fda3ede5d1a3dcd8355ceac2361f188f2da7269e48b58a03d4f5ae",
}


def load_renderer():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(
        "book_plot_renderer", Path(__file__).with_name("redraw-book-plots.py")
    )
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    return renderer


def compatible_code(cell):
    lines = "".join(cell["source"]).splitlines()
    code = "\n".join(line for line in lines
                     if line.strip() != "%matplotlib inline"
                     and line != "from linearmodels.datasets import wage_panel")
    # These workers receive samples in notebook order and use no random state of their own.
    code = code.replace("Parallel(n_jobs=4)", "Parallel(n_jobs=1)")
    code = code.replace("Parallel(n_jobs=8)", "Parallel(n_jobs=1)")
    return code.replace('.pivot("year", "california", "cigsale")',
                        '.pivot(index="year", columns="california", values="cigsale")')


def published_layout(figure, chapter, cell):
    from matplotlib.ticker import MultipleLocator

    if chapter == "13":
        figure.subplots_adjust(top=.85, bottom=.09555555555555555)
        for axis in figure.axes:
            axis.tick_params(axis="both", labelsize=10)
            axis.legend(loc="upper left", prop={"size": 10})
    if chapter == "16" and cell in (12, 14, 20, 22, 32):
        # Older pandas line plots on existing scatter axes set a zero x margin.
        for axis in figure.axes:
            axis.margins(x=0)
        if cell in (14, 22):
            figure.axes[0].yaxis.set_major_locator(MultipleLocator(10))
            figure.tight_layout(pad=1.105)


@contextlib.contextmanager
def baseline_layout(figure, chapter, cell):
    import matplotlib
    from matplotlib.transforms import Bbox

    face = "none" if chapter == "13" else "auto"
    with matplotlib.rc_context({"savefig.facecolor": face, "savefig.edgecolor": face}):
        if chapter != "15" or cell != 16:
            yield
            return

        # The published inline image reserves six extra pixels above this plot.
        savefig = figure.savefig

        def padded(*args, **kwargs):
            dpi = figure.dpi
            try:
                figure.set_dpi(72)
                figure.canvas.draw()
                bounds = figure.get_tightbbox(figure.canvas.get_renderer()).padded(.1)
            finally:
                figure.set_dpi(dpi)
            kwargs["bbox_inches"] = Bbox.from_extents(
                bounds.x0, bounds.y0, bounds.x1, bounds.y1 + 6 / 72
            )
            return savefig(*args, **kwargs)

        figure.savefig = padded
        try:
            yield
        finally:
            del figure.savefig


def redraw(renderer, originals, output, title):
    import matplotlib
    from matplotlib import pyplot as plt

    expected, selections = NOTEBOOKS[title]
    path = originals / "_sources" / (title + ".ipynb")
    cells = json.loads(renderer.checked_bytes(path, expected))["cells"]
    chapter = title[:2]
    matplotlib.rcdefaults()
    matplotlib.rcParams["figure.figsize"] = (6, 4)
    variables = {}
    for number in selections:
        cell = cells[number - 1]
        code = compatible_code(cell)
        png = [item["data"]["image/png"] for item in cell.get("outputs", [])
               if "image/png" in item.get("data", {})]
        try:
            with warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()):
                warnings.simplefilter("ignore")
                exec(compile(code, f"{title}:{number}", "exec"), variables)
            figures = plt.get_fignums()
            if len(figures) != len(png):
                raise ValueError(f"{title} cell {number}: expected {len(png)} figures, found {len(figures)}")
            for figure_number, encoded in zip(figures, png):
                figure = plt.figure(figure_number)
                published_layout(figure, chapter, number)
                reference = base64.b64decode("".join(encoded))
                stem = renderer.digest(reference)
                renderer.checked_bytes(originals / "_images" / (stem + ".png"), stem)
                try:
                    with baseline_layout(figure, chapter, number):
                        baseline = renderer.compare_raster(figure, reference)
                except ValueError as error:
                    print(f"Kept source raster for {title} cell {number}: {error}", file=sys.stderr)
                    continue
                geometry = renderer.plotted_data(figure)
                renderer.style_chart(figure)
                svg = renderer.vector_bytes(figure, stem)
                if renderer.plotted_data(figure) != geometry:
                    raise ValueError(f"{title} cell {number}: styling changed marks or labels")
                filename = stem + ".svg"
                (output / filename).write_bytes(svg)
                yield {
                    "source": stem + ".png",
                    "file": filename,
                    "chapter": title,
                    "cell": number,
                    "baseline": baseline,
                    "dataSha256": renderer.digest(geometry.encode()),
                    "svgSha256": renderer.digest(svg),
                }
        finally:
            plt.close("all")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("originals", type=Path, help="Pinned published book with _sources and _images")
    parser.add_argument("source_data", type=Path, help="Pinned upstream source data directory")
    parser.add_argument("output", type=Path, help="New directory for SVGs and their verification manifest")
    parser.add_argument("--notebook", choices=NOTEBOOKS, action="append",
                        help="Inspect only this notebook (repeat to select others)")
    args = parser.parse_args()
    originals = args.originals.resolve()
    source_data = args.source_data.resolve()
    output = args.output.resolve()
    if output == originals or originals in output.parents or output.exists():
        parser.error("Output must be a new directory outside the preserved original book")

    renderer = load_renderer()
    with tempfile.TemporaryDirectory(prefix="english-book-part-one-") as temporary:
        working = Path(temporary)
        data = working / "data"
        data.mkdir()
        for filename, expected in DATA.items():
            (data / filename).write_bytes(renderer.checked_bytes(source_data / filename, expected))
        os.environ["MPLCONFIGDIR"] = str(working / "matplotlib")
        os.environ["MPLBACKEND"] = "Agg"
        os.environ["OPENBLAS_NUM_THREADS"] = "1"
        os.environ["OMP_NUM_THREADS"] = "1"
        os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
        os.chdir(working)
        from matplotlib import pyplot as plt
        plt.show = lambda *args, **kwargs: None

        with tempfile.TemporaryDirectory(prefix=".book-part-one-", dir=output.parent) as staging:
            prepared = Path(staging) / "figures"
            prepared.mkdir()
            entries = []
            for title in dict.fromkeys(args.notebook or NOTEBOOKS):
                verified = list(redraw(renderer, originals, prepared, title))
                print(f"{title}: {len(verified)} verified", flush=True)
                entries.extend(verified)
            if not entries:
                raise ValueError("No verified figures to write")
            (prepared / "manifest.json").write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
            prepared.rename(output)


if __name__ == "__main__":
    main()
