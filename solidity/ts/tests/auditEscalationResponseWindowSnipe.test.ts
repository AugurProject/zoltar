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

// Audit regression: in a carried game deposits stay open for the whole 3-day response
// window, even after the attrition curve has passed every outcome balance. A flip in the
// window's last second used to finalize one second later, because the curve was already
// above the new median and so could not delay the deadline. A deposit made after the curve
// passed the median must now meet the curve, and a changed provisional result restarts the
// response period.
describe('audit: a carried game cannot be flipped without time to respond', () => {
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

	test('a flip in the last second of the response window must meet the curve and restarts the window', async () => {
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

		// The honest reporter migrates REP into the child so that it can answer there.
		await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await addRepToMigrationBalance(honest, fixture.base.genesisUniverse, 1_000n * unit)
		await splitMigrationRep(honest, fixture.base.genesisUniverse, 1_000n * unit, [1n])
		await approveToken(attacker, getRepTokenAddress(child.universe), child.pool)
		await approveToken(honest, getRepTokenAddress(child.universe), child.pool)
		// One second before the window closes Yes is still the provisional winner.
		await fixture.base.mockWindow.setTime(windowEnd - 1n)
		expect(await latestBlockTimestamp()).toBe(windowEnd - 1n)
		expect(await readGame(child.game, 'getQuestionResolution')).toBe(BigInt(YES))

		// Last second of the window: 6 REP would flip the leader (106 > 105), but the curve
		// is far above that, so support below it no longer reopens the result.
		await expect(attacker.simulateContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'depositWalletRepToEscalationGame', args: [NO, 6n * unit] })).rejects.toThrow('Invalid deposit preview')
		await landNextTransactionAt(windowEnd)

		// Meeting the curve is accepted, and the changed result restarts the response period.
		await depositRaw(attacker, child.pool, NO, 120n * unit)
		const flippedAt = await latestBlockTimestamp()
		expect(flippedAt).toBe(windowEnd)
		expect((await readGame(child.game, 'totalCostAttoRep')) <= 220n * unit).toBe(true)
		expect(await readGame(child.game, 'getQuestionResolution')).toBe(BigInt(NO))
		expect(await readGame(child.game, 'getEscalationGameEndDate')).toBe(flippedAt + 3n * DAY)

		// The old window has passed, No is not final, and Yes can still answer.
		await fixture.base.mockWindow.setTime(windowEnd + DAY)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(3n)
		const cost = await readGame(child.game, 'totalCostAttoRep')
		await expect(honest.simulateContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, 116n * unit] })).rejects.toThrow('Invalid deposit preview')
		await depositRaw(honest, child.pool, YES, cost)
		expect((await readGame(child.game, 'getEscalationGameEndDate')) >= flippedAt + 3n * DAY).toBe(true)

		// Without a further answer Yes wins once the restarted period and the curve have passed.
		await fixture.base.mockWindow.setTime((await readGame(child.game, 'getEscalationGameEndDate')) + 1n)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
	})
})
