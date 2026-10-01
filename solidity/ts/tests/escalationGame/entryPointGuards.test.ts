import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, MAX_UINT256 } from '../../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import {
	deployEscalationGame,
	depositOnOutcome,
	getActivationTime,
	getBalances,
	getEscalationGameDeposits,
	getQuestionResolution,
	readHasReachedNonDecision,
	readNonDecisionState,
	readCanTriggerOwnFork,
	readEscalationGameEndDate,
	readFinalQuestionResolution,
	readNonDecisionTimestamp,
} from '../../testSupport/simulator/utils/contracts/escalationGame'
import { statoblast_EscalationGame_EscalationGame, test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact } from '../../types/contractArtifact'
import { ESCALATION_TIME_LENGTH, FRESH_FORK_RESPONSE_PERIOD, NON_DECISION_STATE_LOCAL } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: deposits and entry-point guards', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		deployEscalationGameTestSecurityPool,
		deployEscalationGameWithProofPool,
		deployFalseReturningToken,
		startEscalation,
		startEscalationFromFork,
		resumeEscalationFromFork,
		depositOnOutcomeViaProofTestSecurityPool,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		claimDepositForWinningViaTestSecurityPool,
		depositOnOutcomeViaTestSecurityPool,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('escrow and settlement entry points cover authorization, argument, lifecycle, and residual-state guards', async () => {
		const deployment = await deployEscalationGameTestSecurityPool()
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
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, 1n, 0n],
			}),
			/execution reverted|Reverted without a reason/i,
		)
		await assert.rejects(recordForkedEscrowForOutcomeViaTestSecurityPool(deployment.testSecurityPoolAddress, client.account.address, QuestionOutcome.None, 1n, 0n), /No outcome/)
		await assert.rejects(recordForkedEscrowForOutcomeViaTestSecurityPool(deployment.testSecurityPoolAddress, zeroAddress, QuestionOutcome.Yes, 1n, 0n), /Depositor is zero/)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, zeroAddress],
			}),
			/Recipient is zero/,
		)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [zeroAddress, client.account.address],
			}),
			/Vault is zero/,
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, client.account.address],
			}),
		)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'exportVaultUnresolvedDeposits',
				args: [client.account.address, client.account.address],
			}),
			/Vault totals exported/,
		)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'drainAllRep',
				args: [client.account.address],
			}),
			/Only pool/,
		)
		await assert.rejects(
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: deployment.testSecurityPoolAddress,
				functionName: 'drainAllRep',
				args: [zeroAddress],
			}),
			/Recipient is zero/,
		)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: deployment.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/Question not final/,
		)

		const emptyFinal = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(emptyFinal.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await resumeEscalationFromFork(emptyFinal.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: emptyFinal.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/No sweepable REP/,
		)

		const unresolved = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaProofTestSecurityPool(unresolved.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const activationTime = await getActivationTime(client, unresolved.escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: unresolved.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/Principal remains/,
		)

		const escrowed = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(escrowed.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(escrowed.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 1n, 1n)
		await resumeEscalationFromFork(escrowed.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escrowed.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/Escrowed REP remains/,
		)
	})

	test('empty started game becomes final only after its exact end timestamp', async () => {
		const { escalationGameAddress: escalationGame } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGame, reportBond, nonDecisionThresholdAttoRep)
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
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, nonDecisionThresholdAttoRep)
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
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.None, reportBond))
	})

	test('depositOnOutcome reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		// Values > 3 are outside enum (0=Invalid,1=Yes,2=No,3=None)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 4 as QuestionOutcome, reportBond))
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 255 as QuestionOutcome, reportBond))
	})

	test('depositOnOutcome rejects tie adjustments that would drop the accepted deposit below the minimum bond', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		await assert.rejects(depositOnOutcomeViaTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond), /below start bond/i)
		const balances = await getBalances(client, escalationGameAddress)
		assert.strictEqual(balances.invalid, reportBond, 'original leading balance should stay untouched')
		assert.strictEqual(balances.yes, 0n, 'tying minimum deposit should not be partially accepted')
	})

	test('getEscalationGameDeposits paginates deposits without adding synthetic entries', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond * 2n)

		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes)
		const depositPage = deposits.slice(1, 6)
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
		assert.strictEqual(depositPage[0]?.depositIndex, 1n, 'paged deposit should retain its index')
		assert.strictEqual(maxCountDepositPage.length, 1, 'max-count deposit paging should return only the remaining entries')
		assert.strictEqual(maxCountDepositPage[0]?.amountAttoRep, reportBond * 2n, 'max-count paged deposit should retain its amount')
		assert.strictEqual(maxCountDepositPage[0]?.depositor, client.account.address, 'max-count paged deposit should retain its depositor')
		assert.strictEqual(noneOutcomeDepositPage.length, 0, 'none-outcome deposit paging should always return an empty page')
	})

	test.each([
		{ name: 'None', outcome: QuestionOutcome.None, depositFirst: true },
		{ name: 'out of enum range', outcome: 4, depositFirst: false },
	])('claimDepositForWinning reverts when outcome is $name', async ({ outcome, depositFirst }) => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThresholdAttoRep)
		if (depositFirst) await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond)
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
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool(falseReturningRepToken)
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(4n * DAY)

		await assert.rejects(claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 0n, QuestionOutcome.Yes), /SafeERC20Ops token returned false from ERC20 call/)
	})

	test('local unresolved export rejects none outcome', async () => {
		const { testSecurityPoolAddress } = await deployEscalationGameTestSecurityPool()
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.sendTransaction({
					to: testSecurityPoolAddress,
					data: encodeFunctionData({
						abi: escalationGameProofTestPoolArtifact.abi,
						functionName: 'exportLocalUnresolvedDeposit',
						args: [0n, QuestionOutcome.None],
					}),
					gas: 10_000_000n,
				}),
			),
			/No outcome/,
		)
	})
})
