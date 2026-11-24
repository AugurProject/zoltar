import { describe, expect, test } from 'bun:test'
import { parseAbiItem, toFunctionSelector, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ESCALATION_TIME_LENGTH } from '@zoltar/statoblast-shared/escalationGame/escalationMath'
import * as contractArtifacts from '../types/contractArtifact'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate as depositDelegateArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// The game's deadline is the last second the forward attrition curve is at or below the
// median balance. Any deposit of at least the start bond is accepted while the game is open;
// a change of leader buys no extra response time, and no game outlasts its escalation interval.
describe('escalation game: pure attrition curve', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const INVALID = 0
	const YES = 1
	const NO = 2
	const pool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const gameFor = (address: Address) => fixture.owner().readContract({ abi: poolArtifact.abi, address, functionName: 'escalationGame' })
	const readGame = <const Name extends 'getFinalQuestionResolution' | 'getQuestionResolution' | 'totalCostAttoRep' | 'getEscalationGameEndDate' | 'activationTime' | 'startBondAttoRep' | 'nonDecisionThresholdAttoRep' | 'getBindingCapitalAttoRep' | 'getOutcomeBalancesAttoRep'>(game: Address, functionName: Name) =>
		fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName })
	const curveAt = (game: Address, elapsed: bigint) => fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'computeIterativeAttritionCostAttoRep', args: [elapsed] })
	const depositRaw = (sender: WriteClient, outcome: number, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const latestBlockTimestamp = async () => {
		const block = await fixture.base.mockWindow.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
		if (typeof block !== 'object' || block === null || !('timestamp' in block) || typeof block.timestamp !== 'string') throw new Error('Latest block has no timestamp')
		return BigInt(block.timestamp)
	}
	const prepare = async () => {
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(fixture.other(), getRepTokenAddress(fixture.base.genesisUniverse), pool())
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), pool())
	}
	/** The deadline is the last second the forward curve is at or below the median balance. */
	const expectCurveDeadline = async (game: Address) => {
		const end = await readGame(game, 'getEscalationGameEndDate')
		const elapsed = end - (await readGame(game, 'activationTime'))
		const median = await readGame(game, 'getBindingCapitalAttoRep')
		expect(await curveAt(game, elapsed)).toBeLessThanOrEqual(median)
		expect(await curveAt(game, elapsed + 1n)).toBeGreaterThan(median)
		return end
	}

	test('a start-bond deposit whose cumulative stays below the curve is accepted while the game is open', async () => {
		await prepare()
		await depositRaw(fixture.other(), YES, 1_000n * unit)
		const game = await gameFor(pool())
		await depositRaw(fixture.owner(), NO, 900n * unit)
		const startBond = await readGame(game, 'startBondAttoRep')
		const end = await expectCurveDeadline(game)
		// Late in the game the curve has passed the start bond but not the median.
		await fixture.base.mockWindow.setTime(end - 60n)
		const cost = await readGame(game, 'totalCostAttoRep')
		expect(cost).toBeGreaterThan(startBond)
		await depositRaw(fixture.owner(), INVALID, startBond)
		expect((await readGame(game, 'getOutcomeBalancesAttoRep'))[INVALID]).toBe(startBond)
		// A small top-up on the trailing side that does not reach the leader is accepted too.
		await depositRaw(fixture.owner(), NO, startBond)
		expect((await readGame(game, 'getOutcomeBalancesAttoRep'))[NO]).toBe(900n * unit + startBond)
		expect(await readGame(game, 'getQuestionResolution')).toBe(3n)
	})

	test('a change of leader restarts no response period: the deadline stays the curve crossing of the median', async () => {
		await prepare()
		const leader = fixture.other()
		const challenger = fixture.owner()
		await depositRaw(leader, YES, 1_000n * unit)
		const game = await gameFor(pool())
		const startBond = await readGame(game, 'startBondAttoRep')
		await depositRaw(challenger, NO, 900n * unit)
		const firstEnd = await expectCurveDeadline(game)

		// A top-up on the leader leaves the median, and so the deadline, unchanged.
		await depositRaw(leader, YES, 100n * unit)
		expect(await expectCurveDeadline(game)).toBe(firstEnd)

		// Support on the losing side raises the median and pushes the deadline later. Asking
		// to tie the leader is trimmed by one attoREP, so Yes still leads.
		await depositRaw(challenger, NO, 200n * unit)
		expect((await readGame(game, 'getOutcomeBalancesAttoRep'))[NO]).toBe(1_100n * unit - 1n)
		const shadowEnd = await expectCurveDeadline(game)
		expect(shadowEnd).toBeGreaterThan(firstEnd)

		// One start bond in the last open second flips the leader. The new median is the old
		// leader's stake, and the deadline is where the curve crosses it, not a fresh period.
		await fixture.base.mockWindow.setTime(shadowEnd - 1n)
		await depositRaw(challenger, NO, startBond)
		const flippedAt = await latestBlockTimestamp()
		expect(flippedAt).toBe(shadowEnd)
		const flipped = await readGame(game, 'getOutcomeBalancesAttoRep')
		expect(flipped[NO]).toBeGreaterThan(flipped[YES])
		const flippedEnd = await expectCurveDeadline(game)
		expect(flippedEnd).toBeLessThan(flippedAt + 60n)

		// Once the curve passes the median no reply is accepted and the flip is final.
		await fixture.base.mockWindow.setTime(flippedEnd + 1n)
		await expect(leader.simulateContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [YES, 1_000n * unit] })).rejects.toThrow('Invalid deposit preview')
		expect(await readGame(game, 'getFinalQuestionResolution')).toBe(BigInt(NO))
	})

	test('a flip in the last second of a long game cannot outlast the escalation interval (#1478)', async () => {
		await prepare()
		const leader = fixture.other()
		const challenger = fixture.owner()
		const firstReport = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		await depositRaw(leader, YES, firstReport)
		const game = await gameFor(pool())
		const activation = await readGame(game, 'activationTime')
		const startBond = await readGame(game, 'startBondAttoRep')
		const threshold = await readGame(game, 'nonDecisionThresholdAttoRep')
		// Both sides stake close to the threshold, so the curve deadline is near the end of the interval.
		const stake = (threshold * 9n) / 10n
		await depositRaw(leader, YES, stake - firstReport)
		await depositRaw(challenger, NO, stake)
		const end = await expectCurveDeadline(game)
		expect(end).toBeGreaterThan(activation + ESCALATION_TIME_LENGTH - 7n * 86_400n)
		await fixture.base.mockWindow.setTime(end - 1n)
		await depositRaw(challenger, NO, startBond)
		const flipped = await readGame(game, 'getOutcomeBalancesAttoRep')
		expect(flipped[NO]).toBeGreaterThan(flipped[YES])
		const flippedEnd = await expectCurveDeadline(game)
		expect(flippedEnd).toBeLessThanOrEqual(activation + ESCALATION_TIME_LENGTH)
		await fixture.base.mockWindow.setTime(flippedEnd + 1n)
		expect(await readGame(game, 'getFinalQuestionResolution')).toBe(BigInt(NO))
	})

	test('collective challenge escrow and batch reporting are gone from the ABI', async () => {
		expect(Object.keys(contractArtifacts).filter(name => name.includes('EscalationChallengeEscrow'))).toEqual([])
		const removed = ['depositRepOnOutcomeForBatch', 'responseRestartedUntil']
		for (const abi of [gameArtifact.abi, depositDelegateArtifact.abi]) {
			const names = abi.flatMap(item => ('name' in item ? [item.name] : []))
			for (const name of removed) expect(names).not.toContain(name)
		}
		await prepare()
		await depositRaw(fixture.other(), YES, 1_000n * unit)
		const game = await gameFor(pool())
		// The old batch selector now falls through to the claim delegate, which does not know it.
		const selector = toFunctionSelector(parseAbiItem('function depositRepOnOutcomeForBatch(uint8,address[],uint256[])'))
		await expect(fixture.owner().call({ to: game, data: selector })).rejects.toThrow()
	})
})
