# Token authorization provenance

`AuthorizationSignatures.sol` is a compact adaptation of the EIP-712 hashing and
ECDSA recovery logic in OpenZeppelin Contracts v5.2.0 at commit
`acd4ff74de833399287ed6b31b4debf6b2b35527`, released under the MIT license:

- upstream repository: `https://github.com/OpenZeppelin/openzeppelin-contracts`
- release: `v5.2.0`
- source modules: `utils/cryptography/EIP712.sol`, `ECDSA.sol`, and
  `MessageHashUtils.sol`

Local modifications keep only the domain separator, typed-data hash, and strict
EOA recovery operations needed here; recompute the domain separator for the
current chain and token on every call; pin Solidity to `0.8.35`; use repository
formatting; and replace custom errors with descriptive revert strings.

`ERC20Authorization.sol` ports the audited EIP-2612 and EIP-3009 implementation
from Circle's `stablecoin-evm` v2.2.0 tag, peeled commit
`405efc100c016ed1a437063b6274b4e24ea7b8b1`, released under Apache-2.0:

- upstream repository: `https://github.com/circlefin/stablecoin-evm`
- source modules: `contracts/v2/EIP2612.sol`, `contracts/v2/EIP3009.sol`,
  `contracts/v2/EIP712Domain.sol`, `contracts/util/MessageHashUtils.sol`, and
  `contracts/util/ECRecover.sol`

Local modifications combine the two mixins into one module; update Solidity from
`0.6.12` to `0.8.35`; expose the standard public entry points directly; use the
repository's OpenZeppelin v5.2.0-derived ERC-20 transfer and approval hooks;
support the EOA `v`, `r`, `s` signatures required by the protocol while omitting
Circle's bytes-signature/ERC-1271 overloads; compute the dynamic EIP-712 domain
from the token's current name, chain, and address; replace Circle's inherited
storage with an ERC-7201-style namespaced storage region; use descriptive project
revert strings; and apply repository formatting. The EIP-2612 and EIP-3009 type
hashes, strict validity-window comparisons, recipient check, nonce lifecycle,
state transitions, and transfer/approval ordering remain the upstream behavior.

The namespaced authorization storage is deliberate: adding these standards does
not move the child REP token's pre-existing `totalTheoreticalSupplyAttoRep` at
storage slot 5. `shared/zoltar/ts/constants.ts` owns that slot anchor and the Solidity
tests read slot 5 directly after child initialization.
