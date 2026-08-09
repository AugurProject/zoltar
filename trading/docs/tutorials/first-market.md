# First market

This walkthrough creates and seeds the first pair for an existing canonical SecurityPool. You will finish with an initialized YES/NO pair, LP tokens, and separate INVALID insurance in your wallet.

Before starting, deploy the AMM and build the standalone UI with its manifest by following [Configure the standalone UI](../how-to/configure-ui.md). The configured chain must contain an operational SecurityPool whose binary question has not ended. Fund a wallet on that chain with enough ETH for the initial deposit and gas.

1. Open the live UI without `?demo=1`, connect the wallet, and select **Liquidity**.
2. In **SecurityPools**, select the exact pool you want. Confirm its full SecurityPool address, universe and question IDs, question end, system state, fork status, and collateral rate in the adjacent details. Stop if the pool is not operational or the address is not the intended branch.
3. Select **Initialize**. Enter an ETH amount and a Conditional YES price above 0% and below 100%.
4. Select **Simulate liquidity transaction**. The authoritative router simulation shows complete-set shares created, YES and NO deposited, unused directional shares returned, INVALID retained, and expected LP tokens. Check that the reserve direction matches your intended odds.
5. Select **Submit simulated liquidity transaction** and confirm it in the wallet. The client refreshes the account, network, current block, and simulation before submission; if any of them changed, simulate again.
6. After confirmation, refresh the market. Verify that the exact pool now has a pair address, nonzero YES and NO reserves, and an LP supply. In the connected wallet view, verify the new LP balance and the returned INVALID balance.

For a 70% Conditional YES price, the initialized reserve ratio is approximately 30 YES to 70 NO. The NO reserve is larger because the opposite reserve determines the constant-product spot price. The LP tokens represent only the deposited YES and NO; INVALID and unused directional shares remain separate wallet balances.
