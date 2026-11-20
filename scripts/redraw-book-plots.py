"""Rebuild verified plots from the pinned published book.

Tested with numpy 1.26.4, scipy 1.12.0, pandas 1.5.3, matplotlib 3.7.5,
seaborn 0.12.2, statsmodels 0.14.1, graphviz 0.20.3, Pillow 10.4.0,
scikit-image 0.22.0, linearmodels 5.4, joblib 1.3.2, scikit-learn 1.3.2,
toolz 0.12.1 and LightGBM 4.5.0.
No network access is needed. The CSVs are in the upstream repository's
causal-inference-for-the-brave-and-true/data directory at
4df1445987d3b6f9824d508863a1a2f0a503e888.
"""

import argparse
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import warnings


NOTEBOOKS = {
    "01-Introduction-To-Causality": (
        "d6ce615d22faac536f1d485f22d8cfd79a82426cae366316b79d4ecf12b69332", (2, 3, 9),
    ),
    "03-Stats-Review-The-Most-Dangerous-Equation": (
        "18c6b51f4b2682428fed25aa422771f1e70567536c8bd2723023205f45fb7c96",
        (2, 3, 5, 9, 11, 13, 14, 16, 17, 21, 23, 24, 26, 27),
    ),
    "05-The-Unreasonable-Effectiveness-of-Linear-Regression": (
        "8473cc27250df57875f5f76cdaadad84a51b57ae48a82ce093bb749ad9ba2468", (2, 13, 15),
    ),
    "06-Grouped-and-Dummy-Regression": (
        "f1c63620dadfbc4c86bd5e207f468fa5c1905661be7c11318e7bd49e55b13c2d",
        (2, 3, 5, 9, 11, 13, 15, 19, 23, 25, 29, 30),
    ),
    "07-Beyond-Confounders": (
        "7b5d52a0ce8b6cdb400f39a0c440b91338d0ca15adecd4531f9dd96efb8f5ecd", (2, 3, 9, 13),
    ),
    "08-Instrumental-Variables": (
        "01749f96f0b98e834eb47a05ec792afcb73012703fb1cc41449894b92d0660f8",
        (2, 9, 11, 12, 18, 32, 34, 36, 37, 38),
    ),
    "11-Propensity-Score": (
        "055a2d983125109143a96b506ad15a86f7f1820ec56a956b7539e77fa6b7fd3a",
        (2, 4, 10, 14, 16, 20, 22, 26, 30, 32, 34, 35, 37),
    ),
    "17-Predictive-Models-101": (
        "13f0009178ef30c2b01909650dd547987fd3b7ea13a08e0f7750c0d03521e895",
        (2, 4, 6, 9, 17, 19, 21, 23, 25, 27, 31, 33, 34),
    ),
    "18-Heterogeneous-Treatment-Effects-and-Personalization": (
        "fd3b1c32d11a89099637383b2d392a876aae184f061ec28837869369ffc05a04",
        (4, 5, 7, 9, 13, 15, 17, 19, 21, 23, 25),
    ),
    "19-Evaluating-Causal-Models": (
        "82352f86c48c9c4d76b2faa106367e8fd090140c1381e3f86686aecad2eb27dc",
        (2, 4, 6, 8, 12, 14, 16, 18),
    ),
    "20-Plug-and-Play-Estimators": (
        "3b5bf3fe2c5e2dd1646a9301fc424ea1d1458f64a06a9783d98025e713b28893",
        (3, 4, 6, 8, 10, 12, 14),
    ),
}
DATA = {
    "enem_scores.csv": "48ab322dbacb7b68e6c40c6491661d007c90f811ef740a2e84b026a9381d1cfd",
    "online_classroom.csv": "d3cb313e35ff56cb53d00d5658f5908a4302abae015ed0f5c4b88048bdc27b29",
    "wage.csv": "2a9ad52be0f98f4e4999a3dd4fcfbf5c780b02523974e3eea8c1b859939962c7",
    "collections_email.csv": "71079efbd3a1a0e3ee2bea58dfdcba4114f22cd5619ba0c8750e8477badbfe55",
    "ak91.csv": "7b0416f7421b5539570f7e050871214c6d5fe65bdd2664edf08a60faef85a48a",
    "learning_mindset.csv": "00e904b1bcc688857cc679d9035dac1b3ba892c3a03a4d5050eb43f101256fa7",
    "customer_features.csv": "e141d7a0af214108678a9fec95d42d7c9ccbf38d74a2879d883311536eaec50b",
    "customer_transactions.csv": "7fe1bf543665691a6c680ef94fe495b16343f2c271f9ae7b5bb1d035a7550adf",
    "ice_cream_sales.csv": "9558e49f64eb84b1718add8141b7decf89bc617374b01067214835857c93aee0",
    "ice_cream_sales_rnd.csv": "7d5ac735c742ac8d90ea266001c9bded9f3f7da421ee2dc1e3d6d92701205db4",
    "invest_email_rnd.csv": "892677ae9c84bf79c7700f4019869c60826077b579aa1d1866433dc0264aa5d6",
}
HELPER = "c3c7ebed1b1139f530a9d96300ca231c5204549485c1c33a8a1a7897298d0a19"
PAPER = "#faf9f5"
INK = "#141413"
GRID = "#dedbd1"
COLORS = {
    "#008fd5": "#365b73",
    "#1b86ba": "#62839a",
    "#fc4f30": "#a64b2f",
    "#e36149": "#d97757",
    "#e5ae38": "#8c6318",
    "#ffa500": "#8c6318",
    "#404040": "#5e5d59",
    "#6d904f": "#536649",
    "#8b8b8b": "#72677c",
    # Tableau and ggplot colors appear in the later notebooks.
    "#1f77b4": "#365b73",
    "#ff7f0e": "#a64b2f",
    "#2ca02c": "#617a49",
    "#d62728": "#96454d",
    "#9467bd": "#786591",
    "#8c564b": "#77594b",
    "#e377c2": "#a8587d",
    "#7f7f7f": "#62615a",
    "#bcbd22": "#827728",
    "#17becf": "#457f81",
    "#e24a33": "#a64b2f",
    "#348abd": "#365b73",
    "#988ed5": "#786591",
    "#777777": "#62615a",
    "#fbc15e": "#8c6318",
    "#8eba42": "#617a49",
    "#ffb5b8": "#bc8985",
}
PLOT_MARKS = {
    ("01", 3): ((27, 134, 186), (227, 97, 73), (64, 64, 64)),
    ("01", 9): ((0, 143, 213), (252, 79, 48)),
    ("11", 10): ((167, 210, 231), (185, 199, 178), (162, 182, 148), (229, 174, 56), (109, 144, 79)),
    ("20", 14): ((31, 119, 180), (255, 127, 14)),
}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def checked_bytes(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError(f"Unexpected pinned source bytes for {path}")
    return data


def compare_raster(figure, reference, marks=None, dpi=72, *, bbox="tight", transparent_margin=False,
                   mark_masks=None):
    from PIL import Image
    import numpy as np
    from skimage.metrics import structural_similarity

    generated = io.BytesIO()
    save_options = {"facecolor": "none", "edgecolor": "none"} if transparent_margin else {}
    figure.savefig(generated, format="png", dpi=dpi, bbox_inches=bbox, **save_options)
    with Image.open(io.BytesIO(reference)) as published, Image.open(generated) as baseline:
        if marks is None and baseline.size != published.size:
            raise ValueError(f"Baseline {baseline.size} differs from source {published.size}")
        if marks is None:
            original = np.asarray(published.convert("RGBA"))
            rerendered = np.asarray(baseline.convert("RGBA"))
            mark_check = compare_registered_marks(original, rerendered, mark_masks) if mark_masks else {}
            if mark_masks:
                mark_check["registrationOffsetPx"] = [0, 0]
        else:
            original, rerendered, mark_check = compare_marks(published, baseline, marks)
        similarity = structural_similarity(original, rerendered, data_range=255, channel_axis=2)
        if similarity < (0.92 if marks is not None or mark_masks else 0.98):
            raise ValueError(f"Baseline structural similarity is only {similarity:.5f}")
        return {
            "width": published.width,
            "height": published.height,
            "recreatedWidth": baseline.width,
            "recreatedHeight": baseline.height,
            "structuralSimilarity": round(float(similarity), 6),
            "identicalPixels": bool(np.array_equal(original, rerendered)),
            **mark_check,
        }


def compare_marks(published, baseline, marks):
    """Compare the original series colors when layout differs by a few pixels."""
    from PIL import Image
    import numpy as np
    from scipy.ndimage import shift
    from skimage.registration import phase_cross_correlation

    size = tuple(max(a, b) + 10 for a, b in zip(published.size, baseline.size))
    if any(abs(a - b) > 4 for a, b in zip(published.size, baseline.size)):
        raise ValueError("Plot dimensions differ")
    reference, recreated = (Image.new("RGB", size, "white") for _ in range(2))
    reference.paste(published.convert("RGB"), (5, 5))
    recreated.paste(baseline.convert("RGB"), (5, 5))
    a, b = np.asarray(reference), np.asarray(recreated)
    offset, _, _ = phase_cross_correlation(a.mean(axis=2), b.mean(axis=2), normalization=None)
    if np.max(np.abs(offset)) > 1:
        raise ValueError("Plot origin differs by more than one pixel")
    b = shift(b, (*offset, 0), order=0, cval=255)
    def by_color(rgb):
        return lambda image: np.all(image == rgb, axis=2)

    check = compare_registered_marks(a, b, [by_color(rgb) for rgb in marks])
    check["registrationOffsetPx"] = offset.astype(int).tolist()
    return a, b, check


def compare_registered_marks(a, b, masks):
    from scipy.ndimage import distance_transform_edt

    maximum = 0.0
    within_two = 1.0
    for mask in masks:
        first, second = mask(a), mask(b)
        for left, right in ((first, second), (second, first)):
            distances = distance_transform_edt(~right)[left]
            maximum = max(maximum, float(distances.max()))
            within_two = min(within_two, float((distances <= 2).mean()))
    if maximum > 3 or within_two < .995:
        raise ValueError("Plot marks differ from the original reference")
    return {
        "maxMarkDistancePx": round(maximum, 6),
        "minMarkShareWithinTwoPx": round(within_two, 6),
    }


def cropped_plot_baseline(figure, reference, chapter):
    """Match the source's transparent crop and the painted series geometry."""
    from matplotlib.transforms import Bbox
    from PIL import Image
    import numpy as np

    with Image.open(io.BytesIO(reference)) as published:
        width, height = published.size
    figure.set_dpi(72)
    figure.canvas.draw()
    bounds = figure.get_tightbbox(figure.canvas.get_renderer()).padded(.1)
    if chapter == "19":
        figure.subplots_adjust(bottom=.127)
        for axis in figure.axes:
            axis.tick_params(labelsize=10, pad=5)
            axis.xaxis.label.set_size(10)
        x_offset = 0
        masks = (lambda image: np.all(image == (31, 119, 180, 255), axis=2),)
    else:
        for axis in figure.axes:
            axis.tick_params(labelsize=10)
            axis.xaxis.label.set_size(10)
            axis.yaxis.label.set_size(10)
        x_offset = -.5
        masks = (residual_scatter_mask, residual_fit_mask)
    # The fractional bounds reproduce Agg's outward crop at 72 dpi.
    box = Bbox.from_bounds(
        bounds.x0 + x_offset / 72, bounds.y1 - (.5 + height + .12) / 72,
        (width + .12) / 72, (height + .12) / 72,
    )
    return compare_raster(figure, reference, bbox=box, transparent_margin=True, mark_masks=masks)


def residual_scatter_mask(image):
    r, g, b, alpha = (image[..., index].astype(int) for index in range(4))
    return (b - r > 18) & (b - g > 10) & (alpha > 240)


def residual_fit_mask(image):
    r, g, b, alpha = (image[..., index] for index in range(4))
    return (r > 240) & (g < 130) & (b < 100) & (alpha > 240)


def plotted_data(figure):
    """Record numeric mark geometry, scales, and all axis and legend labels."""
    import numpy as np

    axes = []
    for ax in figure.axes:
        legend = ax.get_legend()
        axes.append({
            "limits": [ax.get_xlim(), ax.get_ylim()],
            "scales": [ax.get_xscale(), ax.get_yscale()],
            "ticks": [np.asarray(ax.get_xticks()).tolist(), np.asarray(ax.get_yticks()).tolist()],
            "text": [ax.get_title(), ax.get_xlabel(), ax.get_ylabel()],
            "tickLabels": [t.get_text() for t in (*ax.get_xticklabels(), *ax.get_yticklabels())],
            "legend": [t.get_text() for t in legend.get_texts()] if legend else [],
            "lines": [line.get_xydata().tolist() for line in ax.lines],
            "patches": [p.get_patch_transform().transform_path(p.get_path()).vertices.tolist()
                        for p in ax.patches],
            "collections": [{"offsets": c.get_offsets().tolist(),
                             "paths": [p.vertices.tolist() for p in c.get_paths()]}
                            for c in ax.collections],
        })
    return json.dumps(axes, sort_keys=True, separators=(",", ":"))


def style_chart(figure):
    """Apply appearance to the computed artists and their legend copies."""
    from matplotlib.collections import Collection
    from matplotlib.colors import to_hex, to_rgba
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    from matplotlib.text import Text

    def color(value):
        rgba = to_rgba(value)
        return to_rgba(COLORS.get(to_hex(rgba), rgba), rgba[3])

    # Recolor explicit series marks and matching legend handles together.
    for artist in figure.findobj():
        if isinstance(artist, Text):
            artist.set_color(INK)
        elif isinstance(artist, Line2D):
            artist.set_color(color(artist.get_color()))
            artist.set_markerfacecolor(color(artist.get_markerfacecolor()))
            artist.set_markeredgecolor(color(artist.get_markeredgecolor()))
        elif isinstance(artist, Collection):
            artist.set_facecolor([color(c) for c in artist.get_facecolor()])
            artist.set_edgecolor([color(c) for c in artist.get_edgecolor()])
        elif isinstance(artist, Patch):
            artist.set_facecolor(color(artist.get_facecolor()))
            artist.set_edgecolor(color(artist.get_edgecolor()))

    figure.patch.set_facecolor(PAPER)
    for ax in figure.axes:
        ax.set_facecolor(PAPER)
        for line in (*ax.get_xgridlines(), *ax.get_ygridlines()):
            line.set_color(GRID)
        for spine in ax.spines.values():
            spine.set_edgecolor(GRID)
        legend = ax.get_legend()
        if legend:
            legend.get_frame().set_facecolor("#fffdf8")
            legend.get_frame().set_edgecolor(GRID)


def vector_bytes(figure, stem):
    import matplotlib

    output = io.StringIO()
    with matplotlib.rc_context({"svg.hashsalt": stem}):
        figure.savefig(output, format="svg", dpi=72, bbox_inches="tight", facecolor=PAPER,
                       metadata={"Date": None, "Description": "Redrawn from the published notebook."})
    svg = output.getvalue()
    svg = svg[svg.index("<svg "):]
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.DOTALL)
    svg = re.sub(r"(?<=\S)\s*\n\s*(?=\S)", " ", svg)
    return re.sub(r">\s+<", "><", svg).strip().encode() + b"\n"


def notebook_code(chapter, number, cell):
    code = "".join(cell["source"])
    code = "\n".join(line for line in code.splitlines() if line.strip() != "%matplotlib inline")
    if chapter == "08":
        if number == 32:
            # Recent Formulaic resolves formula variables from the data columns.
            return code + '\nsim_data["X"] = X'
        if number == 38:
            # Matplotlib 3.7 requires array operands for fill_between.
            return "\n".join(re.sub(r'plot_data\[("[^"]+")\]', r'plot_data[\1].to_numpy()', line)
                             if index < 4 else line for index, line in enumerate(code.splitlines()))
    if chapter == "11":
        if number == 2:
            # This dependency is not referenced in the selected cells.
            return code.replace("from causalinference import CausalModel\n", "")
        if number == 26:
            # The sample order and fits stay the same in serial execution.
            return code.replace("n_jobs=4", "n_jobs=1")
    if chapter == "17":
        if number == 19:
            return code.replace('x="net_value")', 'x="net_value", color="#348abd")')
        if number == 23:
            return code.replace("'ls'", "'squared_error'")
        if number == 31:
            return code.replace('x="net_value", label=', 'x="net_value", color="#348abd", label=')
        if number == 34:
            # Preserve the original random seed used for the notebook's bootstrap bars.
            return code.replace("sns.barplot(data=", "sns.barplot(seed=123, data=")
    if chapter == "18" and number in (23, 25):
        # Modern Seaborn uses its own generator for the confidence-band bootstrap.
        return code.replace('x="price", y="sales")', 'x="price", y="sales", seed=123)')
    if chapter == "20" and number == 10:
        return code.replace("num_leaves=5", "num_leaves=5, n_jobs=1, verbosity=-1")
    return code


def run_notebook(originals, output, title, expected, selected_cells):
    import matplotlib
    import matplotlib.pyplot as plt

    notebook = originals / "_sources" / (title + ".ipynb")
    cells = json.loads(checked_bytes(notebook, expected))["cells"]
    chapter = title[:2]
    matplotlib.rcdefaults()
    # This setting matches the inline backend's published default for these notebooks.
    matplotlib.rcParams["figure.figsize"] = (6, 4)
    if chapter in ("17", "18", "19", "20"):
        matplotlib.rcParams["figure.subplot.bottom"] = .125
    if chapter == "20":
        matplotlib.rcParams["text.antialiased"] = False
    variables = {}
    for number in selected_cells:
        cell = cells[number - 1]
        code = notebook_code(chapter, number, cell)
        png = [record["data"]["image/png"] for record in cell.get("outputs", [])
               if "image/png" in record.get("data", {})]
        try:
            with warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()):
                warnings.simplefilter("ignore")
                exec(compile(code, f"{title}:{number}", "exec"), variables)
            if chapter == "01" and number == 2:
                matplotlib.rcParams.update({
                    "figure.facecolor": "white", "savefig.facecolor": "white", "font.size": 11,
                    "axes.titlesize": 14, "axes.titleweight": "bold", "axes.labelsize": 11,
                    "text.antialiased": False,
                })
            if chapter == "07" and number == 2:
                matplotlib.rcParams.update({"font.size": 11, "axes.labelsize": 11, "figure.subplot.bottom": .125})
            figures = plt.get_fignums()
            if len(figures) != len(png):
                raise ValueError(f"{title} cell {number}: expected {len(png)} figures, found {len(figures)}")
            for figure_number, encoded in zip(figures, png):
                figure = plt.figure(figure_number)
                if chapter == "01":
                    # Calibrate the vertical size to the source's reference grid.
                    figure.set_size_inches(figure.get_figwidth(), figure.get_figheight() * .931)
                reference = base64.b64decode("".join(encoded))
                stem = digest(reference)
                checked_bytes(originals / "_images" / (stem + ".png"), stem)
                if chapter in ("07", "19"):
                    baseline = cropped_plot_baseline(figure, reference, chapter)
                else:
                    baseline = compare_raster(figure, reference, PLOT_MARKS.get((chapter, number)),
                                              dpi=100 if chapter == "18" else 72)
                original_data = plotted_data(figure)
                style_chart(figure)
                svg = vector_bytes(figure, stem)
                if plotted_data(figure) != original_data:
                    raise ValueError(f"{title} cell {number}: styling changed plotted values or labels")
                path = output / (stem + ".svg")
                path.write_bytes(svg)
                yield {
                    "source": stem + ".png",
                    "file": path.name,
                    "chapter": title,
                    "cell": number,
                    "baseline": baseline,
                    "dataSha256": digest(original_data.encode()),
                    "svgSha256": digest(svg),
                }
        finally:
            plt.close("all")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("originals", type=Path, help="Pin of the rendered book with _sources and _images")
    parser.add_argument("source_data", type=Path, help="Directory with the pinned upstream data files")
    parser.add_argument("output", type=Path, help="New directory for the SVGs and their verification manifest")
    parser.add_argument("--chapters", default=",".join(name[:2] for name in NOTEBOOKS),
                        help="Comma-separated chapter numbers to rerun")
    args = parser.parse_args()
    originals = args.originals.resolve()
    source_data = args.source_data.resolve()
    output = args.output.resolve()
    if output == originals or originals in output.parents or output.exists():
        parser.error("Output must be a new directory outside the preserved original book")
    chapters = set(args.chapters.split(","))
    if not chapters <= {name[:2] for name in NOTEBOOKS}:
        parser.error("Unknown chapter number")

    with tempfile.TemporaryDirectory(prefix="english-book-plots-") as temporary:
        working = Path(temporary)
        (working / "data").mkdir()
        for file, expected in DATA.items():
            (working / "data" / file).write_bytes(checked_bytes(source_data / file, expected))
        os.environ["MPLCONFIGDIR"] = str(working / "matplotlib")
        os.environ["MPLBACKEND"] = "Agg"
        os.environ["OPENBLAS_NUM_THREADS"] = "1"
        os.environ["OMP_NUM_THREADS"] = "1"
        os.chdir(working)
        if "20" in chapters:
            helper = checked_bytes(source_data.parent / "nb21.py", HELPER)
            (working / "nb21.py").write_bytes(helper)
            spec = importlib.util.spec_from_file_location("nb21", working / "nb21.py")
            module = importlib.util.module_from_spec(spec)
            sys.modules["nb21"] = module
            spec.loader.exec_module(module)
        import matplotlib.pyplot as plt
        plt.show = lambda *args, **kwargs: None  # Capture the figures after their notebook cell.

        with tempfile.TemporaryDirectory(prefix=".book-redraw-", dir=output.parent) as staging:
            prepared = Path(staging) / "figures"
            prepared.mkdir()
            entries = [entry for name, (expected, cells) in NOTEBOOKS.items()
                       if name[:2] in chapters
                       for entry in run_notebook(originals, prepared, name, expected, cells)]
            if not entries:
                raise ValueError("No charts were redrawn")
            manifest = prepared / "manifest.json"
            manifest.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
            prepared.rename(output)
            print(f"Redrew {len(entries)} verified figures in {output}")


if __name__ == "__main__":
    main()
