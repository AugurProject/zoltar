# Units and rounding

- ETH and collateral outputs use wei.
- Shares and LP tokens use their atomic `uint256` units. Zoltar’s initial complete-set scale is `1e18` shares per wei, but retention makes the live ratio dynamic.
- Fees, slippage, initial conditional price, and displayed conditional price use basis points over 10,000 where applicable.
- Deadlines and question end times are Unix seconds.
- Universe IDs are `uint248`. A token ID is `(universeId << 8) | outcome`, with local outcomes INVALID=0, YES=1, NO=2.

Exact input computes `net = floor(gross × (10,000 − fee) / 10,000)` and `out = floor(reserveOut × net / (reserveIn + net))`. Exact output computes `net = ceil(reserveIn × out / (reserveOut − out))` and `gross = ceil(net × 10,000 / (10,000 − fee))`. These directions favor existing LPs.

Liquidity deposits round reserve use down. Removal rounds each reserve output down. Initial alternative odds round the smaller deposited reserve down. Conditional YES is `NO / (YES + NO)`; Conditional NO is `YES / (YES + NO)`.
