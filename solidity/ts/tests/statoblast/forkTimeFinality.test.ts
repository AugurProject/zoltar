import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact } from '../../types/contractArtifact'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress, getZoltarAddress, forkUniverse, getUniverseData } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'

describe('Statoblast: fork-time escalation finality', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	async function prepareDisputedPool() {
		const owner = fixture.owner()
		const base = fixture.base
		const pool = fixture.poolFor(base.questionId).securityPool
		const unrelated = { ...base.questionData, title: 'Rounding gap external fork' }
		await createQuestion(owner, unrelated, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), pool)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const bond = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'initialEscalationGameDepositAttoRep' })
		for (const [outcome, amount] of [
			[QuestionOutcome.Yes, 8n * bond],
			[QuestionOutcome.No, 7n * bond],
		] as const)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const contract = { abi: gameArtifact.abi, address: game }
		const activation = await owner.readContract({ ...contract, functionName: 'activationTime' })
		const end = await owner.readContract({ ...contract, functionName: 'getEscalationGameEndDate' })
		return { owner, base, pool, contract, bond, activation, end, unrelatedId: getQuestionId(unrelated, base.outcomes) }
	}

	test.each([1n, 12n, DAY].map(delay => ({ delay })))('a parent unresolved at the rounding-gap fork stays unresolved after $delay seconds', async ({ delay }) => {
		const { owner, base, contract, bond, activation, end, unrelatedId } = await prepareDisputedPool()
		const cost = await owner.readContract({ ...contract, functionName: 'computeIterativeAttritionCostAttoRep', args: [end - activation + 1n] })
		expect(cost).toBeLessThan(7n * bond)
		await base.mockWindow.setTime(end)
		await forkUniverse(owner, base.genesisUniverse, unrelatedId)
		expect((await getUniverseData(owner, base.genesisUniverse)).forkTime).toBe(end + 1n)
		expect(await owner.readContract({ ...contract, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(QuestionOutcome.None))
		await base.mockWindow.setTime(end + 1n + delay)
		expect(await owner.readContract({ ...contract, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(QuestionOutcome.None))
		expect(await owner.readContract({ ...contract, functionName: 'totalCostAttoRep' })).toBe(cost)
		await expect(owner.writeContract({ ...contract, functionName: 'settleOrdinaryGame' })).rejects.toThrow('Question not final')
	})

	test('a fork before activation leaves the parent curve stopped even after the full escalation duration', async () => {
		const { owner, base, contract, activation, unrelatedId } = await prepareDisputedPool()
		await base.mockWindow.setTime(activation - 13n)
		await forkUniverse(owner, base.genesisUniverse, unrelatedId)
		await base.mockWindow.setTime(activation + 50n * DAY)
		expect(await owner.readContract({ ...contract, functionName: 'totalCostAttoRep' })).toBe(0n)
		expect(await owner.readContract({ ...contract, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(QuestionOutcome.None))
	})

	test('a game finalized before a later fork retains its local winning outcome', async () => {
		const { owner, base, contract, end, unrelatedId } = await prepareDisputedPool()
		await base.mockWindow.setTime(end + DAY)
		expect(await owner.readContract({ ...contract, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(QuestionOutcome.Yes))
		await forkUniverse(owner, base.genesisUniverse, unrelatedId)
		await base.mockWindow.setTime(end + 2n * DAY)
		expect(await owner.readContract({ ...contract, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(QuestionOutcome.Yes))
	})
})
