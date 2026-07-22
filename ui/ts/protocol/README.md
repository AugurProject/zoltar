# UI Protocol Client

This directory owns typed reads and writes against Zoltar and Statoblast contracts. `index.ts` is the compatibility entrypoint; implementations belong in domain modules instead of the barrel.

UI components, hooks, and feature libraries may consume the protocol client. Dependencies must not point in the other direction: protocol modules never import from `ui/ts/features`.

Calculations that prepare or interpret contract calls belong here when they are shared with a feature. General UI-independent helpers belong in `ui/ts/lib`. The UI-layer boundary lint rejects static, dynamic, exported, and type imports that point upward across protocol, feature, app, and shared-component ownership.
