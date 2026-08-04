# First trade

Using a contract console or integration client, select an initialized, open pair and choose YES or NO. The standalone UI currently demonstrates these states with simulated fixtures only and cannot submit this workflow.

1. Enter an ETH amount. The instant preview estimates the complete-set amount, but the final summary must come from simulating the router call.
2. Review complete-set shares, opposite shares swapped, additional long shares, total long shares, INVALID insurance, fee, conditional price impact, deadline, and minimum received.
3. Re-simulate if the block changes. Submit one `enterPosition` transaction.
4. Check the wallet: a YES entry delivers YES plus an equal quantity of INVALID; it does not leave NO in the router.

To exit, approve the router for ERC-1155 shares, select an explicit number of complete-set share units, and simulate `exitPosition`. The router buys exactly the missing opposite shares, redeems the complete sets at the current collateral rate, and forwards only that operation’s ETH. If INVALID is insufficient, reduce the exit; excess directional profit remains as shares.
