import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/shared/ethereum'
import { createCarryProof, SparseNullifierTree } from './carryProofHelpers'
import { useStatoblastEscalationMigrationFixture, type StatoblastEscalationMigrationFixture } from './statoblast/fixture'
import { getTotalRepBackingUnits, getTotalPoolHeldAttoRep, redeemRepFromVault } from '../testSupport/simulator/utils/contracts/securityPool'
import { splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'

describe('Fork-continuation residual settlement regression', () => {
	const fixture = useStatoblastEscalationMigrationFixture()
	const {
		assert,
		strictEqualTypeSafe,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		getChildUniverseId,
		getERC20Balance,
		addressString,
		approveAndDepositRepToVault,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		getQuestionEndDate,
		QuestionOutcome,
		SystemState,
		createChildUniverse,
		initiateSecurityPoolFork,
		startTruthAuction,
		forkUniverse,
		getRepTokenAddress,
		getZoltarAddress,
		getZoltarForkThreshold,
		depositRepToVault,
		depositToEscalationGame,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		getTotalTheoreticalSupplyAttoRep,
		manipulatePriceOracle,
		backingUnitsToAttoRep,
		statoblast_EscalationGame_EscalationGame,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
		outcomes,
	} = fixture

	let mockWindow: StatoblastEscalationMigrationFixture['mockWindow']
	let client: StatoblastEscalationMigrationFixture['client']
	let securityPoolAddresses: StatoblastEscalationMigrationFixture['securityPoolAddresses']
	let questionData: StatoblastEscalationMigrationFixture['questionData']
	let questionId: StatoblastEscalationMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	test('burns external-fork continuation residual instead of assigning it to a late depositor', async () => {
		const questionEnd = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(questionEnd + 10_000n)

		const forkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const nonDecisionThreshold = forkThreshold / 2n + (forkThreshold % 2n)
		const invalidPrincipal = nonDecisionThreshold - 3n
		const noPrincipal = nonDecisionThreshold - 2n
		const yesPrincipal = nonDecisionThreshold - 1n
		const totalPrincipal = invalidPrincipal + noPrincipal + yesPrincipal

		const parentVaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentRepBeforeTopUp = await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, parentVaultBeforeTopUp.repBackingUnits)
		assert.ok(parentRepBeforeTopUp < totalPrincipal, 'fixture vault must fit below the audit target')
		await approveAndDepositRepToVault(client, totalPrincipal - parentRepBeforeTopUp, questionId)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid, invalidPrincipal)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, noPrincipal)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, yesPrincipal)
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, securityPoolAddresses.securityPool), 0n, 'all parent REP backing units must be escrowed')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, securityPoolAddresses.securityPool), 0n, 'all parent pool-held REP must be held by the escalation game')

		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestion = {
			...questionData,
			title: 'audit external fork for zero-owner residual capture',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestion, outcomes)
		await createQuestion(forkInitiator, externalForkQuestion, outcomes)
		await mockWindow.setTime(externalForkQuestion.endTime + 1n)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		const childRepToken = getRepTokenAddress(childUniverse)
		const childGame = await getSecurityPoolsEscalationGame(client, childPool.securityPool)
		const seedRep = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: childPool.securityPool,
			functionName: 'minimumVaultRepDepositAttoRep',
			args: [],
		})
		await splitMigrationRep(forkInitiator, genesisUniverse, seedRep, [QuestionOutcome.Yes])
		await approveToken(forkInitiator, childRepToken, childPool.securityPool)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, childPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, childPool.securityPool), SystemState.Operational, 'zero pool-held REP must skip the auction and activate the continuation')
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, childPool.securityPool), 0n, 'the activated child must begin without an owner')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, childPool.securityPool), 0n, 'continuation backing must remain in the game, outside pool backing claims')

		const attackerBalanceBeforeDeposit = await getERC20Balance(client, childRepToken, forkInitiator.account.address)
		strictEqualTypeSafe(attackerBalanceBeforeDeposit, seedRep, 'fork split must fund the minimum late deposit')
		await depositRepToVault(forkInitiator, childPool.securityPool, seedRep)
		const attackerVault = await getSecurityVault(client, childPool.securityPool, forkInitiator.account.address)
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, childPool.securityPool, attackerVault.repBackingUnits), seedRep, 'the late depositor must become the sole child-pool owner')

		const continuationEnd = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(continuationEnd + 1n)
		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const winningProof = await createCarryProof(client, parentGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
			sourceNodeId: 3n,
		})
		const claimHash = await client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: childPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [winningProof]],
		})
		await client.waitForTransactionReceipt({ hash: claimHash })

		const rewardBonus = (noPrincipal * 3n) / 5n
		const winnerHaircut = (noPrincipal * 2n) / 5n
		const expectedResidual = totalPrincipal - yesPrincipal - rewardBonus - winnerHaircut
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, childGame), expectedResidual, 'the lower losing side must remain as sweepable continuation residual')
		const theoreticalSupplyBeforeSweep = await getTotalTheoreticalSupplyAttoRep(client, childRepToken)
		const sweepHash = await client.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childGame,
			functionName: 'sweepResidualRepToSecurityPool',
			args: [],
		})
		const sweepReceipt = await client.waitForTransactionReceipt({ hash: sweepHash })
		const sweepEventNames = sweepReceipt.logs
			.filter(log => log.address.toLowerCase() === childGame.toLowerCase())
			.map(
				log =>
					decodeEventLog({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					}).eventName,
			)
		assert.ok(sweepEventNames.includes('ForkContinuationResidualRepBurned'), 'continuation cleanup must emit its dedicated burn event')
		assert.ok(!sweepEventNames.includes('ResidualRepSweptToSecurityPool'), 'continuation cleanup must not emit the ordinary residual sweep event')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, childPool.securityPool), seedRep, 'continuation residual must not enter the late depositor-owned pool balance')
		strictEqualTypeSafe(theoreticalSupplyBeforeSweep - (await getTotalTheoreticalSupplyAttoRep(client, childRepToken)), expectedResidual, 'continuation residual must be removed from child-universe supply')

		await redeemRepFromVault(forkInitiator, childPool.securityPool, forkInitiator.account.address)
		const attackerBalanceAfterRedeem = await getERC20Balance(client, childRepToken, forkInitiator.account.address)
		strictEqualTypeSafe(attackerBalanceAfterRedeem, attackerBalanceBeforeDeposit, 'the late depositor should recover only its own seed REP')
		assert.ok(expectedResidual >= nonDecisionThreshold - 3n, 'the burned residual should cover the economically significant capture path')
	})
})
