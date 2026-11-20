"""Rebuild the Synthetic Difference-in-Differences figures from the pinned book.

Use the plotting environment documented in redraw-book-plots.py with cvxpy
1.6.5, scikit-learn 1.3.2, toolz 0.12.1 and joblib 1.3.2. The upstream
source directory contains sc.py and data/smoking.csv.
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


CHAPTER = "25-Synthetic-Diff-in-Diff"
NOTEBOOK_SHA = "6c799109ca2411b1b81b1ea9636d2ec6462666e611a11c372837a7f3886ea424"
FILES = {
    "sc.py": "40d2aac9d2db7a1e60cbdbe69733de973304465473caa3354335c141f663e729",
    "data/smoking.csv": "bae31804ce53635822a4bda2b2622d92b707f8c35cf017ea2918a8fdb6083b89",
}
CHART_CELLS = {10, 12, 18, 26, 34, 47, 52, 55, 75}
DIAGNOSTIC_CELLS = {14, 20, 67, 69, 71, 72}


def load_renderer():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(
        "book_plot_renderer", Path(__file__).with_name("redraw-book-plots.py")
    )
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    return renderer


def cache_placebo_fits(variables):
    # This calculation has one deterministic result for each placebo state
    # and year, even when the same state is sampled repeatedly.
    from joblib import Parallel

    class ReuseRepeatedFits(Parallel):
        def __call__(self, calls):
            cache = {}
            results = []
            for fit, args, kwargs in calls:
                data = args[0]
                state = data.loc[data["treated"], "state"].iloc[0]
                if state not in cache:
                    cache[state] = fit(*args, **kwargs)
                results.append(cache[state])
            return results

    variables["Parallel"] = ReuseRepeatedFits


def redraw(renderer, originals, output, include_intervals):
    import matplotlib
    from matplotlib import pyplot as plt

    notebook = originals / "_sources" / (CHAPTER + ".ipynb")
    cells = json.loads(renderer.checked_bytes(notebook, NOTEBOOK_SHA))["cells"]
    matplotlib.rcParams.update({"figure.figsize": (6, 4), "figure.subplot.bottom": .125})
    variables = {}
    expected = CHART_CELLS if include_intervals else CHART_CELLS - {75}
    for number, cell in enumerate(cells[:max(expected)], 1):
        if cell["cell_type"] != "code" or not cell["source"] or number in DIAGNOSTIC_CELLS:
            continue
        code = "".join(cell["source"])
        with warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()):
            warnings.simplefilter("ignore")
            exec(compile(code, f"{CHAPTER}:{number}", "exec"), variables)
        if number == 66:
            cache_placebo_fits(variables)
        if number not in expected:
            continue
        png = [item["data"]["image/png"] for item in cell.get("outputs", [])
               if "image/png" in item.get("data", {})]
        figures = plt.get_fignums()
        try:
            if len(png) != 1 or len(figures) != 1:
                raise ValueError(f"Unexpected figures in chapter 25 cell {number}")
            figure = plt.figure(figures[0])
            reference = base64.b64decode("".join(png[0]))
            stem = renderer.digest(reference)
            renderer.checked_bytes(originals / "_images" / (stem + ".png"), stem)
            try:
                if number == 26:
                    # Match the inline crop of the twin-axis plot to the published width.
                    figure.set_figwidth(6.005)
                with matplotlib.rc_context({"savefig.facecolor": "none"}):
                    baseline = renderer.compare_raster(figure, reference)
            except ValueError as error:
                print(f"Kept source figure for chapter 25 cell {number}: {error}", flush=True)
                continue
            geometry = renderer.plotted_data(figure)
            renderer.style_chart(figure)
            if geometry != renderer.plotted_data(figure):
                raise ValueError(f"Plot styling changed the data in chapter 25 cell {number}")
            if number == 26:
                # Draw the legend after both axes so the secondary grid stays behind it.
                legend = figure.axes[0].get_legend()
                legend.remove()
                figure.add_artist(legend)
            svg = renderer.vector_bytes(figure, stem)
            filename = stem + ".svg"
            (output / filename).write_bytes(svg)
            print(f"Verified chapter 25 cell {number}: {baseline['structuralSimilarity']}", flush=True)
            yield {
                "source": stem + ".png",
                "file": filename,
                "chapter": CHAPTER,
                "cell": number,
                "baseline": baseline,
                "dataSha256": renderer.digest(geometry.encode()),
                "svgSha256": renderer.digest(svg),
            }
        finally:
            plt.close("all")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("originals", type=Path)
    parser.add_argument("upstream", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--include-intervals", action="store_true")
    args = parser.parse_args()
    originals, upstream, output = (path.resolve() for path in (args.originals, args.upstream, args.output))
    if output.exists() or output == originals or originals in output.parents:
        parser.error("Output must be a new directory outside the preserved original book")
    renderer = load_renderer()
    with tempfile.TemporaryDirectory(prefix="english-book-sdid-") as temporary:
        working = Path(temporary)
        (working / "data").mkdir()
        for name, expected in FILES.items():
            (working / name).write_bytes(renderer.checked_bytes(upstream / name, expected))
        os.environ.update(MPLBACKEND="Agg", MPLCONFIGDIR=str(working / "matplotlib"))
        os.chdir(working)
        sys.path.insert(0, str(working))
        with tempfile.TemporaryDirectory(prefix=".book-sdid-", dir=output.parent) as staging:
            prepared = Path(staging) / "figures"
            prepared.mkdir()
            records = list(redraw(renderer, originals, prepared, args.include_intervals))
            if not records:
                raise ValueError("No verified chapter 25 figures")
            (prepared / "manifest.json").write_text(json.dumps(records, indent=2) + "\n")
            prepared.rename(output)


if __name__ == "__main__":
    main()
