import { describe, expect, test } from 'bun:test'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: ordinary settlement with portfolio reporter custody', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const token = () => getRepTokenAddress(fixture.base.genesisUniverse)
	const report = (outcome: QuestionOutcome, amount: bigint) => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const withdraw = (outcome: QuestionOutcome, index: bigint) => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...pool(), functionName: 'withdrawFromEscalationGame', args: [outcome, [index]] }))
	const prepare = async (splitWinner = false) => {
		await fixture.prepare()
		await fixture.mint()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		await approveToken(fixture.other(), token(), pool().address)
		await report(QuestionOutcome.Invalid, 100n * unit)
		await report(QuestionOutcome.No, 200n * unit)
		for (const amount of splitWinner ? [10n * unit + 1n, 10n * unit + 1n, 10n * unit + 1n, 270n * unit - 3n] : [300n * unit]) await report(QuestionOutcome.Yes, amount)
		const game = { abi: gameArtifact.abi, address: await fixture.owner().readContract({ ...pool(), functionName: 'escalationGame' }) }
		const end = await fixture.owner().readContract({ ...game, functionName: 'activationTime' })
		await fixture.base.mockWindow.setTime(end + 49n * DAY + 1n)
		const ledger = await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'reporterLedger', args: [fixture.base.genesisUniverse] })
		const balance = () => fixture.owner().readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'balanceOfGame', args: [game.address] })
		const settle = () => writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...game, functionName: 'settleOrdinaryGame' }))
		return { game, balance, settle }
	}

	test('preserves every winner liability after surplus has left reporter custody', async () => {
		const { game, balance, settle } = await prepare()
		expect(await balance()).toBe(500n * unit)
		expect(await getERC20Balance(fixture.owner(), token(), game.address)).toBe(0n)
		await settle()
		expect(await balance()).toBe(500n * unit)
		const before = await getERC20Balance(fixture.owner(), token(), fixture.other().account.address)
		await withdraw(QuestionOutcome.Yes, 0n)
		expect((await getERC20Balance(fixture.owner(), token(), fixture.other().account.address)) - before).toBe(420n * unit)
		expect(await balance()).toBe(0n)
	})

	test('settles without a reporter claim and repeated settlement preserves the winner reserve', async () => {
		const { game, balance, settle } = await prepare()
		await settle()
		await settle()
		expect(await balance()).toBe(500n * unit)
		expect(await fixture.owner().readContract({ ...game, functionName: 'ordinaryWinningReserveAttoRep' })).toBe(500n * unit)
	})

	test('retires losing rights globally and repeated zero-value claims cannot drain winners', async () => {
		const { game, balance, settle } = await prepare()
		await settle()
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.No]) {
			expect(await fixture.owner().readContract({ ...game, functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome', args: [fixture.other().account.address, outcome] })).toBe(0n)
			expect((await fixture.owner().readContract({ ...game, functionName: 'getDepositsByOutcome', args: [outcome, 0n, 1n] }))[0]?.amountAttoRep).toBe(0n)
			const state = await fixture.owner().readContract({ ...game, functionName: 'getOutcomeState', args: [outcome] })
			expect(state.localUnresolvedTotalAttoRep).toBe(0n)
			expect(state.currentCarryTotalAttoRep).toBe(0n)
			await withdraw(outcome, 0n)
			await withdraw(outcome, 0n)
		}
		expect(await balance()).toBe(500n * unit)
	})

	test('split winner intervals exhaust payouts and burns in reverse claim order and reject replay', async () => {
		const { game, balance, settle } = await prepare(true)
		await settle()
		const before = await getERC20Balance(fixture.owner(), token(), fixture.other().account.address)
		for (const index of [3n, 2n, 1n, 0n]) await withdraw(QuestionOutcome.Yes, index)
		expect((await getERC20Balance(fixture.owner(), token(), fixture.other().account.address)) - before).toBe(420n * unit)
		expect(await balance()).toBe(0n)
		expect(await fixture.owner().readContract({ ...game, functionName: 'ordinaryWinningReserveAttoRep' })).toBe(0n)
		await expect(withdraw(QuestionOutcome.Yes, 0n)).rejects.toThrow('Deposit settled')
	})
})
