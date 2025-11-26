# feasible region

*A visual field guide to linear programming.*

It's live at https://www.nilesh42.science/feasible-region/.

An interactive, distill.pub-style explainer of linear programming and the
simplex method. It starts from an ordinary word problem and turns it into a set
of linear constraints, then shows why the best answer always lands on a corner
of the feasible region. From there it walks those corners the way simplex does,
one pivot at a time, and dragging a constraint re-solves the whole thing live.
(The worked examples run from a plain diet problem to a starship's fabricator
bay, so the math has something concrete to hang on.)

## how it fits together

There is one simplex solver, written in Rust under `crates/feasible-core`, and a
pure-Python reference implementation in `python/feasible_region` that I check it
against. Three things read from that core:

- the site in `docs/`, running the core as WebAssembly built from
  `crates/feasible-wasm`, so editing the constraints re-solves live in the page;
- the Python package, which ships the pure-Python reference solver and can
  optionally load the same Rust core as a native extension (PyO3, from
  `crates/feasible-py`);
- the recorded traces in `traces/`, a solved run for each figure, used as the
  no-WASM fallback on the site and as the fixtures the tests run against.

The reference solver is also what records those traces, so the Python side ends
up being both the checker for the Rust core and the thing that draws the figures.

Section 07 of the site compares the implementations against each other: the
bench harness (`python/feasible_region/bench.py`, plus an in-process Rust leg
and a Node-driven WASM leg) times the same parity-gated walks on every engine
and records one run to `bench/results.json`, which the section's two figures
replay.

## running it

Everything goes through [pixi](https://pixi.sh):

```sh
pixi run test        # python + rust test suites
pixi run traces      # regenerate the pivot traces (fixtures + site fallback)
pixi run serve       # serve the site at http://localhost:8137
pixi run build-wasm  # compile the solver into docs/wasm/
pixi run bench       # re-record bench/results.json on your machine
pixi run bench-wasm  # add the browser build's numbers (needs node)
```

The WASM build is pinned to Rust 1.67.1. wasm-bindgen 0.2.84 refuses anything
newer, so `pixi run setup-msrv` installs that toolchain and the committed
`Cargo.lock` holds the proc-macro crates at versions old enough to build under
it. (`build-wasm` runs setup-msrv for you.)

## sources

- ICS311 Topic 21, Dan Suthers (University of Hawaii): the worked cargo problem
  and the network formulations.
  https://www2.hawaii.edu/~suthers/courses/ics311f20/Notes/Topic-21.html
- CLRS, *Introduction to Algorithms*: chapter 29 for linear programming and
  section 28.1 for the Gaussian elimination each pivot is really doing. The
  two-variable product-mix example is the standard one from any LP text.

Released under the MIT License.
