# Deployment manifest reference

A generated manifest contains:

- `network`: decimal and hexadecimal chain IDs plus the deployment RPC;
- `core`: verified SecurityPoolFactory and source manifest path;
- `trading`: factory, router, and immutable `feeBps`;
- `transactions`: factory and router deployment hashes;
- `compiler`: exact version and settings;
- `bytecodeHashes`: creation-bytecode commitments;
- `deployer` and `deployedAt`.

Pairs do not appear as static deployment inputs. Discover them dynamically with `getPair(pool)`, verify `isPair`, or derive the deterministic address with `predictPair`. Review a manifest before publishing it. Never copy local ephemeral addresses into a public-network file.
