import { stagePortfolioForkCapital } from '../testSupport/simulator/utils/contracts/portfolioFork'
import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// When a flip in the last second of a carried game's response window restarts that window,
// the settlement book and the reporter ledger must follow the game's new deadline: neither
// may freeze the question before the game is final.
describe('audit: a restarted response window keeps game, settlement book and reporter ledger in agreement', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const YES = 1
	const NO = 2
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker })
	const gameFor = (pool: Address) => fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
	const readGame = <const Name extends 'getFinalQuestionResolution' | 'totalCostAttoRep' | 'getEscalationGameEndDate' | 'forkResumedAt'>(game: Address, functionName: Name) => fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName })
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
		await stagePortfolioForkCapital(owner, branch.address, universe, 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [universe, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		for (let step = 0; step < 3; step++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializePortfolioQuestion', args: [source, child] }))
		const pool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })
		return { pool, game: await gameFor(pool), universe: child }
	}

	const schedules = async (game: Address, universe: bigint) => {
		const owner = fixture.owner()
		const engine = await owner.readContract({ ...portfolio(), functionName: 'settlement' })
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [universe] })
		const [question, frozen] = await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		const reporterLedger = await owner.readContract({ ...portfolio(), functionName: 'reporterLedger', args: [universe] })
		const [reporter, reporterFinal] = await owner.readContract({ abi: reporterArtifact.abi, address: reporterLedger, functionName: 'question', args: [universe, fixture.base.questionId] })
		const gameEnd = await readGame(game, 'getEscalationGameEndDate')
		const native = (value: bigint | number) => (BigInt(value) === 0n ? Promise.resolve(0n) : owner.readContract({ ...portfolio(), functionName: 'nativeTimeForPortfolioTime', args: [universe, Number(value)] }))
		return { gameEnd, bookEnd: BigInt(await native(question.finalAfter)), reporterEnd: BigInt(await native(reporter.finalAfter)), frozen, reporterFinal, supply: question.outcomeSupplyAttoShares }
	}

	test('every schedule follows a restarted response window and nothing freezes early', async () => {
		const attacker = fixture.owner()
		const honest = fixture.other()
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await deposit(honest, sourcePool(), YES, 105n * unit)
		await deposit(attacker, sourcePool(), NO, 100n * unit)
		const parentGame = await gameFor(sourcePool())
		const parentEnd = await readGame(parentGame, 'getEscalationGameEndDate')
		await fixture.base.mockWindow.setTime(parentEnd - 600n)
		const child = await forkUnrelatedAndMaterializeYesChild(sourcePool())
		const resumedAt = await readGame(child.game, 'forkResumedAt')
		const windowEnd = resumedAt + 3n * DAY
		const initial = await schedules(child.game, child.universe)
		expect(initial.bookEnd).toBe(initial.gameEnd)
		expect(initial.reporterEnd).toBe(initial.gameEnd)
		await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await addRepToMigrationBalance(honest, fixture.base.genesisUniverse, 1_000n * unit)
		await splitMigrationRep(honest, fixture.base.genesisUniverse, 1_000n * unit, [1n])
		await approveToken(attacker, getRepTokenAddress(child.universe), child.pool)
		await approveToken(honest, getRepTokenAddress(child.universe), child.pool)
		await landNextTransactionAt(windowEnd)
		await depositRaw(attacker, child.pool, NO, 120n * unit)
		const flippedAt = await latestBlockTimestamp()
		const afterFlip = await schedules(child.game, child.universe)
		expect(afterFlip.gameEnd).toBe(flippedAt + 3n * DAY)
		expect(afterFlip.bookEnd).toBe(afterFlip.gameEnd)
		expect(afterFlip.reporterEnd).toBe(afterFlip.gameEnd)
		// Past the original window: checkpoint every ledger. Nothing may freeze.
		await fixture.base.mockWindow.setTime(windowEnd + DAY)
		await writeContractAndWait(honest, () => honest.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'updateSettlementCollateral' }))
		const reporterLedger = await honest.readContract({ ...portfolio(), functionName: 'reporterLedger', args: [child.universe] })
		await writeContractAndWait(honest, () => honest.writeContract({ abi: reporterArtifact.abi, address: reporterLedger, functionName: 'checkpoint', args: [child.universe] }))
		const midway = await schedules(child.game, child.universe)
		expect(midway.frozen).toBe(0n)
		expect(midway.reporterFinal).toBe(false)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(3n)
		const cost = await readGame(child.game, 'totalCostAttoRep')
		await depositRaw(honest, child.pool, YES, cost)
		const answered = await schedules(child.game, child.universe)
		expect(answered.bookEnd).toBe(answered.gameEnd)
		expect(answered.reporterEnd).toBe(answered.gameEnd)
		// One second before the end: still open everywhere.
		await fixture.base.mockWindow.setTime(answered.gameEnd - 1n)
		await writeContractAndWait(honest, () => honest.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'updateSettlementCollateral' }))
		const beforeEnd = await schedules(child.game, child.universe)
		expect(beforeEnd.frozen).toBe(0n)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(3n)
		await fixture.base.mockWindow.setTime(answered.gameEnd + 1n)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
		const shares = { abi: shareArtifact.abi, address: fixture.poolFor(fixture.base.questionId).shareToken }
		await writeContractAndWait(honest, () => honest.writeContract({ ...shares, functionName: 'migrate', args: [fixture.base.genesisUniverse * 256n + 1n, [1n]] }))
		await writeContractAndWait(honest, () => honest.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'redeemShares' }))
		const final = await schedules(child.game, child.universe)
		expect(final.frozen).not.toBe(0n)
		expect(final.supply).toBe(0n)
		await writeContractAndWait(honest, () => honest.writeContract({ abi: reporterArtifact.abi, address: reporterLedger, functionName: 'checkpoint', args: [child.universe] }))
		expect((await schedules(child.game, child.universe)).reporterFinal).toBe(true)
	})
})
