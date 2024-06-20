"""Golden-trace equality against the COMMITTED ``traces/*.json``.

The other trace tests re-solve and validate structure, and the CLI ``--check``
test diffs a fresh temp dir against itself — neither pins the *committed* golden
files to the current solver. This module closes that gap two ways:

* **Semantic** — for every named fixture the committed trace and a
  fresh reference solve MUST agree on ``result.status``, ``result.x`` (1e-9),
  ``result.objective_value`` (1e-9), the ``(entering, leaving)`` pivot sequence
  (exact), and every ``steps[*].tableau`` value (1e-9).
* **Byte-level** — regenerating each committed file in-process
  through the traces CLI's own serializer MUST reproduce it byte-for-byte, i.e.
  ``pixi run traces`` would be a no-op diff. This is what catches an
  implementation change that drifts from the committed goldens.
"""

import json
from pathlib import Path

import pytest

from feasible_region import traces
from feasible_region.reference import solve

from conftest import EXPECTED, FIXTURE_NAMES, build_lp, options_for

TRACES_DIR = Path(__file__).resolve().parent.parent / "traces"
EPS = 1e-9


def _committed(name):
    return json.loads((TRACES_DIR / (name + ".json")).read_text())


def _ref_trace(name):
    return solve(build_lp(name), options_for(name, record_trace=True)).trace


def _approx_tableau(a, b, tol=EPS):
    assert len(a) == len(b)
    for ra, rb in zip(a, b):
        assert len(ra) == len(rb)
        for va, vb in zip(ra, rb):
            assert va == pytest.approx(vb, abs=tol)


# --------------------------------------------------------------------------- #
# Semantic golden equality.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_committed_trace_matches_reference_solve(name):
    committed = _committed(name)
    ref = _ref_trace(name)

    assert committed["schema"] == "feasible-trace/v1"
    assert committed["result"]["status"] == ref["result"]["status"]
    assert committed["result"]["status"] == EXPECTED[name]["status"].lower()

    if committed["result"]["status"] == "optimal":
        assert committed["result"]["x"] == pytest.approx(ref["result"]["x"], abs=EPS)
        assert committed["result"]["objective_value"] == pytest.approx(
            ref["result"]["objective_value"], abs=EPS
        )

    cs, rs = committed["steps"], ref["steps"]
    assert len(cs) == len(rs), "%s: step count %d != %d" % (name, len(cs), len(rs))
    for i, (c, r) in enumerate(zip(cs, rs)):
        assert c["iter"] == r["iter"] == i
        assert c["phase"] == r["phase"]
        assert c["rule"] == r["rule"]
        assert c["basis"] == r["basis"]
        # the (entering, leaving) pivot sequence is exact (int/null).
        assert c["entering"] == r["entering"], "%s step %d entering" % (name, i)
        assert c["leaving"] == r["leaving"], "%s step %d leaving" % (name, i)
        assert c["vertex"] == pytest.approx(r["vertex"], abs=EPS)
        assert c["objective_value"] == pytest.approx(r["objective_value"], abs=EPS)
        _approx_tableau(c["tableau"], r["tableau"])


def test_topic21_committed_pins_canonical_path():
    # The canonical anchor: committed goldens still encode the hand-derived walk.
    committed = _committed("topic21")
    verts = [s["vertex"] for s in committed["steps"]]
    assert verts == [[0, 0, 0], [8, 0, 0], [12, 3, 0], [12, 3, 4], [9, 9, 4]]
    assert committed["result"]["x"] == [9, 9, 4]
    assert committed["result"]["objective_value"] == 22


# --------------------------------------------------------------------------- #
# Byte-level no-op regeneration: `pixi run traces` is a no-op.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", traces._all_names())
def test_regen_reproduces_committed_trace_bytes(name):
    committed_text = (TRACES_DIR / (name + ".json")).read_text()
    regen_text = traces._serialize(traces._trace_for(name, "reference"))
    assert regen_text == committed_text, "%s.json drifts from the current solver" % name


@pytest.mark.parametrize(
    "name",
    sorted(p.stem[len("centralpath-"):] for p in TRACES_DIR.glob("centralpath-*.json")),
)
def test_regen_reproduces_committed_centralpath_bytes(name):
    committed_text = (TRACES_DIR / ("centralpath-%s.json" % name)).read_text()
    cp = traces._central_path_file(name)
    assert cp is not None, "%s: central path no longer generated" % name
    assert traces._serialize(cp) == committed_text, "centralpath-%s.json drifts" % name
