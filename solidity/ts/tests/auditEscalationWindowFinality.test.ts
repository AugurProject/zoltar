import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// A late flip must extend all three schedules together: game, settlement and reporter
// custody. No ledger may freeze claims before the honest side's curve-based reply.
describe("audit: a carried game's resumed curve keeps game, settlement book and reporter ledger in agreement", () => {
	const fixture = useSecurityPoolFixture()
	const YES = 1
	const NO = 2
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const securityPool = () => ({ abi: securityPoolArtifact.abi, address: fixture.securityPool })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
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
		const controller = await owner.readContract({ ...securityPool(), functionName: 'forkController' })
		const branch = { abi: forkArtifact.abi, address: controller }
		const child = getChildUniverseId(universe, 1)
		const forkTime = (await getUniverseData(owner, universe)).forkTime
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [universe, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		for (let step = 0; step < 3; step++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializeSecurityPoolQuestion', args: [source, child] }))
		const pool = await owner.readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [fixture.base.questionId, child] })
		return { pool, game: await gameFor(pool), universe: child }
	}

	const schedules = async (game: Address, universe: bigint) => {
		const owner = fixture.owner()
		const engine = await owner.readContract({ ...securityPool(), functionName: 'settlement' })
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [universe] })
		const [question, frozen] = await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		const reporterLedger = await owner.readContract({ ...securityPool(), functionName: 'reporterLedger', args: [universe] })
		const [reporter, reporterFinal] = await owner.readContract({ abi: reporterArtifact.abi, address: reporterLedger, functionName: 'question', args: [universe, fixture.base.questionId] })
		const gameEnd = await readGame(game, 'getEscalationGameEndDate')
		const native = (value: bigint | number) => (BigInt(value) === 0n ? Promise.resolve(0n) : owner.readContract({ ...securityPool(), functionName: 'nativeTimeForSecurityPoolTime', args: [universe, Number(value)] }))
		return { gameEnd, bookEnd: BigInt(await native(question.finalAfter)), reporterEnd: BigInt(await native(reporter.finalAfter)), frozen, reporterFinal, supply: question.outcomeSupplyAttoShares }
	}

	test('a last-second flip extends every schedule and the honest side can reply', async () => {
		const attacker = fixture.owner()
		const honest = fixture.other()
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await deposit(honest, sourcePool(), YES, 150n * unit)
		await deposit(attacker, sourcePool(), NO, 100n * unit)
		const parentGame = await gameFor(sourcePool())
		const parentEnd = await readGame(parentGame, 'getEscalationGameEndDate')
		await fixture.base.mockWindow.setTime(parentEnd - 600n)
		const child = await forkUnrelatedAndMaterializeYesChild(sourcePool())
		const initial = await schedules(child.game, child.universe)
		expect(initial.bookEnd).toBe(initial.gameEnd)
		expect(initial.reporterEnd).toBe(initial.gameEnd)
		await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await addRepToMigrationBalance(honest, fixture.base.genesisUniverse, 1_000n * unit)
		await splitMigrationRep(honest, fixture.base.genesisUniverse, 1_000n * unit, [1n])
		await approveToken(attacker, getRepTokenAddress(child.universe), child.pool)
		await approveToken(honest, getRepTokenAddress(child.universe), child.pool)
		await landNextTransactionAt(initial.gameEnd)
		await depositRaw(attacker, child.pool, NO, 51n * unit)
		const flippedAt = await latestBlockTimestamp()
		const afterFlip = await schedules(child.game, child.universe)
		// Raising the median preserves a real reply interval in every ledger.
		expect(afterFlip.gameEnd).toBeGreaterThan(initial.gameEnd + DAY)
		expect(flippedAt).toBe(initial.gameEnd)
		expect(afterFlip.bookEnd).toBe(afterFlip.gameEnd)
		expect(afterFlip.reporterEnd).toBe(afterFlip.gameEnd)
		expect(afterFlip.frozen).toBe(0n)
		expect(afterFlip.reporterFinal).toBe(false)
		const reporterLedger = await honest.readContract({ ...securityPool(), functionName: 'reporterLedger', args: [child.universe] })
		await depositRaw(honest, child.pool, YES, 77n * unit)
		const afterReply = await schedules(child.game, child.universe)
		expect(afterReply.bookEnd).toBe(afterReply.gameEnd)
		expect(afterReply.reporterEnd).toBe(afterReply.gameEnd)
		expect(afterReply.frozen).toBe(0n)
		expect(afterReply.reporterFinal).toBe(false)
		await fixture.base.mockWindow.setTime(afterReply.gameEnd + 1n)
		expect(await readGame(child.game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
		await expect(honest.simulateContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, 500n * unit] })).rejects.toThrow('Invalid deposit preview')
		const shares = { abi: shareArtifact.abi, address: fixture.poolFor(fixture.base.questionId).shareToken }
		await writeContractAndWait(honest, () => honest.writeContract({ ...shares, functionName: 'migrate', args: [fixture.base.genesisUniverse * 256n + 1n, [1n]] }))
		await writeContractAndWait(honest, () => honest.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'redeemShares', args: [0n] }))
		const final = await schedules(child.game, child.universe)
		expect(final.frozen).not.toBe(0n)
		await writeContractAndWait(honest, () => honest.writeContract({ abi: reporterArtifact.abi, address: reporterLedger, functionName: 'checkpoint', args: [child.universe] }))
		expect((await schedules(child.game, child.universe)).reporterFinal).toBe(true)
	})
})
