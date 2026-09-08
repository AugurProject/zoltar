# UI Protocol Client

This directory owns typed reads and writes against Zoltar and Statoblast contracts. Consumers import the focused module that owns each capability; there is no compatibility barrel.

UI components, hooks, and feature libraries may consume the protocol client. Dependencies must not point in the other direction: protocol modules never import from `ui/zoltarShared/ts/features`.

Calculations that prepare or interpret contract calls belong here when they are shared with a feature. General cross-app helpers belong in `ui/coreShared/ts/lib`; Zoltar-specific helpers belong in `ui/zoltarShared/ts/lib`. The UI-layer boundary lint rejects static, dynamic, exported, and type imports that point upward across protocol, feature, app, and shared-component ownership.
