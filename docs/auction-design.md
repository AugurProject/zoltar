# Uniform Price Dual Cap Batch Auction

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
