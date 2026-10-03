# Markets and venues

This document owns how the [OpenOracle arbitrager](./README.md) discovers tokens and pools, which universes it may trade, how each Uniswap version is quoted and executed, and how the market manipulation guard applies.

**Contents**

- [Token and pool discovery](#token-and-pool-discovery)
- [Uniswap venue execution](#uniswap-venue-execution)
- [Independent CEX and DEX manipulation guard](#independent-cex-and-dex-manipulation-guard)

## Token and pool discovery

On Ethereum mainnet startup discovery reads Augur’s genesis universe, its forking market, and the instantiated child universes for every complete single-winner payout vector derived from that market's outcome count. Discovery must succeed before the bot scans or executes; an RPC or contract-read failure is surfaced as an operator error rather than silently omitting fork tokens. The resulting reputation tokens include:

| Token | Address |
| --- | --- |
| REPv2 | `0x221657776846890989a759BA2973e427DfF5C9bB` |
| REPv2_Yes_1 | `0xCf6A0A7826fa124B7705d6f3c675eAD76f1e540D` |
| REPv2_No_1 | `0x2F4005456c2F098358213f01DbE34abDAa2989A4` |

These tokens are discovered for monitoring only. Neither Augur discovery nor `tokenAddresses` authorizes execution. The latter adds monitoring tokens; the selected network's genesis REP is used for the top-level REP portfolio summary.

Both the arbitrager and liquidator use `approvedUniverses` from the canonical Zoltar universe tree. In **Settings → Approved universes**, select the root or the truthful child outcome and save the selection. The arbitrager and liquidator example configurations both start with no approvals. Approvals are saved per network profile; root universe `0` also requires approval. Only one child path per fork can be approved, including when selecting deeper descendants.

The arbitrager resolves approved universes to their exact onchain REP tokens on each scan. A newly deployed universe remains monitoring-only until approved; an arbitrary token address or an authenticated token contract does not grant universe approval. Approved tokens must additionally pass coordinator, liquidity, pricing, and profitability checks. Approval changes apply before the next execution scan. Revoking approval stops new positions; existing positions continue settlement and recovery.

## Uniswap venue execution

V2, V3, and V4 have independent enable switches. The selected venue supplies both hedge quotes and the replacement report ratio. Only V3 has the bot’s spot/TWAP filter. V2/V4 use current-block reserve or quoter evidence without a historical price filter; they still require RPC agreement, configured market-consensus checks, slippage limits, profitability, and atomic executor validation.

When V3 is enabled, market discovery checks all Uniswap V3 fee tiers (`0.01%`, `0.05%`, `0.3%`, and `1%`). Mainnet Uniswap V2 and SushiSwap V2 WETH pairs are discovered independently of the V3 switch. For V3, “Liquidity” is the pool contract’s raw in-range `liquidity()` value; for constant-product venues it shows both token reserves. Neither is a token-denominated TVL or a promise that the full game size can execute without price impact. “Price” is the decimal-normalized WETH-per-token spot price derived from V3 `sqrtPriceX96` or V2 reserves; it is not an executable size-aware quote. Each enabled version can execute independently. V3 execution uses QuoterV2 and the configured spot/TWAP guard. When `deployment.uniswapV2Enabled` is `true`, mainnet execution also reads the canonical Uniswap V2 pair reserves at the exact quorum quote block and evaluates the direct WETH/token route with the standard 0.30% fee:

```text
amount out = amount in × 997 × reserve out
             ÷ (reserve in × 1000 + amount in × 997)

amount in  = floor(reserve in × amount out × 1000
             ÷ ((reserve out − amount out) × 997)) + 1
```

When `deployment.uniswapV4Enabled` is `true`, the bot also asks the network-derived, authenticated V4 Quoter for exact-input and exact-output quotes against these exact pool keys:

| Fee units | Tick spacing |
| --- | --- |
| `100` | `1` |
| `500` | `10` |
| `3000` | `60` |
| `10000` | `200` |

Every supported key has `currency0 = native ETH`, `currency1 = report token`, and `hooks = address(0)`. The exact swap amount must be no greater than `2^127 - 1` token base units so every PoolManager delta fits a signed `int128`. For a buy, `zeroForOne = true`: the requested exact token output and returned token delta are positive, while the native input delta is negative and cannot exceed the signed maximum WETH input. For a sell, `zeroForOne = false`: the requested exact token input and returned token delta are negative, while the native output delta is positive and cannot fall below the signed minimum WETH output.

The [read quorum](./EXECUTION.md#read-agreement-and-finality) must agree on the quote at the exact quote block. The executor calls the authenticated PoolManager directly, requires those signed deltas to match the requested input or output, settles only those deltas, and converts native ETH to or from WETH before funding the OpenOracle dispute. Hooked pools, dynamic-fee pools, and any other fee/tick-spacing pair remain excluded because they can alter swap behavior or require a separate reviewed trust policy.

The bot compares complete strategy profit after its conservative gas and slippage reserves, not spot price alone. Every selected V2, V3, or V4 swap executes inside the same parent-bound atomic executor transaction with an exact minimum output or maximum input. SushiSwap V2 remains monitoring-only because it has no authenticated execution router. The bot will not silently fall back to an unsupported venue.

Price samples are stored at `runtime.priceHistoryFile`. The example uses `.state/prices-mainnet.jsonl`; keep files network-specific.

## Independent CEX and DEX manipulation guard

Operator-configured DEX sources use constant-product V2 pair semantics, while the arbitrager's own authenticated discovery and execution cover V2, V3, and V4.

The arbitrager uses the shared market observer described under [independent market consensus](../README.md#independent-market-consensus), which owns the source format, freshness and persistence rules, group agreement, required and advisory modes, and every `centralizedMarkets` key. This section covers only what is specific to the arbitrager.

The dashboard's **REP market sources** form edits the `centralizedMarkets` document as a source table plus threshold fields, with `venueConsensus` in its **Venue consensus** fieldset. It shows each normalized REP/ETH observation with its executable bid and ask depth, and reports the CEX median, DEX consensus, guarded reference, and DEX depth separately.

The guard runs during opportunity selection and again against the canonical final execution quote. That final check revalidates evidence age after simulation and canonical-chain preflight, before the durable pending-position journal is written, so an expired quote cannot authorize submission or leave an intent that recovery might broadcast.

With `venueConsensus` configured, the bot also builds a separate DEX consensus from executable two-sided Uniswap V2, V3, and V4 quotes. Each protocol is one failure domain regardless of its number of fee tiers. The venue selected for an opportunity is excluded from that opportunity's reference, so a candidate never votes for itself. Explicit constant-product pair sources can supplement those discovered venues; the bot pins their reserve reads and every executable quote to the scanned canonical block. Repeated polls of the same block retain the same native observation identity and cannot build temporal persistence. The bot rechecks the block hash after each market-read batch and discards DEX history if the canonical hash changes. Immediately before submission it also rereads every retained configured constant-product source at its exact evidence block and requires all available configured RPC responses to agree with that snapshot.

This reference does not replace executable Uniswap quotes, spot/TWAP checks, quorum reads, slippage limits, or profitability accounting. It is a second, off-chain manipulation signal. Operators must still verify that each configured exchange ticker represents the declared REP contract. The estimate is bound to that contract and chain; fork REP tokens without matching CEX markets remain ineligible when CEX confirmation is required and do not inherit the primary token's estimate.
