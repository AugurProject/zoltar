import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/shared/ethereum'
import { getVaultCount, getTotalRepBackingUnits, redeemRepFromVault } from '../testSupport/simulator/utils/contracts/securityPool'
import { backingUnitsToAttoRep as forkerBackingUnitsToAttoRep, getOwnForkRepBuckets } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { useStatoblastEscalationMigrationFixture, type StatoblastEscalationMigrationFixture } from './statoblast/fixture'

describe('Own-fork continuation residual settlement regression', () => {
	const fixture = useStatoblastEscalationMigrationFixture()
	const assert: StatoblastEscalationMigrationFixture['assert'] = fixture.assert
	const strictEqualTypeSafe: StatoblastEscalationMigrationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	const {
		DAY,
		QuestionOutcome,
		SystemState,
		approveAndDepositRepToVault,
		claimForkedEscalationDeposits,
		depositRepToVault,
		depositToEscalationGame,
		forkZoltarWithOwnEscalationGame,
		getChildUniverseId,
		getERC20Balance,
		getQuestionEndDate,
		getRepToken,
		getRepTokenAddress,
		getSecurityPoolAddresses,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		getTotalTheoreticalSupplyAttoRep,
		getZoltarForkThreshold,
		manipulatePriceOracle,
		statoblast_EscalationGame_EscalationGame,
		backingUnitsToAttoRep,
		startTruthAuction,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
	} = fixture

	let mockWindow: StatoblastEscalationMigrationFixture['mockWindow']
	let client: StatoblastEscalationMigrationFixture['client']
	let securityPoolAddresses: StatoblastEscalationMigrationFixture['securityPoolAddresses']
	let questionId: StatoblastEscalationMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	test('burns significant continuation residual when the resolved child has no live owner', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const parentRepToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (((await getTotalTheoreticalSupplyAttoRep(client, parentRepToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		const universeForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const extraLosingPrincipal = forkThreshold / 2n
		const totalEscrowTarget = 2n * forkThreshold + extraLosingPrincipal
		let parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let parentVaultRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, parentVault.repBackingUnits)
		if (parentVaultRep < totalEscrowTarget) {
			await approveAndDepositRepToVault(client, totalEscrowTarget - parentVaultRep, questionId)
			parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			parentVaultRep = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, parentVault.repBackingUnits)
		}
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		strictEqualTypeSafe(parentVaultRep, totalEscrowTarget, 'the sole vault should own exactly the three planned escalation deposits')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, extraLosingPrincipal)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(parentVault.repBackingUnits, 0n, 'all parent ownership should be escrowed before the own fork')
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), 0n, 'no live REP backing units should remain at the fork')

		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const repBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(repBuckets.vaultRepAtForkAttoRep, 0n, 'the fork should have no vault-held REP bucket')

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const yesGame = await getSecurityPoolsEscalationGame(client, yesPool.securityPool)
		const yesRepToken = getRepTokenAddress(yesUniverse)
		const gameResidualBeforeResolution = await getERC20Balance(client, yesRepToken, yesGame)
		const expectedResidual = totalEscrowTarget - universeForkThreshold / 5n - (forkThreshold + (forkThreshold * 3n) / 5n)
		strictEqualTypeSafe(gameResidualBeforeResolution, expectedResidual, 'the direct winning claim should leave the post-fork payout residual')
		strictEqualTypeSafe(gameResidualBeforeResolution, extraLosingPrincipal, 'the third-outcome losing principal should survive as economically significant residual')

		await mockWindow.advanceTime(8n * 7n * DAY + 1n)
		await startTruthAuction(client, yesPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesPool.securityPool), SystemState.Operational, 'zero vault-held REP should finalize the child without an auction')
		const continuationEndTime = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: yesGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(continuationEndTime + 1n)

		const theoreticalSupplyBeforeSweep = await getTotalTheoreticalSupplyAttoRep(client, yesRepToken)
		const sweepHash = await client.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: yesGame,
			functionName: 'sweepResidualRepToSecurityPool',
			args: [],
		})
		const sweepReceipt = await client.waitForTransactionReceipt({ hash: sweepHash })
		const sweepEventNames = sweepReceipt.logs
			.filter(log => log.address.toLowerCase() === yesGame.toLowerCase())
			.map(
				log =>
					decodeEventLog({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					}).eventName,
			)
		assert.ok(sweepEventNames.includes('ForkContinuationResidualRepBurned'), 'own-fork continuation cleanup must emit its dedicated burn event')
		assert.ok(!sweepEventNames.includes('ResidualRepSweptToSecurityPool'), 'own-fork continuation cleanup must not emit the ordinary residual sweep event')

		strictEqualTypeSafe(await getERC20Balance(client, yesRepToken, yesGame), 0n, 'the sweep should empty the continuation game')
		strictEqualTypeSafe(await getERC20Balance(client, yesRepToken, yesPool.securityPool), 0n, 'the resolved ownerless child pool should not receive continuation residual')
		strictEqualTypeSafe(theoreticalSupplyBeforeSweep - (await getTotalTheoreticalSupplyAttoRep(client, yesRepToken)), expectedResidual, 'the continuation residual should be removed from child-universe supply')
		strictEqualTypeSafe(await getVaultCount(client, yesPool.securityPool), 0n, 'the child should have no live vault that owns the residual')
		strictEqualTypeSafe((await getSecurityVault(client, yesPool.securityPool, client.account.address)).repBackingUnits, 0n, 'the original depositor should own none of the child denominator')
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, yesPool.securityPool), 0n, 'the ownerless child should not retain a phantom ownership denominator')
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, yesPool.securityPool, 0n), 0n, 'the ownerless pool conversion should return zero')
		strictEqualTypeSafe(await forkerBackingUnitsToAttoRep(client, yesPool.securityPool, 0n), 0n, 'the ownerless forker conversion preview should return zero')

		await assert.rejects(depositRepToVault(client, yesPool.securityPool, 10n * 10n ** 18n), /Resolved/)
		await assert.rejects(redeemRepFromVault(client, yesPool.securityPool, client.account.address), /No redeemable REP/)
		strictEqualTypeSafe(await getERC20Balance(client, yesRepToken, yesPool.securityPool), 0n, 'closed deposit and redemption paths should leave no REP locked')
	})
})
