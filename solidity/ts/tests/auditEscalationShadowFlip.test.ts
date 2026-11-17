import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// Audit regression: over-bonding used to buy an ordinary-game leader no response time.
// The runner-up first "shadows" the leader at leader - 1 attoREP (the tie rule trims an exact
// match by one attoREP), which moves the deadline to the last second the curve is at or below
// leader - 1. In that last second it adds one start bond. The new median is the old leader,
// whose curve second is the same one, so the flip used to be final in the next block. A
// deposit that takes the lead now restarts a three-day response period, and a reply made
// after the curve has passed the median must meet the curve.
describe('audit: a change of leader always leaves time to respond', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const YES = 1
	const NO = 2
	const pool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const gameFor = (address: Address) => fixture.owner().readContract({ abi: poolArtifact.abi, address, functionName: 'escalationGame' })
	const readGame = <const Name extends 'getFinalQuestionResolution' | 'getQuestionResolution' | 'totalCostAttoRep' | 'getEscalationGameEndDate' | 'activationTime' | 'startBondAttoRep' | 'nonDecisionThresholdAttoRep' | 'getBindingCapitalAttoRep' | 'responseRestartedUntil' | 'getOutcomeBalancesAttoRep'>(
		game: Address,
		functionName: Name,
	) => fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName })
	const depositRaw = (sender: WriteClient, outcome: number, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const latestBlockTimestamp = async () => {
		const block = await fixture.base.mockWindow.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
		if (typeof block !== 'object' || block === null || !('timestamp' in block) || typeof block.timestamp !== 'string') throw new Error('Latest block has no timestamp')
		return BigInt(block.timestamp)
	}

	test('shadow at leader - 1 attoREP, then one start bond in the last second', async () => {
		const attacker = fixture.owner()
		const honest = fixture.other()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), pool())
		await approveToken(attacker, getRepTokenAddress(fixture.base.genesisUniverse), pool())

		// Honest first report: 1000 REP, far above the start bond.
		await depositRaw(honest, YES, 1_000n * unit)
		const game = await gameFor(pool())
		const startBond = await readGame(game, 'startBondAttoRep')
		const threshold = await readGame(game, 'nonDecisionThresholdAttoRep')
		const activation = await readGame(game, 'activationTime')
		expect(threshold > 2_000n * unit).toBe(true)
		expect(await readGame(game, 'getEscalationGameEndDate')).toBe(activation)

		// Shadow: asking for the same 1000 REP is trimmed to 1000 REP - 1 attoREP. Yes still leads.
		await depositRaw(attacker, NO, 1_000n * unit)
		const balances = await readGame(game, 'getOutcomeBalancesAttoRep')
		expect(balances[YES]).toBe(1_000n * unit)
		expect(balances[NO]).toBe(1_000n * unit - 1n)
		const shadowEnd = await readGame(game, 'getEscalationGameEndDate')
		expect(shadowEnd > activation).toBe(true)

		// Honest reporter still leads one second before the deadline and has no reason to act.
		await fixture.base.mockWindow.setTime(shadowEnd - 1n)
		expect(await readGame(game, 'getQuestionResolution')).toBe(3n)
		expect(await readGame(game, 'getFinalQuestionResolution')).toBe(3n)

		// Last second: one start bond flips the leader.
		await depositRaw(attacker, NO, startBond)
		const flippedAt = await latestBlockTimestamp()
		expect(flippedAt).toBe(shadowEnd)
		const flippedEnd = await readGame(game, 'getEscalationGameEndDate')
		expect(flippedEnd).toBe(flippedAt + 3n * DAY)
		expect(await readGame(game, 'responseRestartedUntil')).toBe(flippedEnd)

		// Two days later No is not final. The curve has passed Yes's stake, so a token
		// reply is refused, while support that meets the curve retakes the lead.
		await fixture.base.mockWindow.setTime(flippedAt + 2n * DAY)
		expect(await readGame(game, 'getQuestionResolution')).toBe(BigInt(NO))
		expect(await readGame(game, 'getFinalQuestionResolution')).toBe(3n)
		expect((await readGame(game, 'totalCostAttoRep')) > 1_002n * unit).toBe(true)
		await expect(honest.simulateContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [YES, 2n * unit] })).rejects.toThrow('Invalid deposit preview')
		await depositRaw(honest, YES, 1_000n * unit)
		const answeredAt = await latestBlockTimestamp()
		expect(await readGame(game, 'getQuestionResolution')).toBe(BigInt(YES))
		expect(await readGame(game, 'getEscalationGameEndDate')).toBe(answeredAt + 3n * DAY)

		// Without a further answer Yes is final once that period has passed.
		await fixture.base.mockWindow.setTime(answeredAt + 3n * DAY + 1n)
		expect(await readGame(game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
	})

	test('a minimum-bond first report flipped in the last second of the activation delay can still answer', async () => {
		const attacker = fixture.owner()
		const honest = fixture.other()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), pool())
		await approveToken(attacker, getRepTokenAddress(fixture.base.genesisUniverse), pool())
		const bond = await attacker.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		await depositRaw(honest, YES, bond)
		const game = await gameFor(pool())
		const activation = await readGame(game, 'activationTime')
		await fixture.base.mockWindow.setTime(activation - 1n)
		await depositRaw(attacker, NO, bond + 1n)
		expect(await latestBlockTimestamp()).toBe(activation)
		expect(await readGame(game, 'getEscalationGameEndDate')).toBe(activation + 3n * DAY)
		await fixture.base.mockWindow.setTime(activation + DAY)
		expect(await readGame(game, 'getFinalQuestionResolution')).toBe(3n)
		await depositRaw(honest, YES, 10n * bond)
		expect(await readGame(game, 'getQuestionResolution')).toBe(BigInt(YES))
	})
})
