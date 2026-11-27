import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { BURN_ADDRESS } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getEscalationGameOutcomeState, getQuestionResolution, readHasReachedNonDecision, readNonDecisionState, readCanTriggerOwnFork, readNonDecisionTimestamp, readCarryPeaks, readCarryTotal, readIsForkCarryFundingComplete } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { FRESH_FORK_RESPONSE_PERIOD, ESCALATION_TIME_LENGTH, NON_DECISION_STATE_NONE, NON_DECISION_STATE_LOCAL, NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: fork continuation funding and inherited ties', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		startEscalationFromFork,
		resumeEscalationFromFork,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestQuestionLedger,
		withdrawDepositViaProofTestQuestionLedger,
		createCarryProof,
		initializeSnapshotWithResolutionBalancesViaTestQuestionLedger,
		initializeSnapshotFromSourceViaTestQuestionLedger,
		deployEscalationGameTestQuestionLedger,
		deployForkContinuationEscalationGame,
		readOutcomeCarrySnapshot,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('fork carry funding completeness requires aggregate REP backing at a one-to-one ratio', async () => {
		const child = await deployForkContinuationEscalationGame(0n, 3n * reportBond)
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, 3n * reportBond, 0n])

		const yesState = await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balanceAttoRep, 3n * reportBond, 'preserved continuation balances should stay at the parent live principal')
		assert.strictEqual(yesState.inheritedUnresolvedTotalAttoRep, 3n * reportBond, 'test setup should preserve the inherited carried principal in source units')
		assert.strictEqual(await readIsForkCarryFundingComplete(client, child.escalationGameAddress), true, 'one-to-one aggregate REP backing should fully fund the carry without vault records')
	})

	test('zero-live-balance carry snapshots require aggregate REP rather than vault escrow', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD, parentCarryTotal)
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, 0n, 0n])
		assert.strictEqual(await readIsForkCarryFundingComplete(client, child.escalationGameAddress), false, 'an unfunded inherited carry should be incomplete')
		await assert.rejects(resumeEscalationFromFork(child.escalationGameAddress), /Fork carry underfunded/)

		await assert.rejects(depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond), /Invalid deposit preview/)
		await fundEscalationGame(child.escalationGameAddress, parentCarryTotal)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		assert.strictEqual(await readIsForkCarryFundingComplete(client, child.escalationGameAddress), true, 'one-to-one aggregate REP should complete funding without a vault record')
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
	})

	test('fork continuation snapshot preserves tied parent leaders below non-decision', async () => {
		const child = await deployEscalationGameWithProofPool()
		const tiedBalance = 2n * reportBond
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, tiedBalance, tiedBalance], [0n, tiedBalance, tiedBalance])

		assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep, tiedBalance, 'the yes balance should match the tied parent snapshot')
		assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.No)).balanceAttoRep, tiedBalance, 'the no balance should match the tied parent snapshot')
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'the inherited tie should remain unresolved')
		assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), NON_DECISION_STATE_NONE, 'a below-threshold inherited tie should remain an ordinary live continuation')
		assert.strictEqual(await readCanTriggerOwnFork(client, child.escalationGameAddress), false, 'a below-threshold inherited tie should not authorize a fork')
	})

	test('fork continuation records an inherited threshold tie without fabricating a local timestamp', async () => {
		const child = await deployForkContinuationEscalationGame()
		const snapshotHash = await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep], [0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep])

		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'threshold-tied carried non-decision states should remain unresolved')
		assert.strictEqual(await readHasReachedNonDecision(client, child.escalationGameAddress), true, 'the inherited balances should satisfy the structural threshold predicate')
		assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, 'the lifecycle state should identify an inherited threshold tie')
		assert.strictEqual(await readNonDecisionTimestamp(client, child.escalationGameAddress), 0n, 'snapshot initialization should not fabricate a local non-decision timestamp')
		assert.strictEqual(await readCanTriggerOwnFork(client, child.escalationGameAddress), true, 'an inherited threshold tie without a fixed outcome should authorize its own fork')
		await assert.rejects(
			client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: child.escalationGameAddress,
				functionName: 'previewDepositOnOutcome',
				args: [QuestionOutcome.Invalid, reportBond],
			}),
			/Invalid deposit preview/,
			'an inherited threshold tie should close the deposit path without requiring a synthetic local deposit',
		)
		const snapshotReceipt = await client.getTransactionReceipt({ hash: snapshotHash })
		const snapshotEventNames = snapshotReceipt.logs
			.filter(log => log.address.toLowerCase() === child.escalationGameAddress.toLowerCase())
			.flatMap(log => {
				try {
					return [decodeEventLog({ abi: statoblast_EscalationGame_EscalationGame.abi, data: log.data, topics: log.topics }).eventName]
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return []
				}
			})
		assert.strictEqual(snapshotEventNames.filter(eventName => eventName === 'InheritedThresholdTie').length, 1, 'snapshot initialization should emit one inherited-threshold-tie lifecycle event')
	})

	for (const donation of [0n, 1n, 1_000n * reportBond]) {
		test(`donating ${donation} REP cannot change an inherited threshold tie`, async () => {
			const child = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH)
			await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep], [0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep])
			if (donation !== 0n) await fundEscalationGame(child.escalationGameAddress, donation)
			assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE)
			assert.strictEqual(await readCanTriggerOwnFork(client, child.escalationGameAddress), true)
			assert.strictEqual(await readNonDecisionTimestamp(client, child.escalationGameAddress), 0n)
			for (const outcome of [QuestionOutcome.Yes, QuestionOutcome.No]) {
				const state = await getEscalationGameOutcomeState(client, child.escalationGameAddress, outcome)
				assert.strictEqual(state.balanceAttoRep, nonDecisionThresholdAttoRep)
				assert.strictEqual(state.inheritedUnresolvedTotalAttoRep, nonDecisionThresholdAttoRep)
			}
			await resumeEscalationFromFork(child.escalationGameAddress)
			await assert.rejects(depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond), /revert/i)
		})
	}

	test('an inherited tie survives an unrelated continuation and pays authenticated claims in a fixed branch', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, nonDecisionThresholdAttoRep)
		let source = parent.escalationGameAddress
		let descendant = parent
		for (let generation = 0; generation < 2; generation += 1) {
			descendant = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(descendant.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n, generation === 1 ? QuestionOutcome.Yes : QuestionOutcome.None, 2n * nonDecisionThresholdAttoRep)
			await initializeSnapshotFromSourceViaTestQuestionLedger(
				descendant.testQuestionLedgerAddress,
				source,
				zeroHash(),
				[zeroPeakArray(), await readCarryPeaks(client, source, QuestionOutcome.Yes), await readCarryPeaks(client, source, QuestionOutcome.No)],
				[0n, 1n, 1n],
				[0n, await readCarryTotal(client, source, QuestionOutcome.Yes), await readCarryTotal(client, source, QuestionOutcome.No)],
			)
			await resumeEscalationFromFork(descendant.escalationGameAddress)
			assert.strictEqual(await readNonDecisionState(client, descendant.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE)
			assert.strictEqual(await readCanTriggerOwnFork(client, descendant.escalationGameAddress), generation === 0)
			source = descendant.escalationGameAddress
		}
		assert.strictEqual(await readNonDecisionState(client, parent.escalationGameAddress), NON_DECISION_STATE_LOCAL, 'descendant continuations must preserve the original local transition')
		await assert.rejects(depositOnOutcomeViaProofTestQuestionLedger(descendant.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond), /revert/i)
		const endDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: descendant.escalationGameAddress, functionName: 'getEscalationGameEndDate' })
		await mockWindow.setTime(endDate + 1n)
		assert.strictEqual(await getQuestionResolution(client, descendant.escalationGameAddress), QuestionOutcome.Yes)
		const readBacking = async () => await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: descendant.escalationGameAddress, functionName: 'getDisputeBackingAttoRep' })
		const backingBefore = await readBacking()
		const walletBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		const burnedBefore = await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], 1n)
		await withdrawDepositViaProofTestQuestionLedger(descendant.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		const paid = (await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - walletBefore
		const burned = (await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))) - burnedBefore
		assert.ok(paid > 0n, 'the original depositor must receive a funded payout')
		assert.strictEqual(backingBefore - (await readBacking()), paid + burned, 'payout plus deterrence burn must conserve backing')
		assert.strictEqual(await readCarryTotal(client, descendant.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the ancestor claim consumes the complete winning liability')
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(descendant.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /revert/i, 'continuation must not permit duplicate ancestor claims')
	})

	test('a fixed-outcome continuation settles an inherited threshold tie instead of authorizing another fork', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep], [0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep])

		assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, 'the fixed child should retain the inherited threshold-tie lifecycle state')
		await assert.rejects(depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond), /revert/i, 'a fixed-outcome continuation must not reopen reporting')
		assert.strictEqual(await readCanTriggerOwnFork(client, child.escalationGameAddress), false, 'a fixed child should continue to its selected outcome instead of forking again')
		await resumeEscalationFromFork(child.escalationGameAddress)
		const continuationEndDate = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: child.escalationGameAddress,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(continuationEndDate + 1n)
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Yes, 'the fixed branch should resolve normally after its continuation deadline')
	})
})
