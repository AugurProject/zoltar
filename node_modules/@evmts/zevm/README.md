# @evmts/zevm

TypeScript bindings for ZEVM's C ABI.

Native addons are distributed as optional platform packages. Local development builds can be produced from the repository root:

```bash
npm --prefix npm/zevm install --ignore-scripts
zig build npm-native
npm --prefix npm/zevm run typecheck
node npm/zevm/scripts/smoke.cjs zig-out/npm/native/zevm.node
```

The package exposes a light-client wrapper around the public `include/zevm.h` API. Calls on one `LightClient` instance must be serialized by the caller. Set `ZEVM_NATIVE_PATH=/absolute/path/to/zevm.node` to load a locally built addon instead of an optional platform package.
