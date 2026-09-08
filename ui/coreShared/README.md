# Core UI ownership

`ui/coreShared` contains runtime-neutral UI code. Product rules belong in a product shared library, and runnable application composition belongs in an application leaf.

- `components/` owns reusable primitives and composite controls.
- `forms/` owns parsing, validation, and form state helpers.
- `transactions/` owns transaction guards, presentation, receipts, and workflow state.
- `wallet/` owns providers, clients, chain identity, networks, and wallet assets.
- `navigation/` owns route and URL-state helpers.
- `protocol/` owns small cross-product contract actions and calculations.
- `simulation/` owns browser-local execution infrastructure.
- `hooks/` owns runtime-neutral Preact hooks.
- `tests/testUtils/` owns shared test-only helpers.

The forwarding modules under `lib/` preserve current public imports while consumers migrate to these owned subpaths. New reusable code should use the owned area directly.
