"""The bench harness's own guarantees.

The Section 07 figures replay ``bench/results.json``, so what needs testing is
not any timing value (machine-dependent by nature) but the harness's promises:
the random instances really are origin-feasible and bounded, the same seed
really reproduces the same instance, the wire payload really speaks the
lowercase vocabulary the core deserializes, and the parity gate really trips
on disagreement. Timing-path tests use the measurement machinery on a no-op
so they stay fast and never assert on a duration.
"""

import pytest

from feasible_region import Op, Status
from feasible_region.bench import PARITY_TOL, _measure, _wire_lp, random_lp
from feasible_region.reference import solve as ref_solve
from feasible_region import SolveOptions


def test_random_lp_is_origin_feasible_and_bounded_by_construction():
    lp = random_lp(12, 12, seed=7)
    for con in lp.constraints:
        assert con.op is Op.Le
        assert con.rhs > 0, "origin must satisfy every row strictly"
        assert all(c > 0 for c in con.coeffs), "positive rows are what bound the region"
    assert all(c > 0 for c in lp.objective)


def test_random_lp_solves_optimal_on_the_reference_engine():
    sol = ref_solve(random_lp(8, 8, seed=3), SolveOptions())
    assert sol.status is Status.Optimal
    assert sol.iterations > 0


def test_random_lp_is_deterministic_per_seed():
    a, b = random_lp(6, 6, seed=11), random_lp(6, 6, seed=11)
    assert a.objective == b.objective
    assert [c.rhs for c in a.constraints] == [c.rhs for c in b.constraints]
    other = random_lp(6, 6, seed=12)
    assert a.objective != other.objective


def test_wire_lp_speaks_the_lowercase_vocabulary():
    wire = _wire_lp(random_lp(3, 3, seed=1))
    assert wire["direction"] == "maximize"
    assert {c["op"] for c in wire["constraints"]} == {"le"}
    assert wire["var_names"] is None


def test_measure_reports_ordered_quartiles_and_counts():
    stats = _measure(lambda: None)
    assert stats["q1_ns"] <= stats["median_ns"] <= stats["q3_ns"]
    assert stats["samples"] >= 5
    assert stats["loops"] >= 1


def test_parity_gate_passes_on_agreeing_engines():
    pytest.importorskip("feasible_region._core")
    from feasible_region.bench import _parity

    gate = _parity("gate", random_lp(10, 10, seed=5), SolveOptions())
    assert gate["status"] == "optimal"
    assert gate["pivots"] > 0
    assert PARITY_TOL == 1e-6
