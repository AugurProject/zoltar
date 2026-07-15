# UI Features

Feature directories own their route-specific components, hooks, and domain presentation logic. Keep code inside the feature that gives it meaning; move it to `ui/ts/components`, `ui/ts/hooks`, or `ui/ts/lib` only when it is genuinely reusable across features.

Feature `lib` modules may own UI-agnostic calculations used only by that feature. If the protocol client also needs a calculation, place it in `ui/ts/protocol` or `ui/ts/lib`; protocol modules never import from feature directories.

Protocol reads and writes belong in `ui/ts/protocol`. Application-shell composition belongs in `ui/ts/app`; features must not import it. Reusable presentational components and generic helpers belong in `ui/ts/components`, `ui/ts/hooks`, `ui/ts/lib`, and `ui/ts/types`; those shared layers must not depend on app or feature modules. Simulation may depend on protocol and shared modules, but not feature presentation code.

Tests mirror feature names under `ui/ts/tests/features`, while app-shell tests live under `ui/ts/tests/app`. Feature-specific test support stays with its feature instead of the global `tests/testUtils` directory. Protocol and simulation tests may not reach upward into feature or app ownership. Browser-local simulation is an intentional top-level subsystem in `ui/ts/simulation`, with matching tests in `ui/ts/tests/simulation`.
