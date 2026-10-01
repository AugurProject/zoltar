import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getEscrowedRepByVault, readEscalationGameEndDate, readCarryPeaks, readCarryRoot, readCarryLeafCount, readCarryTotal, readNullifierRoot, readForkedEscrowByVaultAndOutcome } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import {
	statoblast_EscalationGame_EscalationGame,
	ReputationToken_ReputationToken,
	test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as escalationGameProofTestPoolArtifact,
	test_statoblast_EscalationGameForkerHarness_EscalationGameForkerHarness as escalationGameForkerHarnessArtifact,
} from '../../types/contractArtifact'
import { SparseNullifierTree } from '../carryProofHelpers'
import { ESCALATION_TIME_LENGTH, FRESH_FORK_RESPONSE_PERIOD, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: carried proofs and forked escrow', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameTestSecurityPool,
		deployEscalationGameWithProofPool,
		deployEscalationGameForkerHarness,
		startEscalation,
		startEscalationFromFork,
		resumeEscalationFromFork,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestSecurityPool,
		traceForkedEscrowByVaultAndOutcome,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		applyTruthAuctionHaircutViaTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		readCarryLeafHash,
		createCarryProof,
		initializeSnapshotViaTestSecurityPool,
		initializeSnapshotWithResolutionBalancesViaTestSecurityPool,
		initializeSnapshotFromSourceViaTestSecurityPool,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('carried proof pays its authenticated depositor without consulting vault escrow', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - walletBalanceBefore, reportBond, 'the proof beneficiary should receive the aggregate-backed REP')
	})

	test('carried proof needs no per-vault escrow record', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'a proof-only claim should consume the winning liability')
	})

	test('aggregate-funded fork carry pays winning proofs without vault migration and retires losing principal', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[2]), QuestionOutcome.Invalid, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[1]), QuestionOutcome.No, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentInvalidNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentInvalidTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, ESCALATION_TIME_LENGTH, QuestionOutcome.Yes)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[parentInvalidPeaks, parentYesPeaks, parentNoPeaks],
			[1n, 1n, 1n],
			[parentInvalidTotal, parentYesTotal, parentNoTotal],
			[parentInvalidTotal, parentYesTotal, parentNoTotal],
			[parentInvalidNullifierRoot, parentYesNullifierRoot, parentNoNullifierRoot],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await mockWindow.advanceTime(FRESH_FORK_RESPONSE_PERIOD + 1n)

		const winnerBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		const winningProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n), 3n)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, winningProof)

		assert.ok((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) > winnerBalanceBefore, 'the authenticated winner should be paid from aggregate child REP')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the winning proof should consume its liability')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.No), 0n, 'the losing outcome should terminate without per-leaf proofs')

		const residualRep = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		assert.ok(residualRep > 0n, 'three nonzero outcome buckets should leave terminal losing carry after the winner is paid')
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: child.escalationGameAddress,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
		)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress), 0n, 'terminal losing carry should become sweepable after every logical liability is zero')
	})

	for (const retentionDivisor of [1n, 2n]) {
		test(`carried claims reserve unpaid burns against actual tokens with retention 1/${retentionDivisor}`, async () => {
			const parent = await deployEscalationGameTestSecurityPool()
			await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 100n * reportBond)
			await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 20n * reportBond)
			const child = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await initializeSnapshotFromSourceViaTestSecurityPool(
				child.testSecurityPoolAddress,
				parent.escalationGameAddress,
				zeroHash(),
				[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.No)],
				[0n, 1n, 1n],
				[0n, 100n * reportBond, 20n * reportBond],
				[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.No)],
			)
			if (retentionDivisor === 2n) await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, 60n * reportBond)
			await resumeEscalationFromFork(child.escalationGameAddress)
			await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, (300n * reportBond) / retentionDivisor)
			await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, (300n * reportBond) / retentionDivisor)
			await mockWindow.setTime((await readEscalationGameEndDate(client, child.escalationGameAddress)) + DAY)
			await writeContractAndWait(client, () => client.writeContract({ abi: escalationGameProofTestPoolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'drainAllRep', args: [client.account.address] }))
			await fundEscalationGame(child.escalationGameAddress, (148n * reportBond) / retentionDivisor)
			const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
			const rootBefore = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
			const walletBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
			await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Escrow low/)
			assert.strictEqual(await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes), rootBefore, 'failed funding check must not consume the proof')
			assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), client.account.address), walletBefore, 'failed funding check must not pay the winner')
			await fundEscalationGame(child.escalationGameAddress, (32n * reportBond) / retentionDivisor)
			await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
			assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress), 0n, 'payout plus burn consumes the funded tokens')
			assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'totalDisputeStakedAttoRep' }), (600n * reportBond) / retentionDivisor, 'token expenditure must preserve local principal accounting')
		})
	}

	test('losing carried proofs are unnecessary and cannot drain aggregate backing', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)
		const parentYesLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [0n, 0n, 1n], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await fundEscalationGame(child.escalationGameAddress, parentYesCarryTotal + parentNoCarryTotal - 1n)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Not winning outcome/)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), client.account.address), walletBalanceBefore, 'a losing proof must not transfer REP')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the losing inherited outcome should already be terminal')
	})

	test('forked-escrow winner payout applies the inherited reward schedule in child REP', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[1]), QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, addressString(TEST_ADDRESSES[2]), QuestionOutcome.No, reportBond)
		const parentYesLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.No)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNoPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [await readCarryLeafHash(parent.escalationGameAddress, 2n)], new SparseNullifierTree().getProof(0n))
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, proof.amountAttoRep, proof.amountAttoRep],
			}),
		)

		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		assert.ok(walletBalanceAfter - walletBalanceBefore > proof.amountAttoRep, 'forked winning proof should receive reward upside, not only escrow principal')
	})

	test('recordForkedEscrowForOutcome preserves child REP backing when an owner source-principal share rounds to zero', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await fundEscalationGame(child.escalationGameAddress, 1n)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 0n, 1n)
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 1n)
		const balanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, client.account.address],
			}),
		)
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - balanceBefore, 1n)
	})

	test('fork continuation inherits claim commitments without copying payout bundles', async () => {
		const source = await deployEscalationGameWithProofPool()
		await startEscalation(source.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		for (let ownerIndex = 1; ownerIndex <= 9; ownerIndex++) {
			await depositOnOutcomeViaProofTestSecurityPool(source.testSecurityPoolAddress, addressString(0x0000000000030000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}
		const sourcePeaks = await readCarryPeaks(client, source.escalationGameAddress, QuestionOutcome.Yes)
		const sourceLeafCount = await readCarryLeafCount(client, source.escalationGameAddress, QuestionOutcome.Yes)
		const sourceCarryTotal = await readCarryTotal(client, source.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			source.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), sourcePeaks, zeroPeakArray()],
			[0n, sourceLeafCount, 0n],
			[0n, sourceCarryTotal, 0n],
			[zeroHash(), await readNullifierRoot(client, source.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		assert.strictEqual(await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes), sourceLeafCount)
		assert.strictEqual(await readCarryRoot(client, child.escalationGameAddress, QuestionOutcome.Yes), await readCarryRoot(client, source.escalationGameAddress, QuestionOutcome.Yes))
		assert.ok((await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'forkResumedAt', args: [] })) > 0n, 'continuation should resume in one call regardless of reporter count')
	})

	test('sybil reporters cannot exhaust a global payout-claim cap', async () => {
		const source = await deployEscalationGameWithProofPool()
		await startEscalation(source.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		for (let ownerIndex = 1; ownerIndex <= 65; ownerIndex++) {
			await depositOnOutcomeViaProofTestSecurityPool(source.testSecurityPoolAddress, addressString(0x0000000000040000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}
		assert.strictEqual(await readCarryLeafCount(client, source.escalationGameAddress, QuestionOutcome.Yes), 65n)
	})

	test('an inherited commitment preserves child-local reporting capacity', async () => {
		const source = await deployEscalationGameWithProofPool()
		await startEscalation(source.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		for (let ownerIndex = 1; ownerIndex <= 65; ownerIndex++) {
			await depositOnOutcomeViaProofTestSecurityPool(source.testSecurityPoolAddress, addressString(0x0000000000050000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			source.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, source.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, 65n, 0n],
			[0n, 65n * reportBond, 0n],
			[zeroHash(), await readNullifierRoot(client, source.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 66n * reportBond)
		await resumeEscalationFromFork(child.escalationGameAddress)

		assert.strictEqual(await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.No), 1n)
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 66n * reportBond)
	})

	test('residual sweep rejects while forked escrow remains unsettled', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [0n, reportBond, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, reportBond],
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, async () =>
				client.writeContract({
					abi: statoblast_EscalationGame_EscalationGame.abi,
					address: child.escalationGameAddress,
					functionName: 'sweepResidualRepToSecurityPool',
					args: [],
				}),
			),
			/Escrowed REP remains/,
		)
	})

	test('forked escrow export preserves original outcome buckets and cannot export twice', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const receiver = addressString(TEST_ADDRESSES[1])
		const repToken = getRepTokenAddress(0n)
		const yesSourcePrincipal = 10n * reportBond
		const yesChildRep = 4n * reportBond
		const noSourcePrincipal = 20n * reportBond
		const noChildRep = 6n * reportBond
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: repToken,
				functionName: 'transfer',
				args: [child.escalationGameAddress, yesChildRep + noChildRep],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, yesSourcePrincipal, yesChildRep],
			}),
		)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.No, noSourcePrincipal, noChildRep],
			}),
		)

		const receiverBalanceBefore = await getERC20Balance(client, repToken, receiver)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfter = await getERC20Balance(client, repToken, receiver)
		const yesEscrow = await readForkedEscrowByVaultAndOutcome(client, child.escalationGameAddress, client.account.address, QuestionOutcome.Yes)
		const noEscrow = await readForkedEscrowByVaultAndOutcome(client, child.escalationGameAddress, client.account.address, QuestionOutcome.No)
		await traceForkedEscrowByVaultAndOutcome(child.escalationGameAddress, client.account.address, QuestionOutcome.Yes)
		assert.strictEqual(receiverBalanceAfter - receiverBalanceBefore, yesChildRep + noChildRep, 'export should transfer only child REP backing')
		assert.deepStrictEqual(yesEscrow, [yesSourcePrincipal, yesSourcePrincipal, yesChildRep, yesChildRep], 'yes forked escrow should be marked fully exported without affecting no')
		assert.deepStrictEqual(noEscrow, [noSourcePrincipal, noSourcePrincipal, noChildRep, noChildRep], 'no forked escrow should be marked fully exported without affecting yes')
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 0n, 'export should clear the vault escrow lock')

		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: child.testSecurityPoolAddress,
				functionName: 'exportForkedEscrowByOutcome',
				args: [client.account.address, receiver],
			}),
		)
		const receiverBalanceAfterSecondExport = await getERC20Balance(client, repToken, receiver)
		assert.strictEqual(receiverBalanceAfterSecondExport, receiverBalanceAfter, 'already-exported forked escrow should not transfer twice')
	})

	test('source-only forked escrow can migrate into the next continuation without child REP backing', async () => {
		const forkerHarnessAddress = await deployEscalationGameForkerHarness()
		const parent = await deployEscalationGameWithProofPool(getRepTokenAddress(0n), forkerHarnessAddress)
		const child = await deployEscalationGameWithProofPool(getRepTokenAddress(0n), forkerHarnessAddress)
		await startEscalationFromFork(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameProofTestPoolArtifact.abi,
				address: parent.testSecurityPoolAddress,
				functionName: 'recordForkedEscrowForOutcome',
				args: [client.account.address, QuestionOutcome.Yes, reportBond, 0n],
			}),
		)

		const exportResult = await client.simulateContract({
			abi: escalationGameForkerHarnessArtifact.abi,
			address: forkerHarnessAddress,
			functionName: 'migrateForkedEscrowWithoutTransferForTest',
			args: [parent.escalationGameAddress, child.escalationGameAddress, client.account.address],
		})
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: escalationGameForkerHarnessArtifact.abi,
				address: forkerHarnessAddress,
				functionName: 'migrateForkedEscrowWithoutTransferForTest',
				args: [parent.escalationGameAddress, child.escalationGameAddress, client.account.address],
			}),
		)

		assert.deepStrictEqual(exportResult.result[0], [0n, reportBond, 0n], 'source-only forked escrow should still export its original principal bucket')
		assert.deepStrictEqual(exportResult.result[1], [0n, 0n, 0n], 'source-only forked escrow should not fabricate child REP backing during export')
		assert.deepStrictEqual(await readForkedEscrowByVaultAndOutcome(client, child.escalationGameAddress, client.account.address, QuestionOutcome.Yes), [reportBond, 0n, 0n, 0n], 'the next continuation should retain the migrated source-only escrow instead of dropping it')
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 0n, 'source-only migration should not create a new child REP escrow lock')
	})
})
