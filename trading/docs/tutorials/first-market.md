# First market

This walkthrough creates and seeds the first pair for an existing canonical SecurityPool. You will finish with an initialized YES/NO pair, LP tokens, and separate INVALID insurance in your wallet.

Before starting, [deploy the trading contracts](../how-to/deploy.md), then [configure and build the standalone UI](../how-to/configure-ui.md) with the emitted manifest. The configured chain must contain an initialization-eligible SecurityPool: its system state is `Operational`, its question has not ended, fork continuation is not pending, its universe has not forked, and its outcome is `None (unresolved)`. Fund a wallet on that chain with enough ETH for the initial deposit and gas.

1. Open the live UI without `?demo=1`, connect the wallet, and select **Liquidity**.
2. In **SecurityPools**, select the exact pool you want. Confirm its full SecurityPool address, universe and question IDs, question end, system state, fork continuation, universe-fork state, question outcome, and checkpointed collateral/share ratio in the adjacent details. The snapshot ratio can change when retention accrues; the later router simulation is authoritative for the transaction-effective rate. Stop unless every eligibility condition above holds or if the address is not the intended branch.
3. Select **Initialize**. Enter an ETH amount and a Conditional YES price above 0% and below 100%.
4. Select **Simulate liquidity transaction**. The authoritative router simulation shows complete-set shares created, YES and NO deposited, unused directional shares returned, INVALID retained, and expected LP tokens. Check that the reserve direction matches your intended odds.
5. Select **Submit simulated liquidity transaction** and confirm it in the wallet. The client refreshes the account, network, current block, and simulation before submission; if any of them changed, simulate again.
6. After confirmation, open **Markets** and verify that the exact pool now has a pair address and nonzero YES and NO reserves. Open **Portfolio**, select the same pool, and verify the wallet’s new LP balance and returned INVALID balance.

For a 70% Conditional YES price, the initialized reserve ratio is approximately 30 YES to 70 NO. The NO reserve is larger because the opposite reserve determines the constant-product spot price. The LP tokens represent only the deposited YES and NO; INVALID and unused directional shares remain separate wallet balances.
