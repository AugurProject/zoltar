# UI Features

Feature directories own reusable product components, hooks, and domain presentation logic. Keep code inside the feature that gives it meaning; move cross-product code to `ui/coreShared/ts` or Zoltar-specific shared code to `ui/zoltarShared/ts` only when it is genuinely reusable across features.

Feature `lib` modules may own UI-agnostic calculations used only by that feature. If the protocol client also needs a calculation, place it in `ui/zoltarShared/ts/protocol` or the appropriate shared `lib`; protocol modules never import from feature directories.

Protocol reads and writes belong in `ui/zoltarShared/ts/protocol`. Application-shell composition belongs in `ui/zoltar/ts/app`; the shared library must not import it. Reusable presentational components and generic helpers belong in `ui/coreShared/ts`; those shared layers must not depend on any runnable application. Simulation may depend on protocol and shared modules, but not application composition.

Tests mirror feature names under `ui/zoltar/ts/tests/features`, while app-shell tests live under `ui/zoltar/ts/tests/app`. Feature-specific test support stays with its feature instead of the global `tests/testUtils` directory. Protocol and simulation tests may not reach upward into feature or app ownership. Browser-local simulation capabilities live in `ui/zoltarShared/ts/simulation`; shared simulation tests live under `ui/coreShared/ts/tests/simulation`, and Zoltar environment integration tests live under `ui/zoltar/ts/tests/integration`.
