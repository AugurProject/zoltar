import { describe, test } from 'bun:test'
import { ReputationToken_ReputationToken, statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool, Zoltar_Zoltar } from '../types/contractArtifact'
import { addRepToMigrationBalance, getMigrationRepBalanceAttoRep, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import { useStatoblastForkMigrationFixture } from './statoblast/fixture'

describe('Audit PoC: child-pool fee epoch', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const {
		DAY,
		QuestionOutcome,
		SystemState,
		assert,
		addressString,
		approveToken,
		createChildUniverse,
		createCompleteSet,
		createQuestion,
		finalizeTruthAuction,
		forkUniverse,
		GENESIS_REPUTATION_TOKEN,
		getAwaitingForkContinuation,
		getChildUniverseId,
		getQuestionId,
		getRepToken,
		getSecurityPoolAddresses,
		getSecurityPoolsEscalationGame,
		getQuestionEndDate,
		getSettlementCollateralAttoEth,
		getSystemState,
		getTotalAccruedFees,
		getTotalClaimableVaultFeesAttoEth,
		getZoltarAddress,
		getZoltarForkThreshold,
		migrateRepToZoltar,
		migrateVault,
		migrateVaultWithUnresolvedEscalation,
		redeemCompleteSet,
		setupFinalizedTruthAuctionWithMixedBids,
		setupOwnForkWithEscrow,
		startTruthAuction,
		statoblastSecurityMultiplierBps,
		strictEqualTypeSafe,
		triggerExternalForkForSecurityPool,
		updateSettlementCollateral,
		updateVaultFees,
	} = fixture

	test('external-fork child without an auction charges mint and redemption during its continuation epoch', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
		await triggerExternalForkForSecurityPool()
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childUniverse = getChildUniverseId(0n, QuestionOutcome.Yes)
		const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		await mockWindow.advanceTime(8n * 7n * DAY + 1n)
		await startTruthAuction(client, child.securityPool)
		strictEqualTypeSafe(await getSystemState(client, child.securityPool), SystemState.Operational, 'complete migration should finalize without an auction')
		const childLiveSupply = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [childUniverse] })
		const childRepToken = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: child.securityPool, functionName: 'repToken' })
		strictEqualTypeSafe(await client.readContract({ abi: ReputationToken_ReputationToken.abi, address: childRepToken, functionName: 'getTotalTheoreticalSupplyAttoRep' }), childLiveSupply, 'child REP and Zoltar live supply should retain their existing equality')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: child.securityPool, functionName: 'initialEscalationGameDepositAttoRep' }), childLiveSupply / 10_000_000n, 'child escalation economics should remain based on its unchanged live supply')
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: child.securityPool, functionName: 'minimumVaultRepDepositAttoRep' }), childLiveSupply / 100_000n, 'child vault economics should remain based on its unchanged live supply')

		await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 1n)
		await updateSettlementCollateral(client, child.securityPool)
		const mintedShares = 2n * 10n ** 18n
		await createCompleteSet(client, child.securityPool, mintedShares)
		const collateralBefore = await getSettlementCollateralAttoEth(client, child.securityPool)
		await mockWindow.advanceTime(DAY)
		await updateSettlementCollateral(client, child.securityPool)
		const collateralAfter = await getSettlementCollateralAttoEth(client, child.securityPool)
		assert.ok(collateralAfter < collateralBefore, 'child continuation collateral must pay retention fees after its reused parent question end')
		assert.ok((await getTotalAccruedFees(client, child.securityPool)) > 0n, 'child vaults must receive compensation during the continuation epoch')
		await updateVaultFees(client, child.securityPool, client.account.address)
		assert.ok((await getTotalClaimableVaultFeesAttoEth(client, child.securityPool)) > 0n, 'migrated fee-eligible capacity must receive the child fee accrual')
		await redeemCompleteSet(client, child.securityPool, mintedShares)
	})

	test('external-fork child finalized by a truth auction starts fees at auction finalization', async () => {
		const { client, mockWindow } = fixture
		const { yesSecurityPool } = await setupFinalizedTruthAuctionWithMixedBids()
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'auction should finalize the child')
		const collateralBefore = await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)
		await mockWindow.advanceTime(DAY)
		await updateSettlementCollateral(client, yesSecurityPool.securityPool)
		assert.ok((await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool)) < collateralBefore, 'truth-auction finalization must start a fresh child fee epoch')
	})

	test('own-question fork resumes unresolved escalation and accrues until the child game resolves', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
		await setupOwnForkWithEscrow()
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const childUniverse = getChildUniverseId(0n, QuestionOutcome.Yes)
		const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, child.securityPool)
		if ((await getSystemState(client, child.securityPool)) === SystemState.ForkTruthAuction) await finalizeTruthAuction(client, child.securityPool)
		for (let attempt = 0; attempt < 16 && (await getAwaitingForkContinuation(client, child.securityPool)); attempt++) {
			const hash = await client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: child.securityPool, functionName: 'resumeForkedEscalationGame' })
			await client.waitForTransactionReceipt({ hash })
		}
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, child.securityPool), false, 'child game should resume')
		const game = await getSecurityPoolsEscalationGame(client, child.securityPool)
		const gameEnd = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getEscalationGameEndDate' })
		const collateralBefore = await getSettlementCollateralAttoEth(client, child.securityPool)
		await mockWindow.advanceTime(DAY)
		await updateSettlementCollateral(client, child.securityPool)
		assert.ok((await getSettlementCollateralAttoEth(client, child.securityPool)) < collateralBefore, 'resumed own-fork child must accrue before resolution')
		await mockWindow.setTime(gameEnd + 1n)
		await updateSettlementCollateral(client, child.securityPool)
		const accruedAtResolution = await getTotalAccruedFees(client, child.securityPool)
		await mockWindow.advanceTime(DAY)
		await updateSettlementCollateral(client, child.securityPool)
		strictEqualTypeSafe(await getTotalAccruedFees(client, child.securityPool), accruedAtResolution, 'normal child resolution must stop the epoch exactly once')
	})

	test('child resolution remains the fee cutoff when its universe forks later without an intervening checkpoint', async () => {
		const { client, mockWindow, questionData, questionId, securityPoolAddresses } = fixture
		await createCompleteSet(client, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
		await setupOwnForkWithEscrow()
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const childUniverse = getChildUniverseId(0n, QuestionOutcome.Yes)
		const child = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, child.securityPool)
		if ((await getSystemState(client, child.securityPool)) === SystemState.ForkTruthAuction) await finalizeTruthAuction(client, child.securityPool)
		for (let attempt = 0; attempt < 16 && (await getAwaitingForkContinuation(client, child.securityPool)); attempt++) {
			const hash = await client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: child.securityPool, functionName: 'resumeForkedEscalationGame' })
			await client.waitForTransactionReceipt({ hash })
		}
		const game = await getSecurityPoolsEscalationGame(client, child.securityPool)
		const gameEnd = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getEscalationGameEndDate' })
		const recursiveForkQuestion = { ...questionData, title: 'later child fee epoch cutoff fork', endTime: gameEnd }
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		const recursiveForkQuestionId = getQuestionId(recursiveForkQuestion, outcomes)
		await createQuestion(client, recursiveForkQuestion, outcomes)
		const childForkThreshold = await getZoltarForkThreshold(client, childUniverse)
		const migrationBalance = await getMigrationRepBalanceAttoRep(client, 0n, client.account.address)
		if (migrationBalance < childForkThreshold) {
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await addRepToMigrationBalance(client, 0n, childForkThreshold - migrationBalance)
		}
		await splitMigrationRep(client, 0n, childForkThreshold, [QuestionOutcome.Yes])
		const childRepToken = await getRepToken(client, child.securityPool)
		await approveToken(client, childRepToken, getZoltarAddress())
		await mockWindow.setTime(gameEnd + DAY)
		await forkUniverse(client, childUniverse, recursiveForkQuestionId)
		await updateSettlementCollateral(client, child.securityPool)
		strictEqualTypeSafe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: child.securityPool, functionName: 'lastUpdatedFeeAccumulator' }), gameEnd, 'a later fork must not extend fees past an already-resolved child game')
	})
})
