# OpenOracle upstream provenance

This directory vendors the OpenOracle 0.2.0 SlimStorage source used by Zoltar. The snapshot is pinned to the `SlimStorage` branch at OpenOracle repository commit [`a2d8515333b41fb2fb6f1f84663180ff4ceb5c7d`](https://github.com/openOracleProject/openOracle/commit/a2d8515333b41fb2fb6f1f84663180ff4ceb5c7d).

| Upstream source | Local source |
| --- | --- |
| `src/OpenOracleSlim.sol` | `OpenOracle.sol` |
| `src/libraries/Errors.sol` | `libraries/Errors.sol` |
| `src/interfaces/ISignatureTransfer.sol` | `interfaces/ISignatureTransfer.sol` |

The OpenOracle repository pins `lib/openzeppelin-contracts` to commit [`c64a1edb67b6e3f4a15cca8909c9482ad33a02b0`](https://github.com/OpenZeppelin/openzeppelin-contracts/commit/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0), the OpenZeppelin Contracts v5.4.0 release. The required OpenZeppelin files are pruned into `openzeppelin/contracts/` here.

The dedicated OpenOracle artifact pass reproduces the pinned upstream build profile: solc 0.8.28, IR compilation, 190 optimizer runs, and the Cancun EVM target. Keeping the exact compiler and profile is required because the contract validates hashes over packed calldata and memory representations.

Local Solidity files use this repository's Prettier formatting. `OpenOracleSlim.sol` is renamed to preserve the existing local import path and artifact name; there are no intentional semantic changes to the pinned upstream sources.

## Permit2 dependency

OpenOracle does not vendor the Permit2 implementation. It calls the fixed
singleton at `0x000000000022D473030F116dDEE9F6B43aC78BA3`; the local
`ISignatureTransfer.sol` file supplies only the ABI. The Uniswap Permit2 source
tag named for that deployed address resolves to commit
[`cc306b601f172c51bc04334a109e98340456620b`](https://github.com/Uniswap/permit2/tree/cc306b601f172c51bc04334a109e98340456620b).

At that pinned revision,
[`SignatureTransfer.sol`](https://github.com/Uniswap/permit2/blob/cc306b601f172c51bc04334a109e98340456620b/src/SignatureTransfer.sol)
checks the deadline and permitted-amount ceiling, consumes an unordered nonce,
builds the EIP-712 digest, verifies the signature, and transfers the requested
tokens.
[`EIP712.sol`](https://github.com/Uniswap/permit2/blob/cc306b601f172c51bc04334a109e98340456620b/src/EIP712.sol)
binds the domain to the Permit2 name, chain ID, and verifying-contract address.
[`SignatureVerification.sol`](https://github.com/Uniswap/permit2/blob/cc306b601f172c51bc04334a109e98340456620b/src/libraries/SignatureVerification.sol)
uses ECDSA recovery for EOAs and ERC-1271 validation for contract accounts.
OpenOracle separately fixes the Permit2 address, requires the signed permitted
amount to equal the credited amount, directs the requested transfer to itself,
and constructs the witness over beneficiary, relayer, token owner, and intent.
