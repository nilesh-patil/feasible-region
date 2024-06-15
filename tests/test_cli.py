"""`python -m feasible_region.traces` CLI.

Runs the CLI as a subprocess (with PYTHONPATH -> <build>/python since the package
is not installed) and checks: it writes one schema-valid, geometry-carrying trace
per fixture; output is byte-stable across runs; `--check` passes against a freshly
generated dir and flags drift; `--only` regenerates a single fixture.
"""

import json
import os
import subprocess
import sys

import pytest

from conftest import EXPECTED, FIXTURE_NAMES, PYTHON_SRC


def run_traces(args):
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = PYTHON_SRC + (os.pathsep + existing if existing else "")
    return subprocess.run(
        [sys.executable, "-m", "feasible_region.traces", *args],
        capture_output=True,
        text=True,
        env=env,
    )


def test_writes_a_trace_file_per_fixture(tmp_path):
    out = tmp_path / "traces"
    res = run_traces(["--out", str(out)])
    assert res.returncode == 0, res.stderr
    for name in FIXTURE_NAMES:
        path = out / (name + ".json")
        assert path.exists(), "CLI did not write %s" % path
        data = json.loads(path.read_text())
        assert data["schema"] == "feasible-trace/v1"


def test_cli_file_carries_geometry(tmp_path):
    # The Python traces CLI is the sole producer of the optional `geometry` object.
    out = tmp_path / "traces"
    assert run_traces(["--out", str(out)]).returncode == 0
    data = json.loads((out / "statquest.json").read_text())
    geo = data["geometry"]
    assert set(("vertices", "edges", "bounded")).issubset(geo)
    assert isinstance(geo["bounded"], bool)


def test_cli_topic21_result_matches_expected(tmp_path):
    out = tmp_path / "traces"
    assert run_traces(["--out", str(out)]).returncode == 0
    result = json.loads((out / "topic21.json").read_text())["result"]
    assert result["status"] == "optimal"
    assert result["objective_value"] == pytest.approx(22.0, abs=1e-6)
    assert result["x"] == pytest.approx(EXPECTED["topic21"]["x"], abs=1e-6)


def test_output_is_byte_stable_across_two_runs(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    assert run_traces(["--out", str(first)]).returncode == 0
    assert run_traces(["--out", str(second)]).returncode == 0
    for name in FIXTURE_NAMES:
        a = (first / (name + ".json")).read_bytes()
        b = (second / (name + ".json")).read_bytes()
        assert a == b, "%s.json is not byte-stable across runs" % name


def test_check_passes_on_fresh_output(tmp_path):
    out = tmp_path / "traces"
    assert run_traces(["--out", str(out)]).returncode == 0
    res = run_traces(["--out", str(out), "--check"])
    assert res.returncode == 0, (res.stdout + res.stderr)


def test_check_flags_drift(tmp_path):
    out = tmp_path / "traces"
    assert run_traces(["--out", str(out)]).returncode == 0
    tampered = out / "statquest.json"
    data = json.loads(tampered.read_text())
    data["result"]["objective_value"] = 999.0
    tampered.write_text(json.dumps(data))
    res = run_traces(["--out", str(out), "--check"])
    assert res.returncode != 0


def test_only_regenerates_single_fixture(tmp_path):
    out = tmp_path / "traces"
    res = run_traces(["--out", str(out), "--only", "statquest"])
    assert res.returncode == 0, res.stderr
    assert (out / "statquest.json").exists()
    assert not (out / "topic21.json").exists()
