import { describe, test } from 'bun:test'
import { usePeripheralsForkMigrationFixture } from './peripherals/fixture'
import { deployOriginSecurityPool } from '../testSupport/simulator/utils/contracts/deployPeripherals'

describe('Solidity audit regressions', () => {
	const fixture = usePeripheralsForkMigrationFixture()

	test('a parallel origin pool cannot mint shares against a canonical fork child', async () => {
		const {
			client,
			createCompleteSet,
			createWriteClient,
			DAY,
			depositRep,
			finalizeTruthAuction,
			genesisUniverse,
			getChildUniverseId,
			getCompleteSetCollateralAmount,
			getEthRaiseCap,
			getQuestionEndDate,
			getRepToken,
			getSecurityPoolAddresses,
			getShareTokenSupply,
			getSystemState,
			getTotalTheoreticalSupply,
			manipulatePriceOracle,
			manipulatePriceOracleAndPerformOperation,
			migrateRepToZoltar,
			migrateShares,
			migrateVault,
			mockWindow,
			OperationType,
			PRICE_PRECISION,
			QuestionOutcome,
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
		await fixture.assert.rejects(deployOriginSecurityPool(attacker, yesUniverse, questionId, securityMultiplier), /canonical ancestor/i)
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, forkChild.securityPool), forkChildCollateral, 'rejected parallel deployment must preserve fork-child collateral')
		strictEqualTypeSafe(await getShareTokenSupply(client, forkChild.securityPool), forkChildSupply, 'rejected parallel deployment must preserve fork-child supply')
	})

	test('a late unrelated universe fork preserves finalized winning shares and redemption', async () => {
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
		const parentBalancesBeforeMigration = await balanceOfShares(winner, securityPoolAddresses.shareToken, genesisUniverse, winner.account.address)
		await fixture.assert.rejects(migrateShares(winner, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes]), /Resolved/)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const parentBalances = await balanceOfShares(winner, securityPoolAddresses.shareToken, genesisUniverse, winner.account.address)
		const childBalances = await balanceOfShares(winner, securityPoolAddresses.shareToken, yesUniverse, winner.account.address)
		strictEqualTypeSafe(parentBalances[1], parentBalancesBeforeMigration[1], 'rejected migration must preserve redeemable parent winner shares')
		strictEqualTypeSafe(childBalances[1], 0n, 'rejected migration must not mint unbacked child shares')

		await fixture.assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Resolved/)
		const parentCollateralBefore = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const winnerEthBefore = await getETHBalance(client, winner.account.address)
		await redeemShares(winner, securityPoolAddresses.securityPool)
		fixture.assert.ok((await getETHBalance(client, winner.account.address)) > winnerEthBefore, 'preserved parent winner shares should remain redeemable')
		fixture.assert.ok(parentCollateralBefore > 0n, 'finalized parent should hold collateral before redemption')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume parent collateral')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume parent share supply')
	})
})
