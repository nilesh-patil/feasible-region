"""Native (PyO3) vs pure-Python reference parity.

The compiled ``_core`` extension and the ``reference`` solver sit behind one
identical API. For every fixture they MUST agree on ``status``,
``objective_value`` and ``x`` within ``1e-9`` and — both running the same
deterministic rule — emit STRUCTURALLY identical ``feasible-trace/v1`` traces
(equal step count; per-step ``phase``/``basis``/``entering``/``leaving`` exact;
``tableau``/``vertex``/``objective_value`` within ``1e-9``). This is the
``1e-9`` agreement, NOT a byte-for-byte guarantee. A seeded fuzz sweep
reuses the property generator (``tests/test_property.py``) to compare
optima/status across backends, with scipy HiGHS as a shared independent oracle.

EVERY native assertion is *skipped* (never failed) when the
extension is not built, so a fresh clone runs the reference suite green and this
file only turns red once a real-but-wrong native binding is present.
"""

import pytest

import feasible_region as fr
from feasible_region import (
    Constraint,
    Direction,
    LinearProgram,
    Op,
    PivotRule,
    SolveError,
    SolveOptions,
    Status,
)

from conftest import FIXTURE_NAMES, build_lp, options_for

EPS = 1e-9


# --------------------------------------------------------------------------- #
# Native gating: skip, do not fail, when the extension is absent.
# --------------------------------------------------------------------------- #
def _require_native():
    try:
        from feasible_region import _core  # type: ignore  # noqa: F401
    except Exception:
        pytest.skip("native _core extension not built")
    if fr.backend() != "native":
        pytest.skip("native backend not active despite an importable _core")


def _native(lp, opts):
    return fr.solve(lp, opts, backend="native")


def _reference(lp, opts):
    return fr.solve(lp, opts, backend="reference")


# --------------------------------------------------------------------------- #
# Per-fixture Solution parity: status + objective + x (+ optional duals).
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_native_matches_reference_solution(name):
    _require_native()
    lp = build_lp(name)
    opts = options_for(name)
    nat = _native(lp, opts)
    ref = _reference(lp, opts)

    assert nat.status is ref.status, "%s: native %s vs reference %s" % (
        name,
        nat.status,
        ref.status,
    )

    if ref.status is Status.Optimal:
        assert nat.objective_value == pytest.approx(ref.objective_value, abs=EPS)
        assert nat.x == pytest.approx(ref.x, abs=EPS)
        # Duals are optional on both sides; compare only when
        # both backends compute them.
        if nat.duals is not None and ref.duals is not None:
            assert len(nat.duals) == len(ref.duals)
            assert nat.duals == pytest.approx(ref.duals, abs=EPS)
    else:
        assert nat.x == ref.x == []


# --------------------------------------------------------------------------- #
# Per-fixture trace parity: structurally identical steps, f64 within 1e-9
# This is the native trace cross-check.
# --------------------------------------------------------------------------- #
def _steps(sol):
    assert sol.trace is not None, "record_trace=True must yield a trace"
    return sol.trace["steps"]


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_native_trace_structurally_matches_reference(name):
    _require_native()
    lp = build_lp(name)
    opts = options_for(name, record_trace=True)
    nat = _steps(_native(lp, opts))
    ref = _steps(_reference(lp, opts))

    assert len(nat) == len(ref), "%s: native %d steps vs reference %d" % (
        name,
        len(nat),
        len(ref),
    )
    for i, (a, b) in enumerate(zip(nat, ref)):
        assert a["iter"] == b["iter"] == i
        assert a["phase"] == b["phase"], "%s step %d: phase" % (name, i)
        assert a["rule"] == b["rule"], "%s step %d: rule" % (name, i)
        assert a["basis"] == b["basis"], "%s step %d: basis" % (name, i)
        assert a["entering"] == b["entering"], "%s step %d: entering" % (name, i)
        assert a["leaving"] == b["leaving"], "%s step %d: leaving" % (name, i)
        assert a["vertex"] == pytest.approx(b["vertex"], abs=EPS), "%s step %d: vertex" % (name, i)
        assert a["objective_value"] == pytest.approx(
            b["objective_value"], abs=EPS
        ), "%s step %d: objective_value" % (name, i)
        assert len(a["tableau"]) == len(b["tableau"]), "%s step %d: tableau rows" % (name, i)
        for r, (ra, rb) in enumerate(zip(a["tableau"], b["tableau"])):
            assert ra == pytest.approx(rb, abs=EPS), "%s step %d tableau row %d" % (name, i, r)


# --------------------------------------------------------------------------- #
# Error parity ("same errors for the same inputs"). The kind string
# is the shared vocabulary across all three consumers.
# --------------------------------------------------------------------------- #
def test_native_raises_dimension_mismatch_like_reference():
    _require_native()
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[Constraint([1.0, 1.0, 1.0], Op.Le, 1.0)],
    )
    with pytest.raises(SolveError) as native_err:
        _native(lp, SolveOptions())
    with pytest.raises(SolveError) as reference_err:
        _reference(lp, SolveOptions())
    assert native_err.value.kind == reference_err.value.kind == "DimensionMismatch"


def test_native_raises_iteration_limit_on_dantzig_naive_cycle():
    _require_native()
    lp = build_lp("degenerate1")  # the Chvatal cycling LP
    opts = SolveOptions(pivot_rule=PivotRule.DantzigNaive, max_iterations=30)
    with pytest.raises(SolveError) as excinfo:
        _native(lp, opts)
    assert excinfo.value.kind == "IterationLimit"


# --------------------------------------------------------------------------- #
# Seeded fuzz sweep across backends — reuses the
# property generator so both backends AND the scipy oracle are cross-checked.
# --------------------------------------------------------------------------- #
FUZZ_SEEDS = list(range(40))


@pytest.mark.oracle
@pytest.mark.parametrize("seed", FUZZ_SEEDS)
def test_native_reference_agree_on_random_lp(seed):
    _require_native()
    pytest.importorskip("numpy")
    pytest.importorskip("scipy.optimize")
    from test_property import _generate  # reuse the existing fuzz LP generator

    lp, oracle_opt = _generate(seed)
    for rule in (PivotRule.Dantzig, PivotRule.Bland):
        opts = SolveOptions(pivot_rule=rule)
        nat = _native(lp, opts)
        ref = _reference(lp, opts)

        assert nat.status is ref.status, "seed %d rule %s: %s vs %s" % (
            seed,
            rule,
            nat.status,
            ref.status,
        )
        if ref.status is Status.Optimal:
            assert nat.objective_value == pytest.approx(ref.objective_value, abs=EPS)
            assert nat.x == pytest.approx(ref.x, abs=EPS)
            # both backends must also agree with the independent HiGHS oracle.
            assert nat.objective_value == pytest.approx(oracle_opt, abs=1e-6)


# --------------------------------------------------------------------------- #
# NUMERICS FLAG 3: the Minimize-sign and row_flipped dual
# paths have NO golden coverage — every shipped fixture is Maximize with rhs>=0.
# The reference is the trusted oracle and native is the new code, so these are
# the PRIMARY net: they turn red iff the native port ships a wrong Minimize sign
# or a wrong flipped-row dual. Skip-gated like every other native assertion.
# --------------------------------------------------------------------------- #
def _assert_native_matches_reference(lp, opts, ctx):
    nat = _native(lp, opts)
    ref = _reference(lp, opts)
    assert nat.status is ref.status is Status.Optimal, "%s: status" % ctx
    assert nat.objective_value == pytest.approx(ref.objective_value, abs=EPS), (
        "%s: objective_value" % ctx
    )
    assert nat.x == pytest.approx(ref.x, abs=EPS), "%s: x" % ctx
    assert nat.duals is not None and ref.duals is not None, (
        "%s: both backends compute duals" % ctx
    )
    assert nat.duals == pytest.approx(ref.duals, abs=EPS), "%s: duals" % ctx


def test_native_minimize_with_ge_matches_reference():
    # minimize x1+x2 s.t. x1+x2>=3 — exercises the internal-maximize/Minimize sign
    # and the Ge-artificial dual path. Oracle: x=(3,0), objective 3, dual [1].
    _require_native()
    lp = LinearProgram(
        direction=Direction.Minimize,
        objective=[1.0, 1.0],
        constraints=[Constraint([1.0, 1.0], Op.Ge, 3.0)],
    )
    _assert_native_matches_reference(lp, SolveOptions(), "minimize x1+x2 s.t. x1+x2>=3")


def test_native_negative_rhs_row_flip_matches_reference():
    # maximize x2 s.t. -x1<=-3, x1+x2<=5 — the rhs<0 row is negated (row_flipped)
    # and its dual re-oriented. Oracle: x=(3,2), objective 2, duals [1,1].
    _require_native()
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[0.0, 1.0],
        constraints=[
            Constraint([-1.0, 0.0], Op.Le, -3.0),  # rhs<0 -> row_flipped + artificial
            Constraint([1.0, 1.0], Op.Le, 5.0),
        ],
    )
    _assert_native_matches_reference(lp, SolveOptions(), "maximize x2 s.t. -x1<=-3, x1+x2<=5")
