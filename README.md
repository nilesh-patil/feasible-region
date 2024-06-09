# feasible region

*A visual field guide to linear programming.*

An interactive, [distill.pub](https://distill.pub)-style explainer of linear
programming and the simplex method: how optimization problems become systems
of linear constraints, why the optimum lives at a vertex of a convex polytope,
and how the simplex algorithm walks vertex to vertex until it gets there.

One solver core, three consumers:

- **`crates/feasible-core/`** — the simplex solver, written in Rust
- **`docs/`** — the site (GitHub Pages): the solver compiled to WebAssembly so
  readers can edit constraints and watch pivots live, with precomputed traces
  in `traces/` as a no-WASM fallback
- **`python/`** — Python bindings (PyO3/maturin), plus the reference
  implementation the Rust core is tested against

## Development

The whole project is driven by [pixi](https://pixi.sh):

```sh
pixi run test      # python + rust test suites
pixi run traces    # regenerate pivot traces (fixtures + site fallback)
pixi run serve     # site at http://localhost:8137
```

## Sources

Built while working through
[ICS 311 Topic 21 (Suthers, U. Hawaii)](https://www2.hawaii.edu/~suthers/courses/ics311f20/Notes/Topic-21.html),
CLRS chapter 29, and StatQuest's
[LP & simplex main ideas](https://www.youtube.com/watch?v=h5o1n1QMcmM).
