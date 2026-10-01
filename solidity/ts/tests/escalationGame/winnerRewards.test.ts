import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { BURN_ADDRESS, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { deployEscalationGame, depositOnOutcome, getActivationTime, getBalances, getQuestionResolution, readBindingCapital } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { ESCALATION_TIME_LENGTH } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: tie-breaking and winner rewards', () => {
	const fixture = useEscalationGameFixture()
	const { reportBond, nonDecisionThresholdAttoRep, deployEscalationGameTestSecurityPool, depositOnOutcomeViaTestSecurityPool, claimWinningDepositAndReadClaimLog } = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('depositOnOutcome prevents tie by refunding 1 attoREP', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const depositAmount = 100n * reportBond
		// Deposit on Yes to establish a leader
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, depositAmount)
		// Deposit same amount on Invalid; would tie, but fix reduces by 1 attoREP
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Invalid, depositAmount)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, depositAmount, 'Yes balance as leader')
		assert.strictEqual(balances.invalid, depositAmount - 1n, 'Invalid balance reduced by 1 attoREP')
		assert.strictEqual(balances.no, 0n, 'No balance remains zero')
		// Advance time past game end
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Winner should be Yes')
	})

	test('deposit on leading outcome does not trigger tie-breaking adjustment', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		const amount1 = 100n * reportBond
		const amount2 = 50n * reportBond
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, amount1)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, amount2)
		const balances = await getBalances(client, escalationGame)
		assert.strictEqual(balances.yes, amount1 + amount2, 'Yes balance increased without adjustment')
		assert.strictEqual(balances.invalid, 0n, 'Invalid balance zero')
		assert.strictEqual(balances.no, 0n, 'No balance zero')
		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		const resolution = await getQuestionResolution(client, escalationGame)
		assert.strictEqual(resolution, QuestionOutcome.Yes, 'Resolution should be Yes')
	})

	test('claimDepositForWinning pays the pro-rata reward for a deposit fully below binding capital', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const winningDepositorAddress = client.account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1]).account.address
		const firstWinningDeposit = 5n * 10n ** 18n
		const secondWinningDeposit = 5n * 10n ** 18n
		const thirdWinningDeposit = 5n * 10n ** 18n
		const excessWinningDeposit = 2n * 10n ** 18n
		const losingDeposit = 10n * 10n ** 18n

		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, thirdWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, winningDepositorAddress, QuestionOutcome.Yes, excessWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const burnBalanceBeforeClaim = await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))
		const claimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 0n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(client, escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 10 REP depth')
		assert.strictEqual(claimLog.args.depositor, winningDepositorAddress, 'claim event should identify the winning depositor')
		assert.strictEqual(claimLog.args.outcome, BigInt(QuestionOutcome.Yes), 'claim event should identify the winning outcome')
		assert.strictEqual(claimLog.args.parentDepositIndex, 0n, 'claim event should identify the stable parent deposit index')
		assert.strictEqual(claimLog.args.originalDepositAmountAttoRep, firstWinningDeposit, 'claim event should include the original winning principal')
		assert.strictEqual(claimLog.args.amountToWithdrawAttoRep, 7n * 10n ** 18n, 'The first 5 REP winning deposit should receive its 2 REP pro-rata reward share')
		assert.ok(claimLog.args.burnAmountAttoRep > 0n, 'a winning escalation claim should charge a positive deterrence haircut')
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))) - burnBalanceBeforeClaim, claimLog.args.burnAmountAttoRep, 'a non-forking escalation game should burn the winner haircut outside fork migration')
		assert.strictEqual(claimLog.args.transferredRep, true, 'direct winning claims should transfer REP to the depositor')
	})

	test('claimDepositForWinning treats the region between binding capital and the reward cap as the first-come safety boundary', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositorAddress = client.account.address
		const secondWinningDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1]).account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[2]).account.address
		const firstWinningDeposit = 20n * 10n ** 18n
		const secondWinningDeposit = 14n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n

		// Reward eligibility is intentionally append-order dependent on the winning side.
		// The first 20 REP deposit fills the binding-capital region, so the later 14 REP deposit
		// only overlaps the final 10 REP safety-boundary slice and earns bonus on that slice alone.
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, firstWinningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, secondWinningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const claimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(client, escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 20 REP depth')
		assert.strictEqual(claimLog.args.depositor, secondWinningDepositorAddress, 'claim event should identify the crossing depositor')
		assert.strictEqual(claimLog.args.outcome, BigInt(QuestionOutcome.Yes), 'claim event should identify the winning outcome')
		assert.strictEqual(claimLog.args.parentDepositIndex, 1n, 'claim event should identify the crossing deposit index')
		assert.strictEqual(claimLog.args.originalDepositAmountAttoRep, secondWinningDeposit, 'claim event should include the crossing principal')
		assert.strictEqual(claimLog.args.amountToWithdrawAttoRep, 18n * 10n ** 18n, 'The 14 REP crossing deposit should earn reward on its 10 REP safety-boundary slice and principal on its 4 REP excess slice')
		assert.strictEqual(claimLog.args.transferredRep, true, 'direct winning claims should transfer REP to the depositor')
	})

	test('claimDepositForWinning shares the full reward pool across actual winning principal when winning depth stays below the reward cap', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		const firstWinningDepositorAddress = client.account.address
		const secondWinningDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[1]).account.address
		const losingDepositorAddress = createWriteClient(mockWindow, TEST_ADDRESSES[2]).account.address
		const firstWinningDeposit = 14n * 10n ** 18n
		const secondWinningDeposit = 10n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n

		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, firstWinningDepositorAddress, QuestionOutcome.Yes, firstWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, secondWinningDepositorAddress, QuestionOutcome.Yes, secondWinningDeposit)
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, losingDepositorAddress, QuestionOutcome.No, losingDeposit)

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(await getQuestionResolution(client, escalationGameAddress), QuestionOutcome.Yes, 'Resolution should be Yes')
		const firstClaimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 0n, QuestionOutcome.Yes)
		const secondClaimLog = await claimWinningDepositAndReadClaimLog(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		assert.strictEqual(await readBindingCapital(client, escalationGameAddress), losingDeposit, 'Binding capital should be the losing-side 20 REP depth')
		assert.strictEqual(firstClaimLog.args.depositor, firstWinningDepositorAddress, 'first claim event should identify its depositor')
		assert.strictEqual(firstClaimLog.args.parentDepositIndex, 0n, 'first claim event should identify the first deposit index')
		assert.strictEqual(firstClaimLog.args.originalDepositAmountAttoRep, firstWinningDeposit, 'first claim event should include original principal')
		assert.strictEqual(firstClaimLog.args.amountToWithdrawAttoRep, 21n * 10n ** 18n, 'The first 14 REP winning deposit should receive its 7 REP pro-rata reward share')
		assert.strictEqual(firstClaimLog.args.transferredRep, true, 'first direct claim should transfer REP')
		assert.strictEqual(secondClaimLog.args.depositor, secondWinningDepositorAddress, 'second claim event should identify its depositor')
		assert.strictEqual(secondClaimLog.args.parentDepositIndex, 1n, 'second claim event should identify the second deposit index')
		assert.strictEqual(secondClaimLog.args.originalDepositAmountAttoRep, secondWinningDeposit, 'second claim event should include original principal')
		assert.strictEqual(secondClaimLog.args.amountToWithdrawAttoRep, 15n * 10n ** 18n, 'The second 10 REP winning deposit should receive its 5 REP pro-rata reward share')
		assert.strictEqual(secondClaimLog.args.transferredRep, true, 'second direct claim should transfer REP')
	})
})
