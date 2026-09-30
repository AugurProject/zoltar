# Core UI ownership

`ui/coreShared` contains runtime-neutral UI code. Product rules belong in a product shared library, and runnable application composition belongs in an application leaf.

- `components/` owns reusable primitives and composite controls.
- `forms/` owns parsing, validation, and form state helpers.
- `transactions/` owns transaction guards, presentation, receipts, and workflow state.
- `wallet/` owns providers, clients, chain identity, networks, and wallet assets.
- `navigation/` owns route and URL-state helpers.
- `app/` owns the reusable application shell: frame, header, notices, routing hooks, and on-chain runtime composition.
- `copy/` owns cross-product user-facing text (see `copy/README.md`).
- `types/` owns cross-product contract and component types; Statoblast product types live in `ui/statoblastShared/ts/types`.
- `simulation/` owns browser-local execution infrastructure.
- `hooks/` owns runtime-neutral Preact hooks.
- `tests/testUtils/` owns shared test-only helpers.

The focused modules under `lib/` own runtime-neutral helpers that do not fit a more specific area. New reusable code should import the narrow owning module directly.
