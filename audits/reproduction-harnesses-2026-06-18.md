# Audit Reproduction Harnesses

Date: 2026-06-18

The findings have executable coverage in `solidity/ts/tests/auditFindings.test.ts`. After updating to latest `origin/main`, H-01 is covered by a passing fixed-regression test and M-01 remains covered by a passing vulnerable-behavior PoC.

Validation command run on latest `origin/main`:

```bash
bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000
```

Result after updating H-01 to fixed-regression assertions: 2 pass, 0 fail.

## H-01 Harness: Auction ETH Is Forwarded To The Child Pool

Executable regression: `solidity/ts/tests/auditFindings.test.ts`, test `H-01 regression: finalized truth-auction ETH is forwarded to the child pool`.

Retest on latest `origin/main`: fixed. `SecurityPoolForker` balance does not increase by finalized auction proceeds, the child pool receives those proceeds, and child collateral accounting includes them.

Regression assertions:

```ts
test('audit H-01 fixed: finalized truth-auction ETH is credited to child pool', async () => {
	const endTime = await getQuestionEndDate(client, questionId)
	await mockWindow.setTime(endTime + 10000n)

	const openInterestAmount = 100n * 10n ** 18n
	const securityPoolAllowance = openInterestAmount
	const bidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

	await manipulatePriceOracleAndPerformOperation(
		client,
		mockWindow,
		securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		OperationType.SetSecurityBondsAllowance,
		client.account.address,
		securityPoolAllowance,
	)
	await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
	await forkUniverse(client, genesisUniverse, questionId)
	await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
	await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
	await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

	const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
	const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

	await mockWindow.advanceTime(8n * 7n * DAY + DAY)
	await startTruthAuction(client, child.securityPool)

	const ethRaiseCap = await getEthRaiseCap(client, child.truthAuction)
	assert.ok(ethRaiseCap > 0n, 'setup should start a funded truth auction')
	await participateAuction(bidder, child.truthAuction, 1n * 10n ** 18n, ethRaiseCap)

	const forker = getInfraContractAddresses().securityPoolForker
	const forkerBalanceBefore = await getETHBalance(client, forker)
	const childBalanceBefore = await getETHBalance(client, child.securityPool)

	await mockWindow.advanceTime(7n * DAY + DAY)
	await finalizeTruthAuction(client, child.securityPool)

	const auctionRaised = await getEthRaised(client, child.truthAuction)
	assert.ok(auctionRaised > 0n, 'auction should have raised ETH')

	// These are the fixed-behavior invariant checks. They pass on latest origin/main.
	assert.strictEqual(await getETHBalance(client, forker), forkerBalanceBefore, 'forker should not retain auction ETH')
	assert.strictEqual(await getETHBalance(client, child.securityPool), childBalanceBefore + auctionRaised, 'child pool should receive auction ETH')
	assert.ok((await getCompleteSetCollateralAmount(client, child.securityPool)) >= auctionRaised, 'child collateral should include auction ETH')
})
```

Important imports/helpers:

- `finalizeTruthAuction`, `getSecurityPoolForkerForkData`, `initiateSecurityPoolFork`, `migrateRepToZoltar`, `migrateVault`, `startTruthAuction` from `securityPoolForker` helpers.
- `getEthRaised` from auction helpers.
- `getETHBalance`, `approveToken`, `participateAuction`, and existing constants.

## M-01 Harness: Stale Liquidation Is Consumed

Executable PoC: `solidity/ts/tests/auditFindings.test.ts`, test `M-01 PoC: target-controlled stale liquidation failure is consumed`.

Observed on latest `origin/main`: the queued liquidation is still consumed after the target changes state and liquidation execution fails.

Future post-fix regression assertions should require the stale operation to remain active, or require the target's state mutation to be blocked while the queued liquidation is pending:

```ts
test('audit M-01 fixed: target-controlled stale liquidation failure is not consumed', async () => {
	const endTime = await getQuestionEndDate(client, questionId)
	await mockWindow.setTime(endTime + 10000n)

	const target = client
	const liquidator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
	const capacityVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
	const targetAllowance = repDeposit / 4n
	const capacityAllowance = repDeposit / 4n
	const forcedPrice = PRICE_PRECISION * 10n

	await approveToken(liquidator, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
	await approveToken(capacityVault, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
	await depositRep(liquidator, securityPoolAddresses.securityPool, repDeposit * 10n)
	await depositRep(capacityVault, securityPoolAddresses.securityPool, repDeposit * 10n)

	await manipulatePriceOracleAndPerformOperation(
		target,
		mockWindow,
		securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		OperationType.SetSecurityBondsAllowance,
		target.account.address,
		targetAllowance,
	)
	await requestPriceIfNeededAndStageOperation(
		capacityVault,
		securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		OperationType.SetSecurityBondsAllowance,
		capacityVault.account.address,
		capacityAllowance,
	)
	await requestPriceIfNeededAndStageOperation(
		liquidator,
		securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		OperationType.Liquidation,
		target.account.address,
		targetAllowance,
	)

	const liquidationOperationId = 2n
	await handleOracleReporting(liquidator, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

	await requestPriceIfNeededAndStageOperation(
		target,
		securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		OperationType.SetSecurityBondsAllowance,
		target.account.address,
		0n,
	)
	await requestPriceIfNeededAndStageOperation(
		target,
		securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		OperationType.WithdrawRep,
		target.account.address,
		repDeposit,
	)

	await executeStagedOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationOperationId)

	const stagedLiquidation = await getStagedOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationOperationId)

	// This is the intended fixed behavior. It fails on latest origin/main because executeStagedOperation()
	// consumes before trying the liquidation and catches the revert.
	assert.notStrictEqual(stagedLiquidation.initiatorVault, zeroAddress, 'target-controlled stale liquidation failure should not be consumed')
})
```

Implementation notes:

- The exact `liquidationOperationId` should be read from emitted events or `stagedOperationCounter()` in a production-quality test instead of hard-coded.
- If the chosen fix reserves target state at queue time, replace the final assertion with checks that the target's allowance reduction or REP withdrawal reverts while liquidation is pending.
- If the chosen fix rejects stale state, assert the liquidation operation remains active and can be retried or explicitly cancelled.

## Invariant Additions

These invariants would materially raise future audit confidence:

- `address(securityPoolForker).balance == 0` after every finalized truth-auction settlement, except for deliberately tracked protocol fees if introduced.
- For every child pool after auction finalization: `completeSetCollateralAmount + totalFeesOwedToVaults <= address(child).balance`.
- For every security pool: sum of all live vault `securityBondAllowance` equals `totalSecurityBondAllowance`.
- A staged operation with target-controlled stale state cannot be both failed and consumed unless an explicit, auditable cancellation path records why retry is impossible.
- Auction conservation: submitted ETH equals owner proceeds plus bidder refunds plus remaining unclaimed refundable ETH.
- Fork migration conservation: parent pool REP at fork equals migrated child REP buckets plus auctionable/unsold accounting plus explicitly burned or residual amounts.
