# Token authorization provenance

`AuthorizationSignatures.sol` is a compact adaptation of the EIP-712 hashing and
ECDSA recovery logic in OpenZeppelin Contracts v5.2.0, released under the MIT
license:

- upstream repository: `https://github.com/OpenZeppelin/openzeppelin-contracts`
- release: `v5.2.0`
- source modules: `utils/cryptography/EIP712.sol`, `ECDSA.sol`, and
  `MessageHashUtils.sol`

Local modifications keep only the stateless operations needed by this repository,
pin Solidity to `0.8.35`, use the repository's formatting, and replace custom
errors with descriptive revert strings. Token nonce and authorization state use
ERC-7201-style namespaced storage in `ERC20Authorization.sol`, so adding the
authorization mixin does not move pre-existing token storage slots.

`ERC20Authorization.sol` implements ERC-2612 and ERC-3009 using those primitives.
Its typed-data definitions and public behavior follow the respective standards;
the transfer, allowance, and event hooks remain provided by the repository's
vendored OpenZeppelin ERC-20 implementation.
