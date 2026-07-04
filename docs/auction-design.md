# Uniform Price Dual Cap Batch Auction

## Operational Lifecycle

The auction is owned by the coordinating `SecurityPoolForker`, not by the
bidder. That ownership is intentional:

```text
child pool shortfall -> forker starts auction -> bidders submit ETH
                    -> forker finalizes after 1 week
                    -> anyone can ask the forker to settle bid pages for a vault
```

`startAuction` and `finalize` are owner-only. Bids are accepted only after the
auction starts, before finalization, before `auctionStarted + 1 week`, and at a
tick whose effective `tickToPrice` value is nonzero.
After finalization, bidders do not call `withdrawBids` directly. The forker
withdraws auction results from the auction and converts purchased REP into
child-pool vault ownership plus the matching share of auctioned security-bond
allowance.

## Gas and Spam Bounds

The auction intentionally does not cap total bids or active price levels. A cap
would let an attacker spend ETH to fill the available bid slots or tick slots
early, preventing later valid bidders from participating.

Finalization remains bounded without those caps because it does not iterate over
raw bids. Bids at the same tick append to per-tick arrays for later paged
withdrawal, while clearing uses aggregate ETH totals stored in an AVL tree keyed
by tick. The valid tick range is finite: `[-524288, 524288]`, or `1,048,577`
possible price levels. An AVL tree containing every possible tick has maximum
height `28`, so `finalize()` only descends bounded tree paths and pruned
subtrees.

The gas tests cover both funded and underfunded finalization over a synthetic
max-depth tree for the full tick domain. They assert each path remains below
`20,000,000` gas and print the measured gas values in the test output.

Bid-count spam at one tick does not change finalization gas or clearing
correctness because same-tick bids only increase that tick's aggregate ETH. They
are settled later through caller-supplied, paged bid indexes.

## Refund and Settlement Paths

Clearly losing bids can be refunded before finalization once current demand is
enough to find a clearing tick. Only ticks below that found clearing tick can be
withdrawn through the pre-finalization refund path; binding or potentially
winning bids stay in the auction.

After finalization, paged settlement handles both claim and refund cases:

- losing bids receive ETH refunds
- winning bids convert ETH into purchased REP at the uniform clearing price
- marginal clearing-tick bids may be partially filled and partially refunded
- underfunded winning ticks receive only the REP demanded at each tick's bid limit
  price, and same-tick bids share that tick's REP demand pro rata by ETH

Zero-effective-price ticks are rejected when bids are submitted, so underfunded
settlement cannot assign REP to bids whose rounded ETH/REP price is zero.
Both finalized allocation paths carry division dust across paged withdrawals:
normal clearing carries `clearingRemainder` through the uniform-price
ETH-to-REP division, and underfunded clearing carries a per-tick remainder
through the same-tick ETH-to-REP allocation. Later withdrawals at the same tick
may receive the remainder carried from earlier integer division so bid-level
withdrawals reconcile to the aggregate finalized REP demanded at that tick.
