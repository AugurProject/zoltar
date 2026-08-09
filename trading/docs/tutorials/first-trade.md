# First trade

Build and open the standalone UI with a valid deployment manifest as described in [Configure the standalone UI](../how-to/configure-ui.md). Connect a wallet on the manifest chain, select an initialized open pair, and choose YES or NO. Use `?demo=1` only to inspect clearly labeled simulated states; demo mode cannot submit transactions.

1. Enter an ETH amount and select **Simulate authoritative router call**. Do not treat demo fixtures or pure preview math as a transaction quote.
2. Review complete-set shares, opposite shares swapped, additional and total long shares, INVALID insurance, fee, average execution price, conditional price impact, deadline, and minimum received.
3. Re-simulate if the block changes. Submit one `enterPosition` transaction.
4. Check the wallet: a YES entry delivers the complete-set YES plus additional YES from the swap. Its INVALID insurance equals the complete-set quantity, not the larger total YES delivery, and the router leaves no NO from the operation.

To exit, approve the router for ERC-1155 shares, select an explicit number of complete-set share units, and simulate `exitPosition`. The router buys exactly the missing opposite shares, redeems the complete sets at the current collateral rate, and forwards only that operation’s ETH. If INVALID is insufficient, reduce the exit; excess directional profit remains as shares.
