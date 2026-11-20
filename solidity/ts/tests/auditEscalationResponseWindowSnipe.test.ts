import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// A resumed carried game keeps deposits open for its whole fixed 3-day response window,
// even after the attrition curve has passed every outcome balance. Any deposit of at least
// the start bond is accepted inside the window, and a change of leader does not restart it:
// the deadline is the later of the window and the rebased curve crossing of the median.
describe('a carried game: fixed response window on the pure curve', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const YES = 1
	const NO = 2
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker })
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
	const forkUnrelatedAndMaterializeYesChild = async (source: Address) => {
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
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [universe, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		for (let step = 0; step < 3; step++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializePortfolioQuestion', args: [source, child] }))
		const pool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })
		return { pool, game: await gameFor(pool), universe: child, forkTime }
	}

	test('a below-curve flip inside the fixed response window is accepted and restarts nothing', async () => {
		const attacker = fixture.owner()
		const honest = fixture.other()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		// Honest Yes leads 105 to 100. The curve is about to pass No's 100 REP and finalize Yes.
		await deposit(honest, sourcePool(), YES, 105n * unit)
		await deposit(attacker, sourcePool(), NO, 100n * unit)
		const parentGame = await gameFor(sourcePool())
		const parentEnd = await readGame(parentGame, 'getEscalationGameEndDate')
		// An unrelated question forks the universe shortly before the parent deadline.
		await fixture.base.mockWindow.setTime(parentEnd - 600n)
		const child = await forkUnrelatedAndMaterializeYesChild(sourcePool())
		expect(child.forkTime <= parentEnd).toBe(true)
		const zoltarForkTime = await attacker.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getForkTime', args: [fixture.base.genesisUniverse] })
		expect(zoltarForkTime).toBe(child.forkTime)

		const resumedAt = await readGame(child.game, 'forkResumedAt')
		const windowEnd = resumedAt + 3n * DAY
		// The child resumes with the inherited curve at or below the 100 REP median.
		expect((await readGame(child.game, 'totalCostAttoRep')) <= 100n * unit).toBe(true)
		expect(await readGame(child.game, 'getEscalationGameEndDate')).toBe(windowEnd)

		await approveToken(attacker, getRepTokenAddress(child.universe), child.pool)
		// One second before the window closes Yes is still the provisional winner and the
		// curve is far above both balances.
		await fixture.base.mockWindow.setTime(windowEnd - 1n)
		expect(await readGame(child.game, 'getQuestionResolution')).toBe(BigInt(YES))
		expect((await readGame(child.game, 'totalCostAttoRep')) > 106n * unit).toBe(true)

		// Last second of the window: 6 REP flips the leader (106 > 105) although it stays below the curve.
		await landNextTransactionAt(windowEnd)
		await depositRaw(attacker, child.pool, NO, 6n * unit)
		expect(await latestBlockTimestamp()).toBe(windowEnd)
		expect(await readGame(child.game, 'getQuestionResolution')).toBe(BigInt(NO))
		// The flip restarts no response period: the window is the deadline.
		expect(await readGame(child.game, 'getEscalationGameEndDate')).toBe(windowEnd)

		await fixture.base.mockWindow.setTime(windowEnd + 1n)
		await expect(honest.simulateContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, 1_000n * unit] })).rejects.toThrow('Invalid deposit preview')
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(BigInt(NO))
	})
})
