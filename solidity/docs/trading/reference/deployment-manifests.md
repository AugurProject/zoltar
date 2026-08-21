# Deployment manifest reference

A generated manifest contains:

- `network`: decimal and hexadecimal chain IDs plus the deployment RPC;
- `core`: verified SecurityPoolFactory and source manifest path;
- `trading`: factory, router, and immutable `feeBps`;
- `transactions`: `factory` and `router` objects shaped as `{ hash, blockNumber: "<base-10 integer string>" }`. `blockNumber` is a JSON string, not a JavaScript number, so large receipt block numbers remain exact;
- `compilerProfiles`: exact versions and settings from the main Solidity artifact;
- `bytecodeHashes`: creation-bytecode commitments;
- `deployer` and `deployedAt`.

Pairs do not appear as static deployment inputs. Discover them dynamically with `getPair(pool)`, verify `isPair`, or derive the deterministic address with `predictPair`. Review a manifest before publishing it. Never copy local ephemeral addresses into a public-network file.
