import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
} from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// A carried game resumes with exactly its remaining curve time at branch activation.
// A late flip against a 50% leader margin raises the median and leaves time to reply,
// including when activation happens after the recapitalization deadline.
describe('a carried game: pause and resume the pure curve', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const YES = 1
	const NO = 2
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
	const gameFor = (pool: Address) => fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
	const readGame = <const Name extends 'getFinalQuestionResolution' | 'getQuestionResolution' | 'totalCostAttoRep' | 'getEscalationGameEndDate' | 'forkResumedAt' | 'activationTime' | 'startBondAttoRep' | 'getBindingCapitalAttoRep'>(game: Address, functionName: Name) =>
		fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName })
	const depositRaw = (sender: WriteClient, pool: Address, outcome: number, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const deposit = async (sender: WriteClient, pool: Address, outcome: number, amount: bigint, universe = fixture.base.genesisUniverse) => {
		await approveToken(sender, getRepTokenAddress(universe), pool)
		await depositRaw(sender, pool, outcome, amount)
	}
	// The harness mines every transaction one second after the latest block, so a
	// transaction lands at `timestamp` when the clock is first set to `timestamp - 1`.
	const landNextTransactionAt = (timestamp: bigint) => fixture.base.mockWindow.setTime(timestamp - 1n)
	const latestBlockTimestamp = async () => {
		const block = await fixture.base.mockWindow.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
		if (typeof block !== 'object' || block === null || !('timestamp' in block) || typeof block.timestamp !== 'string') throw new Error('Latest block has no timestamp')
		return BigInt(block.timestamp)
	}
	const forkUnrelatedAndMaterializeYesChild = async (source: Address, activationDelay: bigint) => {
		const owner = fixture.owner()
		const universe = fixture.base.genesisUniverse
		const question = { ...fixture.base.questionData, title: 'Audit unrelated fork question', endTime: (await fixture.base.mockWindow.getTime()) - 1n }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(owner, universe, getQuestionId(question, fixture.base.outcomes))
		await addRepToMigrationBalance(owner, universe, 1_000_000n * unit)
		await splitMigrationRep(owner, universe, 1_000_000n * unit, [1n])
		const controller = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		const branch = { abi: forkArtifact.abi, address: controller }
		const child = getChildUniverseId(universe, 1)
		const forkTime = (await getUniverseData(owner, universe)).forkTime
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY + activationDelay)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [universe, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		const activatedAt = await latestBlockTimestamp()
		for (let step = 0; step < 3; step++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializePortfolioQuestion', args: [source, child] }))
		const pool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })
		return { pool, game: await gameFor(pool), universe: child, forkTime, activatedAt }
	}

	test.each([0n, 5n * DAY])('a last-second flip leaves curve-based reply time after activation delayed by %s seconds', async activationDelay => {
		const attacker = fixture.owner()
		const honest = fixture.other()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await deposit(honest, sourcePool(), YES, 150n * unit)
		await deposit(attacker, sourcePool(), NO, 100n * unit)
		const parentGame = await gameFor(sourcePool())
		const parentEnd = await readGame(parentGame, 'getEscalationGameEndDate')
		await fixture.base.mockWindow.setTime(parentEnd - 600n)
		const child = await forkUnrelatedAndMaterializeYesChild(sourcePool(), activationDelay)
		const resumedAt = await readGame(child.game, 'forkResumedAt')
		const initialEnd = await readGame(child.game, 'getEscalationGameEndDate')
		expect(initialEnd).toBe(resumedAt + parentEnd - child.forkTime)
		expect(resumedAt).toBe(child.activatedAt)
		expect(initialEnd - resumedAt).toBeLessThan(600n)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(3n)

		await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await addRepToMigrationBalance(honest, fixture.base.genesisUniverse, 1_000n * unit)
		await splitMigrationRep(honest, fixture.base.genesisUniverse, 1_000n * unit, [1n])
		await approveToken(honest, getRepTokenAddress(child.universe), child.pool)
		await approveToken(attacker, getRepTokenAddress(child.universe), child.pool)
		await landNextTransactionAt(initialEnd)
		await depositRaw(attacker, child.pool, NO, 51n * unit)
		expect(await latestBlockTimestamp()).toBe(initialEnd)
		expect(await readGame(child.game, 'getBindingCapitalAttoRep')).toBe(150n * unit)
		const afterFlip = await readGame(child.game, 'getEscalationGameEndDate')
		expect(afterFlip).toBeGreaterThan(initialEnd + DAY)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(3n)

		// Yes can actually execute its reply in the following block.
		await depositRaw(honest, child.pool, YES, 77n * unit)
		expect(await readGame(child.game, 'getQuestionResolution')).toBe(3n)
		const finalEnd = await readGame(child.game, 'getEscalationGameEndDate')
		expect(finalEnd).toBeGreaterThanOrEqual(afterFlip)
		await fixture.base.mockWindow.setTime(finalEnd + 1n)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
		await expect(honest.simulateContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, 1_000n * unit] })).rejects.toThrow('Invalid deposit preview')
	})
})
