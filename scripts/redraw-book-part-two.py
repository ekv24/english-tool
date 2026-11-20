"""Redraw verified plots from the pinned Part II and appendix notebooks.

Use the environment documented in redraw-book-plots.py, plus toolz 0.12.1,
scikit-learn 1.3.2, linearmodels 5.4, LightGBM 4.5.0, and CVXPY 1.6.5.
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
    "21-Meta-Learners": (
        "398a947ea25381998382b5c8add76cd76f6aaba42a468894817088ecb2f4ad90", 25, 3,
    ),
    "22-Debiased-Orthogonal-Machine-Learning": (
        "8b50a34547756fc6c068fe80d1269cd5576afe4b5c2823c14a28dfea02b98ae1", 60, 10,
    ),
    "23-Challenges-with-Effect-Heterogeneity-and-Nonlinearity": (
        "f288803e8d67d6abf246545d1b51050aa3aa456bf36967f42ba93955472790dd", 32, 9,
    ),
    "24-The-Diff-in-Diff-Saga": (
        "2b6ba7804f1dece5fbf7c948c74a2a6c39e682f42a192bec2efb9391b3901f10", 50, 12,
    ),
    "Prediction-Metrics-For-Causal-Models": (
        "c2682972b81e170ffa6c3a2b9ddf3f5e3b02dc96ce07b0d156cb8a99e5b75c6f", 15, 1,
    ),
    "Conformal-Inference-for-Synthetic-Control": (
        "6e9a0a316e7ff1337f76897afbfaf53d64ebf2ecfd2179eb84def5bf4c63041d", 45, 8,
    ),
    "Debiasing-with-Propensity-Score": (
        "a87ea6e190a183899de753e333c8718dcc6ccfe4246dea40014847dcef0ecd19", 50, 9,
    ),
    "When-Prediction-Fails": (
        "64789eb3341395de8bbbcdb3bec42c296b2de314db763a63259e81406d33366d", 44, 3,
    ),
}

DEPENDENCIES = {
    "21-Meta-Learners": ("nb21.py", "data/invest_email_biased.csv", "data/invest_email_rnd.csv"),
    "22-Debiased-Orthogonal-Machine-Learning": ("nb21.py", "data/ice_cream_sales.csv", "data/ice_cream_sales_rnd.csv"),
    "Conformal-Inference-for-Synthetic-Control": ("data/smoking.csv",),
    "Debiasing-with-Propensity-Score": ("data/invest_email.csv",),
    "When-Prediction-Fails": ("nb18.py",),
}
DEPENDENCY_HASHES = {
    "nb18.py": "a5599e8993851e936a80589aa7693895da6a86f3b85f8cf010dfd23857717925",
    "nb21.py": "c3c7ebed1b1139f530a9d96300ca231c5204549485c1c33a8a1a7897298d0a19",
    "data/smoking.csv": "bae31804ce53635822a4bda2b2622d92b707f8c35cf017ea2918a8fdb6083b89",
    "data/invest_email.csv": "c05b5c5beeb1ecfe124ba6fd9cfe9b0e12b6c68c93735aa3ccf33b5a85690d6f",
    "data/invest_email_biased.csv": "439deb3206eb3a048eec4118a6cd70dd74a379cd3968bf31f792e008f1214cbb",
    "data/invest_email_rnd.csv": "892677ae9c84bf79c7700f4019869c60826077b579aa1d1866433dc0264aa5d6",
    "data/ice_cream_sales.csv": "9558e49f64eb84b1718add8141b7decf89bc617374b01067214835857c93aee0",
    "data/ice_cream_sales_rnd.csv": "7d5ac735c742ac8d90ea266001c9bded9f3f7da421ee2dc1e3d6d92701205db4",
}
SELF_CONTAINED = (
    "23-Challenges-with-Effect-Heterogeneity-and-Nonlinearity",
    "24-The-Diff-in-Diff-Saga",
    "Prediction-Metrics-For-Causal-Models",
)
# Seaborn's confidence intervals draw from unrecorded bootstrap samples.
UNSEEDED_BOOTSTRAPS = {"When-Prediction-Fails": {14, 30}}


def load_renderer():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(
        "book_plot_renderer", Path(__file__).with_name("redraw-book-plots.py")
    )
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    return renderer


def plotted_geometry(renderer, figure):
    from matplotlib.text import Annotation

    # Annotations in chapter 23 label particular data-coordinate marks.
    annotations = [[{
        "text": text.get_text(),
        "position": text.get_position(),
        "anchor": text.xy if isinstance(text, Annotation) else None,
    } for text in ax.texts] for ax in figure.axes]
    return renderer.plotted_data(figure) + "\n" + json.dumps(annotations, sort_keys=True)


def legacy_stratified_kfold():
    import numpy as np
    from sklearn.model_selection import KFold, StratifiedKFold

    class LegacyStratifiedKFold(StratifiedKFold):
        def _make_test_folds(self, X, y=None):
            # Older scikit-learn split each class independently into contiguous folds.
            _, class_indices = np.unique(y, return_inverse=True)
            assignments = np.zeros(len(y), dtype=int)
            splitter = KFold(self.n_splits)
            for label, count in enumerate(np.bincount(class_indices)):
                folds = np.zeros(count, dtype=int)
                for fold, (_, indices) in enumerate(splitter.split(np.arange(max(count, self.n_splits)))):
                    folds[indices[indices < count]] = fold
                assignments[class_indices == label] = folds
            return assignments

    return LegacyStratifiedKFold


def notebook_code(title, number, cell):
    code = "".join(cell["source"])
    if title == "Conformal-Inference-for-Synthetic-Control" and number == 45:
        # The older backend implicitly coerced numeric Series in fill_between.
        return code.replace('ci_df["90_ci_lower"]', 'ci_df["90_ci_lower"].to_numpy()').replace(
            'ci_df["90_ci_upper"]', 'ci_df["90_ci_upper"].to_numpy()'
        )
    if title == "When-Prediction-Fails":
        # The imported private module is unused; sklearn renamed the same loss.
        return code.replace("from sklearn.ensemble import gradient_boosting\n", "").replace(
            "'loss': 'ls'", "'loss': 'squared_error'"
        )
    if title == "Debiasing-with-Propensity-Score":
        if number == 20:
            return code.replace("cv=3", "cv=LegacyStratifiedKFold(3)").replace(
                "cv=folds", "cv=LegacyStratifiedKFold(folds)"
            )
        if number in (11, 18, 28):
            # In the published FacetGrid, only the bottom axis labels name the variables.
            grid_created = 'g = sns.FacetGrid(plt_df, col="variable", hue="em1", col_wrap=4, sharey=False, sharex=False)'
            return code.replace(grid_created, grid_created + '\ng.set_titles("")\ng.tight_layout()')
    return code


def source_facecolor(reference):
    from PIL import Image

    with Image.open(io.BytesIO(reference)) as image:
        return "none" if image.convert("RGBA").getpixel((0, 0))[3] == 0 else "auto"


def restore_subplot_layout(title, number, figure):
    if title != "Debiasing-with-Propensity-Score":
        return
    # These margins reproduce the positions from the older Seaborn FacetGrid.
    if number in (11, 18, 28):
        figure.subplots_adjust(right=0.97455, wspace=0.266)
    if number in (37, 46):
        figure.subplots_adjust(bottom=0.118, top=0.9695)


def redraw(renderer, originals, output, title):
    import matplotlib
    from matplotlib import pyplot as plt

    expected, last_cell, count = NOTEBOOKS[title]
    path = originals / "_sources" / (title + ".ipynb")
    cells = json.loads(renderer.checked_bytes(path, expected))["cells"][:last_cell]
    matplotlib.rcdefaults()
    # Match the inline renderer's subplot margins in the pinned book.
    matplotlib.rcParams.update({"figure.figsize": (6, 4), "figure.subplot.bottom": 0.125})
    variables = {}
    if title == "Debiasing-with-Propensity-Score":
        variables["LegacyStratifiedKFold"] = legacy_stratified_kfold()
    seen = 0
    for number, cell in enumerate(cells, 1):
        if cell["cell_type"] != "code":
            continue
        code = notebook_code(title, number, cell)
        png = [item["data"]["image/png"] for item in cell.get("outputs", [])
               if "image/png" in item.get("data", {})]
        if number in UNSEEDED_BOOTSTRAPS.get(title, ()):
            seen += len(png)
            print(f"Kept source raster for {title} cell {number}: unrecorded bootstrap", file=sys.stderr)
            continue
        try:
            with warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()):
                warnings.simplefilter("ignore")
                exec(compile(code, f"{title}:{number}", "exec"), variables)
            figures = plt.get_fignums()
            if len(figures) != len(png):
                raise ValueError(f"{title} cell {number}: expected {len(png)} figures, found {len(figures)}")
            for figure_number, encoded in zip(figures, png):
                seen += 1
                figure = plt.figure(figure_number)
                restore_subplot_layout(title, number, figure)
                reference = base64.b64decode("".join(encoded))
                stem = renderer.digest(reference)
                renderer.checked_bytes(originals / "_images" / (stem + ".png"), stem)
                try:
                    # Some inline backends saved a transparent outer margin.
                    with matplotlib.rc_context({"savefig.facecolor": source_facecolor(reference)}):
                        baseline = renderer.compare_raster(figure, reference)
                except ValueError as error:
                    print(f"Kept source raster for {title} cell {number}: {error}", file=sys.stderr)
                    continue
                geometry = plotted_geometry(renderer, figure)
                renderer.style_chart(figure)
                svg = renderer.vector_bytes(figure, stem)
                if plotted_geometry(renderer, figure) != geometry:
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
    if seen != count:
        raise ValueError(f"{title}: expected {count} PNG outputs, found {seen}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("originals", type=Path, help="Pinned published book with _sources and _images")
    parser.add_argument("output", type=Path, help="New directory for SVGs and their verification manifest")
    parser.add_argument("--source-data", type=Path, help="Upstream checkout containing data/ and notebook helpers")
    parser.add_argument("--notebook", choices=NOTEBOOKS, action="append",
                        help="Inspect only this notebook (repeat to select others)")
    args = parser.parse_args()
    originals = args.originals.resolve()
    output = args.output.resolve()
    if output == originals or originals in output.parents or output.exists():
        parser.error("Output must be a new directory outside the preserved original book")
    selected = dict.fromkeys(args.notebook or (NOTEBOOKS if args.source_data else SELF_CONTAINED))
    dependencies = dict.fromkeys(path for title in selected for path in DEPENDENCIES.get(title, ()))
    if dependencies and not args.source_data:
        parser.error("Selected notebooks require --source-data")
    source_data = args.source_data.resolve() if args.source_data else None

    with tempfile.TemporaryDirectory(prefix="english-book-part-two-") as config:
        renderer = load_renderer()
        working = Path(config)
        for name in dependencies:
            content = renderer.checked_bytes(source_data / name, DEPENDENCY_HASHES[name])
            (working / name).parent.mkdir(parents=True, exist_ok=True)
            (working / name).write_bytes(content)
        os.environ["MPLCONFIGDIR"] = str(working / "matplotlib")
        os.environ["MPLBACKEND"] = "Agg"
        os.chdir(working)
        sys.path.insert(0, str(working))
        from matplotlib import pyplot as plt
        plt.show = lambda *args, **kwargs: None
        with tempfile.TemporaryDirectory(prefix=".book-part-two-", dir=output.parent) as staging:
            prepared = Path(staging) / "figures"
            prepared.mkdir()
            entries = []
            for title in selected:
                verified = list(redraw(renderer, originals, prepared, title))
                print(f"{title}: {len(verified)}/{NOTEBOOKS[title][2]} verified", flush=True)
                entries.extend(verified)
            if not entries:
                raise ValueError("No verified figures to write")
            (prepared / "manifest.json").write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
            prepared.rename(output)


if __name__ == "__main__":
    main()
