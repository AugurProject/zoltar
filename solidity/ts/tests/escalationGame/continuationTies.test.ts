import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { BURN_ADDRESS, DAY } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import {
	getEscalationGameOutcomeState,
	getEscrowedRepByVault,
	getQuestionResolution,
	getTotalEscrowedRep,
	readHasReachedNonDecision,
	readNonDecisionState,
	readCanTriggerOwnFork,
	readNonDecisionTimestamp,
	readCarryPeaks,
	readCarryLeafCount,
	readCarryTotal,
	readIsForkCarryFundingComplete,
	readNullifierRoot,
	readForkedEscrowByVaultAndOutcome,
} from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame, test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact } from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { SparseNullifierTree } from '../carryProofHelpers'
import { ESCALATION_TIME_LENGTH, NON_DECISION_STATE_NONE, NON_DECISION_STATE_LOCAL, NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: fork continuation funding and inherited ties', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		startEscalation,
		startEscalationFromFork,
		resumeEscalationFromFork,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestSecurityPool,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		applyTruthAuctionHaircutViaTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		createCarryProof,
		initializeSnapshotWithResolutionBalancesViaTestSecurityPool,
		initializeSnapshotFromSourceViaTestSecurityPool,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('forked escrow events expose updated escrow totals and outcome balance', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, reportBond, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const recordHash = await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, reportBond],
			}),
		)
		const receipt = await client.waitForTransactionReceipt({ hash: recordHash })
		const decodedLogs = receipt.logs.map(log => {
			try {
				return decodeEventLog({
					abi: statoblast_EscalationGame_EscalationGame.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		const escrowRecordedLog = decodedLogs.find(log => log?.eventName === 'ForkedEscrowRecorded')
		if (escrowRecordedLog === undefined) throw new Error('missing ForkedEscrowRecorded log')

		const yesState = await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const vaultEscrow = await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address)
		const totalEscrow = await getTotalEscrowedRep(client, child.escalationGameAddress)
		assert.strictEqual(escrowRecordedLog.args.depositor, client.account.address, 'forked escrow log should identify the vault')
		assert.strictEqual(escrowRecordedLog.args.outcome, BigInt(QuestionOutcome.Yes), 'forked escrow log should identify the outcome')
		assert.strictEqual(escrowRecordedLog.args.sourcePrincipalTotalAttoRep, reportBond, 'forked escrow log should expose the new source principal total')
		assert.strictEqual(escrowRecordedLog.args.childRepTotalAttoRep, reportBond, 'forked escrow log should expose the new child REP total')
		assert.strictEqual(escrowRecordedLog.args.disputeStakedRepByVaultAttoRep, vaultEscrow, 'forked escrow log should expose the updated vault escrow')
		assert.strictEqual(escrowRecordedLog.args.totalDisputeStakedAttoRep, totalEscrow, 'forked escrow log should expose the updated total escrow')
		assert.strictEqual(escrowRecordedLog.args.outcomeBalanceAttoRep, yesState.balanceAttoRep, 'forked escrow log should expose the updated outcome balance')

		const exportHash = await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcomeWithoutTransfer',
				args: [client.account.address],
			}),
		)
		const exportReceipt = await client.waitForTransactionReceipt({ hash: exportHash })
		const vaultEscrowLog = exportReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'VaultEscrowUpdated')
		if (vaultEscrowLog === undefined) throw new Error('missing VaultEscrowUpdated log')
		const vaultEscrowAfterExport = await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address)
		const totalEscrowAfterExport = await getTotalEscrowedRep(client, child.escalationGameAddress)
		assert.strictEqual(vaultEscrowLog.args.vault, client.account.address, 'vault escrow log should identify the vault')
		assert.strictEqual(vaultEscrowLog.args.disputeStakedRepByVaultAttoRep, vaultEscrowAfterExport, 'vault escrow log should expose the updated vault escrow')
		assert.strictEqual(vaultEscrowLog.args.totalDisputeStakedAttoRep, totalEscrowAfterExport, 'vault escrow log should expose the updated total escrow')
	})

	test('fork carry funding completeness requires aggregate REP backing at a one-to-one ratio', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, 3n * reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const yesState = await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balanceAttoRep, 3n * reportBond, 'preserved continuation balances should stay at the parent live principal')
		assert.strictEqual(yesState.inheritedUnresolvedTotalAttoRep, 3n * reportBond, 'test setup should preserve the inherited carried principal in source units')
		assert.strictEqual(await readIsForkCarryFundingComplete(client, child.escalationGameAddress), true, 'one-to-one aggregate REP backing should fully fund the carry without vault records')
	})

	test('zero-live-balance carry snapshots require aggregate REP rather than vault escrow', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, 0n, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		assert.strictEqual(await readIsForkCarryFundingComplete(client, child.escalationGameAddress), false, 'an unfunded inherited carry should be incomplete')
		await assert.rejects(resumeEscalationFromFork(child.escalationGameAddress), /Fork carry underfunded/)

		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await fundEscalationGame(child.escalationGameAddress, parentCarryTotal)
		assert.strictEqual(await readIsForkCarryFundingComplete(client, child.escalationGameAddress), true, 'one-to-one aggregate REP should complete funding without a vault record')
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
	})

	test('preserved continuation balances do not rebase when forked escrow arrives after the live balance already shrank', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 0n], [0n, 3n * reportBond, 0n], [0n, reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const yesBalanceBeforeEscrow = (await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep
		assert.strictEqual(yesBalanceBeforeEscrow, reportBond, 'test setup should model a preserved live balance that is already smaller than inherited unresolved total')

		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond, 3n)

		const yesState = await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(yesState.balanceAttoRep, reportBond, 'forked escrow funding should not mutate a preserved live continuation balance')
		assert.deepStrictEqual(await readForkedEscrowByVaultAndOutcome(client, child.escalationGameAddress, client.account.address, QuestionOutcome.Yes), [3n * reportBond, 0n, 3n, 0n], 'funding progress should still track the inherited principal separately from the preserved live balance')
	})

	test('fork continuation snapshot preserves tied parent leaders below non-decision', async () => {
		const child = await deployEscalationGameWithProofPool()
		const tiedBalance = 2n * reportBond
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 1n, 1n], [0n, tiedBalance, tiedBalance], [0n, tiedBalance, tiedBalance], [zeroHash(), zeroHash(), zeroHash()])

		assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep, tiedBalance, 'the yes balance should match the tied parent snapshot')
		assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.No)).balanceAttoRep, tiedBalance, 'the no balance should match the tied parent snapshot')
		assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.None, 'the inherited tie should remain unresolved')
		assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), NON_DECISION_STATE_NONE, 'a below-threshold inherited tie should remain an ordinary live continuation')
		assert.strictEqual(await readCanTriggerOwnFork(client, child.escalationGameAddress), false, 'a below-threshold inherited tie should not authorize a fork')
	})

	test('fork continuation records an inherited threshold tie without fabricating a local timestamp', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const snapshotHash = await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
			[0n, 1n, 1n],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[zeroHash(), zeroHash(), zeroHash()],
		)

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

	for (const retainedBacking of [2n * nonDecisionThresholdAttoRep, 2n * nonDecisionThresholdAttoRep - 1n, nonDecisionThresholdAttoRep / 10n, 1n]) {
		test(`auction reconciles an inherited threshold tie with ${retainedBacking} retained backing`, async () => {
			const child = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH)
			await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
				child.testSecurityPoolAddress,
				[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
				[0n, 1n, 1n],
				[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
				[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
				[zeroHash(), zeroHash(), zeroHash()],
			)
			await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, 2n * nonDecisionThresholdAttoRep - retainedBacking)
			const remainsFull = retainedBacking === 2n * nonDecisionThresholdAttoRep
			assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), remainsFull ? NON_DECISION_STATE_INHERITED_THRESHOLD_TIE : NON_DECISION_STATE_NONE, 'only a structurally full inherited tie may retain the fork commitment')
			assert.strictEqual(await readCanTriggerOwnFork(client, child.escalationGameAddress), remainsFull)
			assert.strictEqual(await readNonDecisionTimestamp(client, child.escalationGameAddress), 0n)
			assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep, retainedBacking / 2n)
			assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)).inheritedUnresolvedTotalAttoRep, retainedBacking / 2n, 'effective inherited principal must retain the same auction fraction')
			await resumeEscalationFromFork(child.escalationGameAddress)
			if (remainsFull) {
				await assert.rejects(depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond), /revert/i)
				return
			}
			const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'forkResumedAt' })
			const endDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'getEscalationGameEndDate' })
			assert.strictEqual(endDate, resumedAt + 3n * DAY, 'the rebased continuation must retain a fresh response window')
			if (retainedBacking === 1n) {
				await mockWindow.setTime(endDate + 1n)
				assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Invalid, 'zero-rounded balances resolve without new funding')
				return
			}
			const preview = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.Yes, reportBond] })
			await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
			assert.strictEqual((await getEscalationGameOutcomeState(client, child.escalationGameAddress, QuestionOutcome.Yes)).balanceAttoRep, preview[1], 'execution must admit the previewed deposit')
			await mockWindow.setTime(endDate + ESCALATION_TIME_LENGTH)
			assert.strictEqual(await getQuestionResolution(client, child.escalationGameAddress), QuestionOutcome.Yes, 'a funded report must break the inherited tie')
		})
	}

	test('a reopened inherited tie carries retention and authenticated payouts through another continuation', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, nonDecisionThresholdAttoRep)
		let source = parent.escalationGameAddress
		let descendant = parent
		for (let generation = 0; generation < 2; generation += 1) {
			descendant = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(descendant.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await initializeSnapshotFromSourceViaTestSecurityPool(
				descendant.testSecurityPoolAddress,
				source,
				zeroHash(),
				[zeroPeakArray(), await readCarryPeaks(client, source, QuestionOutcome.Yes), await readCarryPeaks(client, source, QuestionOutcome.No)],
				[0n, 1n, 1n],
				[0n, await readCarryTotal(client, source, QuestionOutcome.Yes), await readCarryTotal(client, source, QuestionOutcome.No)],
				[zeroHash(), await readNullifierRoot(client, source, QuestionOutcome.Yes), await readNullifierRoot(client, source, QuestionOutcome.No)],
			)
			const backing = await getERC20Balance(client, getRepTokenAddress(0n), descendant.escalationGameAddress)
			await applyTruthAuctionHaircutViaTestSecurityPool(descendant.testSecurityPoolAddress, backing / 2n)
			await resumeEscalationFromFork(descendant.escalationGameAddress)
			assert.strictEqual(await readNonDecisionState(client, descendant.escalationGameAddress), NON_DECISION_STATE_NONE)
			assert.strictEqual(await readCanTriggerOwnFork(client, descendant.escalationGameAddress), false)
			source = descendant.escalationGameAddress
		}
		assert.strictEqual(await readNonDecisionState(client, parent.escalationGameAddress), NON_DECISION_STATE_LOCAL, 'descendant auctions must preserve the original local transition')
		await depositOnOutcomeViaProofTestSecurityPool(descendant.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const endDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: descendant.escalationGameAddress, functionName: 'getEscalationGameEndDate' })
		await mockWindow.setTime(endDate + 1n)
		assert.strictEqual(await getQuestionResolution(client, descendant.escalationGameAddress), QuestionOutcome.Yes)
		const backingBefore = await getERC20Balance(client, getRepTokenAddress(0n), descendant.escalationGameAddress)
		const walletBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		const burnedBefore = await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n), 1n)
		await withdrawDepositViaProofTestSecurityPool(descendant.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const paid = (await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - walletBefore
		const burned = (await getERC20Balance(client, getRepTokenAddress(0n), addressString(BURN_ADDRESS))) - burnedBefore
		assert.ok(paid > 0n, 'the original depositor must receive a funded retained payout')
		assert.strictEqual(backingBefore - (await getERC20Balance(client, getRepTokenAddress(0n), descendant.escalationGameAddress)), paid + burned, 'payout plus deterrence burn must conserve backing')
		assert.strictEqual(await readCarryTotal(client, descendant.escalationGameAddress, QuestionOutcome.Yes), reportBond, 'only the fresh local claim remains after the ancestor claim is consumed')
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(descendant.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /revert/i, 'reopening must not permit duplicate ancestor claims')
	})

	test('a fixed-outcome continuation settles an inherited threshold tie instead of authorizing another fork', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
			[0n, 1n, 1n],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[0n, nonDecisionThresholdAttoRep, nonDecisionThresholdAttoRep],
			[zeroHash(), zeroHash(), zeroHash()],
		)

		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, nonDecisionThresholdAttoRep)
		assert.strictEqual(await readNonDecisionState(client, child.escalationGameAddress), NON_DECISION_STATE_INHERITED_THRESHOLD_TIE, 'the fixed child should retain the inherited threshold-tie lifecycle state')
		await assert.rejects(depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond), /revert/i, 'a haircut must not reopen fixed-outcome reporting')
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
