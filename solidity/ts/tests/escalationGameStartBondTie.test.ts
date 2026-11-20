import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool as poolArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createE2E, NO, YES } from './auditE2EHarness'
import { useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// A report that would tie the leader is trimmed by one attoREP. The start bond applies to
// the amount offered, so a start-bond report on a second outcome is accepted rather than
// rejected after the trim.
describe('escalation game: a start-bond report that would tie the leader', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)
	const pool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const deposit = (sender: WriteClient, outcome: number, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const setup = async () => {
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		for (const index of [0, 1]) await approveToken(e2e.account(index), rep, pool())
		const bond = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		return { first: e2e.account(0), second: e2e.account(1), bond }
	}

	test('is accepted one attoREP below the leader instead of reverting below the start bond', async () => {
		const { first, second, bond } = await setup()
		await deposit(first, NO, bond)
		const game = e2e.game(await e2e.gameOf(pool()))
		const [acceptedAmount, resultingBalance] = await fixture.owner().readContract({ ...game, functionName: 'previewDepositOnOutcome', args: [YES, bond] })
		expect(acceptedAmount).toBe(bond - 1n)
		expect(resultingBalance).toBe(bond - 1n)
		await deposit(second, YES, bond)
		const balances = await e2e.balances(game.address)
		expect(balances[YES]).toBe(bond - 1n)
		expect(balances[NO]).toBe(bond)
		// The reporter can still top up past the leader.
		await deposit(second, YES, bond)
		expect((await e2e.balances(game.address))[YES]).toBe(2n * bond - 1n)
	})

	test('still rejects an offered amount below the start bond', async () => {
		const { first, second, bond } = await setup()
		await deposit(first, NO, bond)
		const game = e2e.game(await e2e.gameOf(pool()))
		await expect(fixture.owner().readContract({ ...game, functionName: 'previewDepositOnOutcome', args: [YES, bond - 1n] })).rejects.toThrow('Invalid deposit preview')
		await expect(deposit(second, YES, bond - 1n)).rejects.toThrow()
		expect((await e2e.balances(game.address))[YES]).toBe(0n)
	})
})
