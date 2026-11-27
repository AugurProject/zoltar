import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { readCarryPeaks, readCarryRoot, readCarryLeafCount, readCarryTotal } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { hashCarryLeaf, hashParent } from '../carryProofHelpers'
import { replayZoltarEvents } from '../eventReplay/eventReplayModel'
import { FRESH_FORK_RESPONSE_PERIOD, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: recursive and grandchild carry', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		startEscalation,
		startEscalationFromFork,
		advanceForkContinuationPastStart,
		resumeEscalationFromFork,
		depositOnOutcomeViaProofTestQuestionLedger,
		withdrawDepositViaProofTestQuestionLedger,
		withdrawLocalDepositViaTestQuestionLedger,
		createCarryProof,
		computeLocalParentDepositIndex,
		assertOutcomeCarryTotalsMatchComponents,
		initializeSnapshotViaTestQuestionLedger,
		initializeSnapshotFromSourceViaTestQuestionLedger,
		getEscalationReplayLogs,
		deployEscalationGameTestQuestionLedger,
		deployForkContinuationEscalationGame,
		readOutcomeCarrySnapshot,
	} = fixture
	let client: WriteClient

	beforeEach(() => {
		client = fixture.client
	})

	test('fork carry grandchild instances can settle inherited parent carry from a recursive child snapshot', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const { peaks: parentInvalidPeaks, leafCount: parentInvalidLeafCount, carryTotal: parentInvalidCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [parentInvalidPeaks, parentYesPeaks, zeroPeakArray()], [parentInvalidLeafCount, parentLeafCount, 0n], [parentInvalidCarryTotal, parentCarryTotal, 0n])
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const { peaks: childInvalidPeaks, leafCount: childInvalidLeafCount, carryTotal: childInvalidCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: childYesPeaks, leafCount: childLeafCount, carryTotal: childCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Yes)

		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childLeafCount, 0n], [childInvalidCarryTotal, childCarryTotal, 0n])
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = {
			depositor: client.account.address,
			amountAttoRep: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [childLocalLeafHash],
		}
		const settlementHash = await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		assert.ok(settlementReceipt.gasUsed < 2_000_000n, `recursive grandchild carry proof settlement must stay below the 2,000,000 gas bound; used ${settlementReceipt.gasUsed}`)

		const remainingCarryTotal = await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, reportBond, 'only the child-local unresolved carry should remain after settling the inherited parent leaf')
		const grandchildRoot = await readCarryRoot(client, grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, childLocalLeafHash), 'grandchild should snapshot the recursive child carry set as a true two-leaf Merkle Mountain Range')
	})

	test('grandchild settlement preserves the complete ancestor reporter principal', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const { peaks: parentInvalidPeaks, leafCount: parentInvalidLeafCount, carryTotal: parentInvalidCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotFromSourceViaTestQuestionLedger(child.testQuestionLedgerAddress, parent.escalationGameAddress, zeroHash(), [parentInvalidPeaks, parentYesPeaks, zeroPeakArray()], [parentInvalidLeafCount, parentYesLeafCount, 0n], [parentInvalidCarryTotal, parentYesCarryTotal, 0n])
		await assert.rejects(client.call({ to: child.escalationGameAddress, data: '0xc028bc2a' }), /revert/, 'The removed root-claim-source selector must be unreachable')
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const { peaks: childInvalidPeaks, leafCount: childInvalidLeafCount, carryTotal: childInvalidCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: childYesPeaks, leafCount: childYesLeafCount, carryTotal: childYesCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childYesCarryTotal, parentYesCarryTotal)

		const grandchild = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotFromSourceViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, child.escalationGameAddress, zeroHash(), [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childYesLeafCount, 0n], [childInvalidCarryTotal, childYesCarryTotal, 0n])
		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, {
			depositor: client.account.address,
			amountAttoRep: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [],
			merkleMountainRangePeakIndex: 0n,
		})
		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n)
	})

	test('recursive reporter principal is paid exactly in either claim order', async () => {
		const firstAmount = 8n * reportBond + 3n
		const secondAmount = 8n * reportBond + 5n
		const aggregateAmount = firstAmount + secondAmount
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, firstAmount)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, secondAmount)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotFromSourceViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, aggregateAmount, 0n],
		)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childCarryTotal, aggregateAmount)
		const childPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstAmount, 0n, firstAmount, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, secondAmount, 1n, aggregateAmount, 2n)

		const settleInOrder = async (leafOrder: readonly [0 | 1, 0 | 1]) => {
			const grandchild = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
			await initializeSnapshotFromSourceViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childPeaks, zeroPeakArray()], [0n, childLeafCount, 0n], [0n, childCarryTotal, 0n])
			await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)
			const payouts = [0n, 0n]
			const allocatedTotal = childCarryTotal
			let totalPaid = 0n
			for (const leafIndex of leafOrder) {
				const isFirst = leafIndex === 0
				const proof = await createCarryProof(parent.escalationGameAddress, BigInt(leafIndex), BigInt(leafIndex), 1n, [isFirst ? secondLeafHash : firstLeafHash], BigInt(leafIndex + 1))
				const before = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
				await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
				const payout = (await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - before
				assert.strictEqual(payout, isFirst ? firstAmount : secondAmount, 'each reporter receives its complete original stake')
				await assert.rejects(withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, proof))
				payouts[leafIndex] = payout
				totalPaid += payout
				assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), allocatedTotal - totalPaid)
			}
			assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'every settlement order must consume the aggregate reporter checkpoint exactly')
			assert.strictEqual(totalPaid, allocatedTotal, 'cumulative allocations must pay the whole original principal with no residue')
			return payouts
		}

		assert.deepStrictEqual(await settleInOrder([0, 1]), await settleInOrder([1, 0]), 'each immutable leaf must receive the same allocation in either order')
	})

	test('direct child settlement pays the full inherited principal exactly once', async () => {
		const inheritedPrincipal = 100n * reportBond
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, inheritedPrincipal)

		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)
		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotFromSourceViaTestQuestionLedger(child.testQuestionLedgerAddress, parent.escalationGameAddress, zeroHash(), [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentYesLeafCount, 0n], [0n, parentYesCarryTotal, 0n])
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [])
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)

		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, inheritedPrincipal, 'the direct child payout preserves the original reporter principal')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the payout consumes all inherited principal stored in source units')
	})

	test('event-only replay reproduces a recursive grandchild carry snapshot that includes child-local leaves', async () => {
		const parent = await deployEscalationGameWithProofPool()
		const parentStartHash = await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		const parentInvalidDepositHash = await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		const parentYesDepositHash = await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const { peaks: parentInvalidPeaks, leafCount: parentInvalidLeafCount, carryTotal: parentInvalidCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: parentYesPeaks, leafCount: parentYesLeafCount, carryTotal: parentYesCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		const childStartHash = await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, -FRESH_FORK_RESPONSE_PERIOD)
		const childCheckpointHash = await initializeSnapshotFromSourceViaTestQuestionLedger(child.testQuestionLedgerAddress, parent.escalationGameAddress, zeroHash(), [parentInvalidPeaks, parentYesPeaks, zeroPeakArray()], [parentInvalidLeafCount, parentYesLeafCount, 0n], [parentInvalidCarryTotal, parentYesCarryTotal, 0n])
		await resumeEscalationFromFork(child.escalationGameAddress)
		const childLocalDepositHash = await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		// A live source exports every local leaf: carry stays append-only until finality.
		const { peaks: childInvalidPeaks, leafCount: childInvalidLeafCount, carryTotal: childInvalidCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Invalid)
		const { peaks: childYesPeaks, leafCount: childYesLeafCount, carryTotal: childYesCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n)
		const childLocalLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n), 4n * reportBond, 1n)
		const grandchild = await deployEscalationGameWithProofPool()
		const grandchildStartHash = await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const grandchildCheckpointHash = await initializeSnapshotFromSourceViaTestQuestionLedger(
			grandchild.testQuestionLedgerAddress,
			child.escalationGameAddress,
			zeroHash(),
			[childInvalidPeaks, childYesPeaks, zeroPeakArray()],
			[childInvalidLeafCount, childYesLeafCount, 0n],
			[childInvalidCarryTotal, childYesCarryTotal, 0n],
		)

		const grandchildRoot = await readCarryRoot(client, grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, childLocalLeafHash), 'the recursive grandchild snapshot should commit to the inherited and child-local leaves')
		const replayLogs = await getEscalationReplayLogs(
			[parentStartHash, parentInvalidDepositHash, parentYesDepositHash, childStartHash, childCheckpointHash, childLocalDepositHash, grandchildStartHash, grandchildCheckpointHash],
			new Set([parent.escalationGameAddress.toLowerCase(), child.escalationGameAddress.toLowerCase(), grandchild.escalationGameAddress.toLowerCase()]),
		)
		const replayed = replayZoltarEvents(replayLogs)
		assert.strictEqual(replayed.escalationCarryRoots.get(grandchild.escalationGameAddress)?.[QuestionOutcome.Yes], grandchildRoot, 'event-only replay should match the recursive grandchild carry root')
		assert.strictEqual(replayed.escalationCarryPeaks.get(grandchild.escalationGameAddress)?.[QuestionOutcome.Yes]?.[1], childYesPeaks[1], 'event-only replay should match the recursive grandchild carry peak')
	})

	test('grandchild local settlement does not lock an inherited child-local carried deposit with the same deposit index', async () => {
		const childLocalDepositor = addressString(TEST_ADDRESSES[1])
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotFromSourceViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, childLocalDepositor, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const { peaks: childYesPeaks, leafCount: childYesLeafCount, carryTotal: childYesCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(childLocalDepositor, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotFromSourceViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n])
		await resumeEscalationFromFork(grandchild.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await withdrawLocalDepositViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, 0n, QuestionOutcome.Yes)

		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], 1n)
		const childLocalBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), childLocalDepositor)
		await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, inheritedChildLocalProof)
		const childLocalBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), childLocalDepositor)
		assert.ok(childLocalBalanceAfter > childLocalBalanceBefore, 'the committed depositor should receive the inherited payout')

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [childLocalLeafHash], 1n)
		await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'grandchild local settlement should not lock inherited carried deposits from the child snapshot')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
	})

	test('settling an inherited child-local carried deposit first still clears the matching grandchild-local unresolved carry', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotViaTestQuestionLedger(
			child.testQuestionLedgerAddress,
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
		)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const { peaks: childYesPeaks, leafCount: childYesLeafCount, carryTotal: childYesCarryTotal } = await readOutcomeCarrySnapshot(child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)

		const grandchild = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n])
		await resumeEscalationFromFork(grandchild.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], 1n)
		await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, inheritedChildLocalProof)

		await withdrawLocalDepositViaTestQuestionLedger(grandchild.testQuestionLedgerAddress, 0n, QuestionOutcome.Yes)

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)], 1n)
		await withdrawDepositViaProofTestQuestionLedger(grandchild.testQuestionLedgerAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'inherited settlement first should still leave the matching grandchild-local deposit claimable and clear all unresolved carry')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
	})
})
