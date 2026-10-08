import { describe, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import assert from '../testSupport/simulator/utils/assert'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { SystemState } from '../testSupport/simulator/types/statoblastTypes'
import { createCompleteSet, getSecurityPoolsEscalationGame, getSettlementCollateralAttoEth, getSystemState, redeemShares, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { createChildUniverse, getQuestionOutcome, getSecurityPoolForkerForkData, initiateSecurityPoolFork } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { setVaultCapacityFixture } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { useStatoblastForkMigrationFixture } from './statoblast/fixture'

describe('Escalation fork-time finality regression', () => {
	const fixture = useStatoblastForkMigrationFixture()

	async function prepareDisputedPool() {
		const { client, mockWindow, securityPoolAddresses, questionData, outcomes, reportBond, genesisUniverse } = fixture
		const pool = securityPoolAddresses.securityPool
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, 25n * 10n ** 18n)
		await createCompleteSet(client, pool, 10n ** 18n)
		const forkQuestion = { ...questionData, title: 'external fork during rounded escalation deadline' }
		await createQuestion(client, forkQuestion, outcomes)
		await approveToken(client, getRepTokenAddress(genesisUniverse), getZoltarAddress())
		await mockWindow.setTime(questionData.endTime + 1n)
		for (const [outcome, amount] of [
			[QuestionOutcome.Yes, 8n * reportBond],
			[QuestionOutcome.No, 7n * reportBond],
		] as const) {
			await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		}
		const game = await getSecurityPoolsEscalationGame(client, pool)
		const gameContract = { abi: statoblast_EscalationGame_EscalationGame.abi, address: game }
		const activationTime = await client.readContract({ ...gameContract, functionName: 'activationTime' })
		assert.strictEqual(await client.readContract({ ...gameContract, functionName: 'nonDecisionThresholdAttoRep' }), 250_000n * reportBond)
		assert.strictEqual(await client.readContract({ ...gameContract, functionName: 'getEscalationGameEndDate' }), activationTime + 662_807n)
		assert.ok((await client.readContract({ ...gameContract, functionName: 'computeIterativeAttritionCostAttoRep', args: [662_808n] })) < 7n * reportBond)
		assert.ok((await client.readContract({ ...gameContract, functionName: 'computeIterativeAttritionCostAttoRep', args: [662_820n] })) > 7n * reportBond)
		return { pool, gameContract, activationTime, forkQuestionId: getQuestionId(forkQuestion, outcomes) }
	}

	for (const delay of [1n, 12n, DAY]) {
		test(`an unresolved fork keeps the same outcome and carry after ${delay} seconds`, async () => {
			const { client, mockWindow, genesisUniverse, reportBond, questionId, statoblastSecurityMultiplierBps } = fixture
			const { pool, gameContract, activationTime, forkQuestionId } = await prepareDisputedPool()
			const forkTime = activationTime + 662_808n
			// Transactions are mined one second after the fixture's current timestamp.
			await mockWindow.setTime(forkTime - 1n)
			await forkUniverse(client, genesisUniverse, forkQuestionId)
			assert.strictEqual((await getUniverseData(client, genesisUniverse)).forkTime, forkTime)
			assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.None)
			const forkCost = await client.readContract({ ...gameContract, functionName: 'totalCostAttoRep' })
			await mockWindow.setTime(forkTime + delay)
			assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.None, 'elapsed wall time must not finalize a game that was unresolved at the fork')
			assert.strictEqual(await client.readContract({ ...gameContract, functionName: 'totalCostAttoRep' }), forkCost, 'attrition must freeze at the recorded universe fork')
			assert.strictEqual(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'getFeeEpochEndTime' }), forkTime, 'delayed migration must retain the fork-time fee cutoff')
			await assert.rejects(client.simulateContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'redeemShares', args: [] }), /Question not final/)
			await assert.rejects(client.simulateContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'redeemRepFromVault', args: [client.account.address] }), /Question not final/)
			await assert.rejects(client.simulateContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.Yes, [0n]] }), /Question not final/)
			await initiateSecurityPoolFork(client, pool)
			assert.strictEqual(await getSystemState(client, pool), SystemState.PoolForked)
			const forkData = await getSecurityPoolForkerForkData(client, pool)
			assert.strictEqual(forkData.unresolvedEscalationAtFork, true)
			assert.strictEqual(forkData.escalationElapsedAtFork, 662_808n)
			await createChildUniverse(client, pool, QuestionOutcome.Yes)
			const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const child = getSecurityPoolAddresses(pool, childUniverse, questionId, statoblastSecurityMultiplierBps)
			const childGame = await getSecurityPoolsEscalationGame(client, child.securityPool)
			assert.deepStrictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: childGame, functionName: 'getOutcomeBalancesAttoRep' }), [0n, 8n * reportBond, 7n * reportBond], 'both sides of the interrupted dispute must reach the child')
		})
	}

	test('a fork before activation keeps the parent clock stopped after the full escalation duration', async () => {
		const { client, mockWindow, genesisUniverse } = fixture
		const { pool, gameContract, activationTime, forkQuestionId } = await prepareDisputedPool()
		await mockWindow.setTime(activationTime - 13n)
		await forkUniverse(client, genesisUniverse, forkQuestionId)
		await mockWindow.setTime(activationTime + 50n * DAY)
		assert.strictEqual(await client.readContract({ ...gameContract, functionName: 'totalCostAttoRep' }), 0n)
		assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.None)
		await initiateSecurityPoolFork(client, pool)
		assert.strictEqual((await getSecurityPoolForkerForkData(client, pool)).escalationElapsedAtFork, 0n)
	})

	test('a game finalized before a later universe fork retains local settlement', async () => {
		const { client, mockWindow, genesisUniverse } = fixture
		const { pool, activationTime, forkQuestionId } = await prepareDisputedPool()
		await mockWindow.setTime(activationTime + 662_820n)
		assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.Yes)
		await mockWindow.setTime(activationTime + 662_831n)
		await forkUniverse(client, genesisUniverse, forkQuestionId)
		await mockWindow.advanceTime(DAY)
		assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.Yes)
		await assert.rejects(initiateSecurityPoolFork(client, pool), /Resolved/)
		assert.ok((await getSettlementCollateralAttoEth(client, pool)) > 0n)
		await redeemShares(client, pool)
		assert.strictEqual(await getSettlementCollateralAttoEth(client, pool), 0n)
		await withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [0n])
	})
})
