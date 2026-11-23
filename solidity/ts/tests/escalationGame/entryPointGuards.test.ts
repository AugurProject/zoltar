import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, MAX_UINT256 } from '../../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getActivationTime, getBalances, getEscalationGameDeposits, getQuestionResolution, readHasReachedNonDecision, readNonDecisionState, readCanTriggerOwnFork, readEscalationGameEndDate, readFinalQuestionResolution, readNonDecisionTimestamp } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { statoblast_EscalationGame_EscalationGame, test_statoblast_EscalationGameProofTestQuestionLedger_EscalationGameProofTestQuestionLedger as escalationGameProofTestPoolArtifact } from '../../types/contractArtifact'
import { ESCALATION_TIME_LENGTH, FRESH_FORK_RESPONSE_PERIOD, NON_DECISION_STATE_LOCAL, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: deposits and entry-point guards', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		deployEscalationGameTestQuestionLedger,
		deployEscalationGameWithProofPool,
		deployFalseReturningToken,
		startEscalationFromFork,
		resumeEscalationFromFork,
		initializeSnapshotViaTestQuestionLedger,
		depositOnOutcomeViaProofTestQuestionLedger,
		claimDepositForWinningViaTestQuestionLedger,
		depositOnOutcomeViaTestQuestionLedger,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('escrow and settlement entry points cover authorization, argument, lifecycle, and residual-state guards', async () => {
		const deployment = await deployEscalationGameTestQuestionLedger()
		await assert.rejects(
			client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
				args: [client.account.address, QuestionOutcome.None],
			}),
			/No outcome/,
		)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'sweepResidualRepToQuestionLedger',
				args: [],
			}),
			/Question not final/,
		)

		const emptyFinal = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(emptyFinal.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await assert.rejects(resumeEscalationFromFork(emptyFinal.escalationGameAddress), /Fork snapshot incomplete/)
		await initializeSnapshotViaTestQuestionLedger(emptyFinal.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await resumeEscalationFromFork(emptyFinal.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: emptyFinal.escalationGameAddress,
				functionName: 'sweepResidualRepToQuestionLedger',
				args: [],
			}),
			/No sweepable REP/,
		)

		const unresolved = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(unresolved.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const activationTime = await getActivationTime(client, unresolved.escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: unresolved.escalationGameAddress,
				functionName: 'sweepResidualRepToQuestionLedger',
				args: [],
			}),
			/No sweepable REP/,
		)
	})

	test('empty started game becomes final only after its exact end timestamp', async () => {
		const { escalationGameAddress: escalationGame } = await deployEscalationGameTestQuestionLedger()
		const escalationEndDate = await readEscalationGameEndDate(client, escalationGame)

		await mockWindow.setTime(escalationEndDate - 1n)
		assert.strictEqual(await readFinalQuestionResolution(client, escalationGame), BigInt(QuestionOutcome.None), 'the result must remain non-final one second before the escalation deadline')

		await mockWindow.setTime(escalationEndDate)
		assert.strictEqual(await readFinalQuestionResolution(client, escalationGame), BigInt(QuestionOutcome.None), 'the result must remain non-final at the exact escalation deadline')

		await mockWindow.setTime(escalationEndDate + 1n)
		assert.strictEqual(await readFinalQuestionResolution(client, escalationGame), BigInt(QuestionOutcome.Invalid), 'the empty game should become finally invalid one second after the escalation deadline')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.Invalid, 'the ordinary resolution view should agree with the final result')
	})

	test('non-decision keeps question resolution at None even after the nominal timeout window', async () => {
		const { escalationGameAddress: escalationGame, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, nonDecisionThresholdAttoRep)
		assert.strictEqual(await readHasReachedNonDecision(client, escalationGame), true, 'two threshold-reaching outcomes should trigger non-decision')
		assert.strictEqual(await readNonDecisionState(client, escalationGame), NON_DECISION_STATE_LOCAL, 'a local threshold-crossing deposit should record local non-decision')
		assert.strictEqual(await readCanTriggerOwnFork(client, escalationGame), true, 'a local non-decision should authorize the own-fork path')
		assert.ok((await readNonDecisionTimestamp(client, escalationGame)) > 0n, 'a local non-decision should record its event time')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'non-decision should leave the question unresolved')

		const activationTime = await getActivationTime(client, escalationGame)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		assert.strictEqual(await readHasReachedNonDecision(client, escalationGame), true, 'non-decision should stay active after time advances')
		assert.strictEqual(await getQuestionResolution(client, escalationGame), QuestionOutcome.None, 'non-decision should still take precedence after time advances')
	})

	test('depositOnOutcome reverts when outcome is None', async () => {
		const { testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await assert.rejects(depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.None, reportBond))
	})

	test('depositOnOutcome reverts when outcome is out of enum range', async () => {
		const { testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		// Values > 3 are outside enum (0=Invalid,1=Yes,2=No,3=None)
		await assert.rejects(depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, 4 as QuestionOutcome, reportBond))
		await assert.rejects(depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, 255 as QuestionOutcome, reportBond))
	})

	test('depositOnOutcome accepts a start-bond deposit that the tie adjustment leaves one attoREP below the bond', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const balances = await getBalances(client, escalationGameAddress)
		assert.strictEqual(balances.invalid, reportBond, 'original leading balance should stay untouched')
		assert.strictEqual(balances.yes, reportBond - 1n, 'the start bond applies to the offered amount, before the tie adjustment')
		// The pool previews the offered amount first, so an offer below the start bond never reaches the recorder.
		await assert.rejects(depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, reportBond - 1n), /Invalid deposit preview/, 'an offered amount below the start bond must still revert')
		// The recorder admits a sub-bond amount only as a trimmed tie: one attoREP under the bond, ending one attoREP under the leader.
		await assert.rejects(
			writeContractAndWait(client, async () => await client.writeContract({ abi: escalationGameProofTestPoolArtifact.abi, address: testQuestionLedgerAddress, functionName: 'recordDeposit', args: [client.account.address, QuestionOutcome.No, reportBond - 2n, reportBond - 2n] })),
			/Below start bond/,
			'a recorded amount below the start bond that is not a trimmed tie must revert',
		)
	})

	test('getEscalationGameDeposits paginates deposits without adding synthetic entries', async () => {
		const { escalationGameAddress: escalationGame, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond * 2n)

		for (const [outcome, expected] of [
			[QuestionOutcome.Yes, 2n],
			[QuestionOutcome.No, 0n],
			[QuestionOutcome.None, 0n],
		] as const) {
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getDepositsByOutcomeLength', args: [outcome] }), expected)
		}
		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes)
		const depositPage = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getDepositsByOutcome',
			args: [QuestionOutcome.Yes, 1n, 5n],
		})
		const maxCountDepositPage = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getDepositsByOutcome',
			args: [QuestionOutcome.Yes, 1n, MAX_UINT256],
		})
		const noneOutcomeDepositPage = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getDepositsByOutcome',
			args: [QuestionOutcome.None, 0n, 1n],
		})

		assert.strictEqual(depositPage.length, 1, 'deposit paging should return only the remaining entries')
		assert.strictEqual(depositPage[0]?.amountAttoRep, reportBond * 2n, 'paged deposit should retain its amount')
		assert.strictEqual(depositPage[0]?.depositor, client.account.address, 'paged deposit should retain its depositor')
		assert.strictEqual(depositPage[0]?.cumulativeAmountAttoRep, deposits[1]?.cumulativeAmountAttoRep, 'contract page should retain the indexed deposit cumulative amount')
		assert.strictEqual(maxCountDepositPage.length, 1, 'max-count deposit paging should return only the remaining entries')
		assert.strictEqual(maxCountDepositPage[0]?.amountAttoRep, reportBond * 2n, 'max-count paged deposit should retain its amount')
		assert.strictEqual(maxCountDepositPage[0]?.depositor, client.account.address, 'max-count paged deposit should retain its depositor')
		assert.strictEqual(noneOutcomeDepositPage.length, 0, 'none-outcome deposit paging should always return an empty page')
	})

	test.each([
		{ name: 'None', outcome: QuestionOutcome.None, depositFirst: true },
		{ name: 'out of enum range', outcome: 4, depositFirst: false },
	])('claimDepositForWinning reverts when outcome is $name', async ({ outcome, depositFirst }) => {
		const { escalationGameAddress: escalationGame, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		if (depositFirst) await depositOnOutcomeViaTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'claimDepositForWinning',
						args: [0n, outcome],
					}),
			),
		)
	})

	test('claimDepositForWinning rejects false-returning REP transfers', async () => {
		const falseReturningRepToken = await deployFalseReturningToken()
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameWithProofPool(falseReturningRepToken)
		// Preserve remaining activation time so this empty continuation is still open.
		await startEscalationFromFork(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, -DAY)
		await initializeSnapshotViaTestQuestionLedger(testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await resumeEscalationFromFork(escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond * 2n)
		await mockWindow.advanceTime(4n * DAY)

		await assert.rejects(claimDepositForWinningViaTestQuestionLedger(testQuestionLedgerAddress, 0n, QuestionOutcome.Yes), /SafeERC20Ops token returned false from ERC20 call/)
	})
})
