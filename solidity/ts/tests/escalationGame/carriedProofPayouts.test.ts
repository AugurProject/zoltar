import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getEscrowedRepByVault, readEscalationGameEndDate, readCarryPeaks, readCarryRoot, readCarryLeafCount, readCarryTotal, readNullifierRoot, drainEscalationGameRepForTest } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { SparseNullifierTree } from '../carryProofHelpers'
import { ESCALATION_TIME_LENGTH, FRESH_FORK_RESPONSE_PERIOD, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: carried proof payouts', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameTestQuestionLedger,
		deployEscalationGameWithProofPool,
		startEscalationFromFork,
		resumeEscalationFromFork,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestQuestionLedger,
		withdrawDepositViaProofTestQuestionLedger,
		readCarryLeafHash,
		createCarryProof,
		initializeSnapshotViaTestQuestionLedger,
		initializeSnapshotWithResolutionBalancesViaTestQuestionLedger,
		initializeSnapshotFromSourceViaTestQuestionLedger,
		deployForkContinuationEscalationGame,
		readOutcomeCarrySnapshot,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('carried proof pays its authenticated depositor without consulting vault escrow', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal, nullifierRoot: parentNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - walletBalanceBefore, reportBond, 'the proof beneficiary should receive the aggregate-backed REP')
	})

	test('carried proof needs no per-vault escrow record', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal, nullifierRoot: parentNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'a proof-only claim should consume the winning liability')
	})

	test('aggregate-funded fork carry pays winning proofs without vault migration and retires losing principal', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, addressString(TEST_ADDRESSES[2]), QuestionOutcome.Invalid, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, addressString(TEST_ADDRESSES[1]), QuestionOutcome.No, 2n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

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
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
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
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, winningProof)

		assert.ok((await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) > winnerBalanceBefore, 'the authenticated winner should be paid from aggregate child REP')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the winning proof should consume its liability')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.No), 0n, 'the losing outcome should terminate without per-leaf proofs')

		const residualRep = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		assert.ok(residualRep > 0n, 'three nonzero outcome buckets should leave terminal losing carry after the winner is paid')
		await writeContractAndWait(client, async () =>
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: child.escalationGameAddress,
				functionName: 'sweepResidualRepToQuestionLedger',
				args: [],
			}),
		)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress), 0n, 'terminal losing carry should become sweepable after every logical liability is zero')
	})

	test('carried claims reserve unpaid burns against actual tokens', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 100n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 20n * reportBond)
		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotFromSourceViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.No)],
			[0n, 1n, 1n],
			[0n, 100n * reportBond, 20n * reportBond],
			[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.No)],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 300n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 300n * reportBond)
		await mockWindow.setTime((await readEscalationGameEndDate(client, child.escalationGameAddress)) + DAY)
		await drainEscalationGameRepForTest(mockWindow, getRepTokenAddress(0n), child.escalationGameAddress, client.account.address)
		await fundEscalationGame(child.escalationGameAddress, 148n * reportBond)
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const rootBefore = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const walletBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Escrow low/)
		assert.strictEqual(await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes), rootBefore, 'failed funding check must not consume the proof')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), client.account.address), walletBefore, 'failed funding check must not pay the winner')
		await fundEscalationGame(child.escalationGameAddress, 32n * reportBond)
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress), 0n, 'payout plus burn consumes the funded tokens')
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'totalDisputeStakedAttoRep' }), 600n * reportBond, 'token expenditure must preserve local principal accounting')
	})

	test('losing carried proofs are unnecessary and cannot drain aggregate backing', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)
		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal, nullifierRoot: parentYesNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const { peaks: parentNoPeaks, leafCount: parentNoLeafCount, carryTotal: parentNoCarryTotal, nullifierRoot: parentNoNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
			[zeroPeakArray(), parentYesPeaks, parentNoPeaks],
			[0n, parentYesLeafCount, parentNoLeafCount],
			[0n, parentYesCarryTotal, parentNoCarryTotal],
			[0n, 0n, 1n],
			[zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot],
		)
		await fundEscalationGame(child.escalationGameAddress, parentYesCarryTotal + parentNoCarryTotal - 1n)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Not winning outcome/)
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), client.account.address), walletBalanceBefore, 'a losing proof must not transfer REP')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the losing inherited outcome should already be terminal')
	})

	test('carried winner payout applies the inherited reward schedule in child REP', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, addressString(TEST_ADDRESSES[1]), QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, addressString(TEST_ADDRESSES[2]), QuestionOutcome.No, reportBond)
		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal, nullifierRoot: parentYesNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const { peaks: parentNoPeaks, leafCount: parentNoLeafCount, carryTotal: parentNoCarryTotal, nullifierRoot: parentNoNullifierRoot } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.No)

		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, parentNoPeaks], [0n, parentYesLeafCount, parentNoLeafCount], [0n, parentYesCarryTotal, parentNoCarryTotal], [zeroHash(), parentYesNullifierRoot, parentNoNullifierRoot])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [await readCarryLeafHash(parent.escalationGameAddress, 2n)], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		assert.ok(walletBalanceAfter - walletBalanceBefore > proof.amountAttoRep, 'a carried winning proof should receive reward upside, not only its principal')
	})

	test('fork continuation inherits claim commitments without copying payout bundles', async () => {
		const source = await deployEscalationGameTestQuestionLedger()
		for (let ownerIndex = 1; ownerIndex <= 9; ownerIndex++) {
			await depositOnOutcomeViaProofTestQuestionLedger(source.testQuestionLedgerAddress, addressString(0x0000000000030000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}
		const sourcePeaks = await readCarryPeaks(client, source.escalationGameAddress, QuestionOutcome.Yes)
		const sourceLeafCount = await readCarryLeafCount(client, source.escalationGameAddress, QuestionOutcome.Yes)
		const sourceCarryTotal = await readCarryTotal(client, source.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotFromSourceViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
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
		const source = await deployEscalationGameTestQuestionLedger()
		for (let ownerIndex = 1; ownerIndex <= 65; ownerIndex++) {
			await depositOnOutcomeViaProofTestQuestionLedger(source.testQuestionLedgerAddress, addressString(0x0000000000040000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}
		assert.strictEqual(await readCarryLeafCount(client, source.escalationGameAddress, QuestionOutcome.Yes), 65n)
	})

	test('an inherited commitment preserves child-local reporting capacity', async () => {
		const source = await deployEscalationGameTestQuestionLedger()
		for (let ownerIndex = 1; ownerIndex <= 65; ownerIndex++) {
			await depositOnOutcomeViaProofTestQuestionLedger(source.testQuestionLedgerAddress, addressString(0x0000000000050000000000000000000000000000n + BigInt(ownerIndex)), QuestionOutcome.Yes, reportBond)
		}

		const child = await deployForkContinuationEscalationGame()
		await initializeSnapshotFromSourceViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
			source.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, source.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, 65n, 0n],
			[0n, 65n * reportBond, 0n],
			[zeroHash(), await readNullifierRoot(client, source.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 66n * reportBond)
		await resumeEscalationFromFork(child.escalationGameAddress)

		assert.strictEqual(await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.No), 1n)
		assert.strictEqual(await getEscrowedRepByVault(client, child.escalationGameAddress, client.account.address), 66n * reportBond)
	})
})
