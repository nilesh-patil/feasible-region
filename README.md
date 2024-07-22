# feasible region

*A visual field guide to linear programming.*

Live at **https://nilesh-patil.github.io/feasible-region/**.

An interactive, [distill.pub](https://distill.pub)-style explainer of linear
programming and the simplex method: how optimization problems become systems of
linear constraints, why the optimum sits at a vertex of a convex polytope, and
how simplex walks vertex to vertex until it arrives.

## Architecture

One simplex core, written in Rust in `crates/feasible-core/` and validated
against a Python reference implementation. Three consumers read from it:

- **`docs/`** (the browser, served on GitHub Pages): the core compiled to
  WebAssembly via `crates/feasible-wasm/`, so readers can edit constraints and
  watch pivots re-solve live.
- **`python/feasible_region/`** (Python): PyO3 bindings through
  `crates/feasible-py/`, alongside the reference implementation that both tests
  the Rust core and records the traces.
- **`traces/`** (precomputed pivots): the recorded solve of each figure, used as
  the site's no-WASM fallback and as the test fixtures.

## Development

The whole project is driven by [pixi](https://pixi.sh):

```sh
pixi run test        # python + rust test suites
pixi run traces      # regenerate pivot traces (fixtures + site fallback)
pixi run serve       # site at http://localhost:8137
pixi run build-wasm  # compile the solver into docs/wasm/
```

`build-wasm` runs through a pinned Rust 1.67.1 toolchain. wasm-bindgen
0.2.84 rejects newer compilers, so `pixi run setup-msrv` installs 1.67.1 and the
committed `Cargo.lock` holds the proc-macro tree at versions that build on it.

## Sources

- **ICS311 Topic 21** (Dan Suthers, University of Hawaii, fall 2020 offering):
  the worked cargo problem and the network formulations.
  https://www2.hawaii.edu/~suthers/courses/ics311f20/Notes/Topic-21.html
- **CLRS**, *Introduction to Algorithms*: chapter 29 (linear programming) and
  section 28.1 (the Gaussian elimination each pivot performs). The fab-bay
  problem is an instance of the classic two-variable product-mix exercise
  found in any linear programming text.

Released under the MIT License.
