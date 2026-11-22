/**
 * Advisories every dependency audit accepts, each with the reason it cannot be fixed by an upgrade or override. Remove an
 * entry as soon as a patched release exists.
 *
 * GHSA-vfj7-8cjw-p6xm: braces <= 3.0.3 exhausts the stack on deeply nested brace patterns and has no patched release. Its
 * only path is @tevm/compiler > solc-typed-ast > findup-sync > micromatch, and the only caller is solc-typed-ast's import
 * resolver, which passes the constant pattern `node_modules/`. No pattern from this repository, a user, or a remote party
 * reaches braces.
 *
 * GHSA-mrhx-c7xc-m3w5: the remaining Zod 3.25.76 copy has no patched v3 release; Web3 validator requires its v3 API.
 * It is used only by @tevm/compiler > solc-typed-ast > web3-eth-abi / web3-utils > web3-validator. The repository does
 * not import that compiler chain, and the four production simulation workers contain only patched Zod v4. The audit
 * runner enforces the inspected legacy versions and dependency paths and rejects vulnerable runtime Zod copies before
 * ignoring this advisory. Recheck reachability if compiler imports change; do not replace v3 with an incompatible v4.
 *
 * GHSA-fc5q-39xc-vjpf: picomatch 4.0.7 and 2.3.2 have no patched release. The v4 copy is used by Knip and
 * transitive Vitest/Vite/unplugin build tooling; repository source imports none of those glob tools, and none appears
 * in the four production simulation-worker source maps. Knip reads repository-owned configuration. The v2 copy is
 * restricted to the same constant-pattern compiler import resolver described above. The audit runner pins these
 * copies, their tooling versions and parent paths, and rejects direct workspace use except the existing Knip dev
 * dependencies. Recheck reachability when build imports change; remove this exception when a patch is released.
 */
export const acceptedAuditAdvisories = ['GHSA-vfj7-8cjw-p6xm', 'GHSA-mrhx-c7xc-m3w5', 'GHSA-fc5q-39xc-vjpf'] as const
