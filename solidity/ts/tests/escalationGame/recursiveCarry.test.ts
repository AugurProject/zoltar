import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { readCarryPeaks, readCarryRoot, readCarryLeafCount, readCarryTotal, readNullifierRoot } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPoolForker_SecurityPoolForker } from '../../types/contractArtifact'
import { hashCarryLeaf, hashParent, SparseNullifierTree } from '../carryProofHelpers'
import { replayZoltarEvents } from '../eventReplay/eventReplayModel'
import { zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: recursive and grandchild carry', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		deploySecurityPoolAncestorNode,
		startEscalation,
		startEscalationFromFork,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestSecurityPool,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		applyTruthAuctionHaircutViaTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		claimDepositForWinningViaTestSecurityPool,
		createCarryProof,
		computeLocalParentDepositIndex,
		assertOutcomeCarryTotalsMatchComponents,
		initializeSnapshotViaTestSecurityPool,
		initializeSnapshotFromSourceViaTestSecurityPool,
		getEscalationReplayLogs,
	} = fixture
	let client: WriteClient

	beforeEach(() => {
		client = fixture.client
	})

	test('fork carry grandchild instances can settle inherited parent carry from a recursive child snapshot', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [parentInvalidPeaks, parentYesPeaks, zeroPeakArray()], [parentInvalidLeafCount, parentLeafCount, 0n], [parentInvalidCarryTotal, parentCarryTotal, 0n], [parentInvalidNullifierRoot, parentNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal + reportBond, parentCarryTotal + reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childInvalidPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)

		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [childInvalidPeaks, childYesPeaks, zeroPeakArray()], [childInvalidLeafCount, childLeafCount, 0n], [childInvalidCarryTotal, childCarryTotal, 0n], [childInvalidNullifierRoot, childNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childCarryTotal, childCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const proof = {
			depositor: client.account.address,
			amountAttoRep: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [childLocalLeafHash],
			nullifierSiblings: nullifierTree.getProof(0n),
		}
		const settlementHash = await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const settlementReceipt = await client.waitForTransactionReceipt({ hash: settlementHash })
		assert.ok(settlementReceipt.gasUsed < 2_000_000n, `recursive grandchild carry proof settlement must stay below the 2,000,000 gas bound; used ${settlementReceipt.gasUsed}`)

		const remainingCarryTotal = await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, reportBond, 'only the child-local unresolved carry should remain after settling the inherited parent leaf')
		const grandchildRoot = await readCarryRoot(client, grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, childLocalLeafHash), 'grandchild should snapshot the recursive child carry set as a true two-leaf Merkle Mountain Range')
	})

	test('grandchild settlement preserves an ancestor truth-auction haircut on inherited carry', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[parentInvalidPeaks, parentYesPeaks, zeroPeakArray()],
			[parentInvalidLeafCount, parentYesLeafCount, 0n],
			[parentInvalidCarryTotal, parentYesCarryTotal, 0n],
			[parentInvalidNullifierRoot, parentYesNullifierRoot, zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentYesCarryTotal, parentYesCarryTotal)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 4n)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'truthAuctionRepBeforeAttoRep', args: [] }), childRepBefore)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'truthAuctionRepRemainingAttoRep', args: [] }), childRepBefore - childRepBefore / 4n)
		const childRootSource = await client.call({ to: child.escalationGameAddress, data: '0xc028bc2a' })
		assert.strictEqual(addressString(BigInt(childRootSource.data ?? '0x')).toLowerCase(), parent.escalationGameAddress.toLowerCase())
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childInvalidPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childYesCarryTotal, (parentYesCarryTotal * 3n) / 4n)
		const childInvalidNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			grandchild.testSecurityPoolAddress,
			child.escalationGameAddress,
			zeroHash(),
			[childInvalidPeaks, childYesPeaks, zeroPeakArray()],
			[childInvalidLeafCount, childYesLeafCount, 0n],
			[childInvalidCarryTotal, childYesCarryTotal, 0n],
			[childInvalidNullifierRoot, childYesNullifierRoot, zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, {
			depositor: client.account.address,
			amountAttoRep: 3n * reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: 3n * reportBond,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [],
			merkleMountainRangePeakIndex: 0n,
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n)
	})

	test('recursive carry consumption allocates aggregate retention rounding by cumulative leaf position', async () => {
		const firstAmount = reportBond + 1n
		const secondAmount = reportBond + 3n
		const aggregateAmount = firstAmount + secondAmount
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, firstAmount)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, secondAmount)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, aggregateAmount, 0n],
			[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, aggregateAmount, aggregateAmount)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 4n)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childCarryTotal, (aggregateAmount * 3n) / 4n)
		assert.strictEqual((firstAmount * 3n) / 4n + (secondAmount * 3n) / 4n + 1n, childCarryTotal, 'the fixture must expose an aggregate-versus-leaf floor difference')
		const childPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstAmount, 0n, firstAmount, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, secondAmount, 1n, aggregateAmount, 2n)

		const settleInOrder = async (leafOrder: readonly [0 | 1, 0 | 1]) => {
			const grandchild = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await initializeSnapshotFromSourceViaTestSecurityPool(grandchild.testSecurityPoolAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childPeaks, zeroPeakArray()], [0n, childLeafCount, 0n], [0n, childCarryTotal, 0n], [zeroHash(), childNullifierRoot, zeroHash()])
			await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childCarryTotal, childCarryTotal)
			await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)
			const nullifierTree = new SparseNullifierTree()
			for (const leafIndex of leafOrder) {
				const isFirst = leafIndex === 0
				const proof = await createCarryProof(parent.escalationGameAddress, BigInt(leafIndex), BigInt(leafIndex), 1n, [isFirst ? secondLeafHash : firstLeafHash], nullifierTree.getProof(BigInt(leafIndex)), BigInt(leafIndex + 1))
				await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
				nullifierTree.consume(BigInt(leafIndex))
			}
			assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'every settlement order must consume the aggregate retained checkpoint exactly')
		}

		await settleInOrder([0, 1])
		await settleInOrder([1, 0])
	})

	test('successive auction haircuts preserve recursive claims in either order', async () => {
		const firstAmount = 8n * reportBond + 3n
		const secondAmount = 8n * reportBond + 5n
		const aggregateAmount = firstAmount + secondAmount
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, firstAmount)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, secondAmount)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, aggregateAmount, 0n],
			[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, aggregateAmount, aggregateAmount)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 2n)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(childCarryTotal, aggregateAmount / 2n)
		assert.strictEqual(firstAmount / 2n + secondAmount / 2n + 1n, childCarryTotal, 'the fixture must expose an aggregate-versus-leaf floor difference')
		const childPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, firstAmount, 0n, firstAmount, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, secondAmount, 1n, aggregateAmount, 2n)

		const settleInOrder = async (leafOrder: readonly [0 | 1, 0 | 1]) => {
			const grandchild = await deployEscalationGameWithProofPool()
			await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await initializeSnapshotFromSourceViaTestSecurityPool(grandchild.testSecurityPoolAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childPeaks, zeroPeakArray()], [0n, childLeafCount, 0n], [0n, childCarryTotal, 0n], [zeroHash(), childNullifierRoot, zeroHash()])
			await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childCarryTotal, childCarryTotal)
			const grandchildRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), grandchild.escalationGameAddress)
			await applyTruthAuctionHaircutViaTestSecurityPool(grandchild.testSecurityPoolAddress, grandchildRepBefore / 4n)
			await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)
			const nullifierTree = new SparseNullifierTree()
			const payouts = [0n, 0n]
			const allocatedTotal = (childCarryTotal * 3n) / 4n
			let totalPaid = 0n
			for (const leafIndex of leafOrder) {
				const isFirst = leafIndex === 0
				const proof = await createCarryProof(parent.escalationGameAddress, BigInt(leafIndex), BigInt(leafIndex), 1n, [isFirst ? secondLeafHash : firstLeafHash], nullifierTree.getProof(BigInt(leafIndex)), BigInt(leafIndex + 1))
				const before = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
				await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
				const payout = (await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)) - before
				payouts[leafIndex] = payout
				totalPaid += payout
				assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), allocatedTotal - totalPaid)
				nullifierTree.consume(BigInt(leafIndex))
			}
			assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'every settlement order must consume the aggregate retained checkpoint exactly')
			assert.strictEqual(totalPaid, allocatedTotal, 'cumulative allocations must pay the whole retained principal with no rounding residue')
			return payouts
		}

		assert.deepStrictEqual(await settleInOrder([0, 1]), await settleInOrder([1, 0]), 'each immutable leaf must receive the same allocation in either order')
	})

	test('direct child settlement applies its truth-auction haircut once and consumes the inherited source basis', async () => {
		const inheritedPrincipal = 100n * reportBond
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, inheritedPrincipal)

		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(child.testSecurityPoolAddress, parent.escalationGameAddress, zeroHash(), [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentYesLeafCount, 0n], [0n, parentYesCarryTotal, 0n], [zeroHash(), parentYesNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, inheritedPrincipal, inheritedPrincipal)
		const childRepBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await applyTruthAuctionHaircutViaTestSecurityPool(child.testSecurityPoolAddress, childRepBefore / 4n)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const walletBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		const walletBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), client.account.address)

		assert.strictEqual(walletBalanceAfter - walletBalanceBefore, (inheritedPrincipal * 3n) / 4n, 'the direct child payout should apply the current truth-auction haircut exactly once')
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 0n, 'the retained payout should consume all inherited principal stored in source units')
	})

	test('direct-claim replay lookup gas does not grow with security-pool ancestry', async () => {
		const shallowAncestor = await deploySecurityPoolAncestorNode(zeroAddress)
		let deepestAncestor = shallowAncestor
		const ancestorDepth = 32
		for (let depth = 1; depth < ancestorDepth; depth++) deepestAncestor = await deploySecurityPoolAncestorNode(deepestAncestor)

		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const shallowCheckHash = await client.sendTransaction({
			to: forkerAddress,
			data: encodeFunctionData({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isEscalationDepositClaimedDirectly',
				args: [shallowAncestor, QuestionOutcome.Yes, 0n],
			}),
			gas: 2_000_000n,
		})
		const shallowCheckReceipt = await client.waitForTransactionReceipt({ hash: shallowCheckHash })
		const deepCheckHash = await client.sendTransaction({
			to: forkerAddress,
			data: encodeFunctionData({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'isEscalationDepositClaimedDirectly',
				args: [deepestAncestor, QuestionOutcome.Yes, 0n],
			}),
			gas: 2_000_000n,
		})
		const deepCheckReceipt = await client.waitForTransactionReceipt({ hash: deepCheckHash })

		assert.strictEqual(deepCheckReceipt.status, 'success', 'the 32-level replay lookup should complete successfully')
		assert.ok(deepCheckReceipt.gasUsed <= shallowCheckReceipt.gasUsed + 10_000n, `replay lookup should be depth-independent; shallow used ${shallowCheckReceipt.gasUsed}, deep used ${deepCheckReceipt.gasUsed}`)
	})

	test('fork carry grandchild instances reject child-local leaves that were already settled before the recursive fork', async () => {
		const parent = await deployEscalationGameWithProofPool()
		const parentStartHash = await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		const parentInvalidDepositHash = await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 2n * reportBond)
		const parentYesDepositHash = await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentInvalidPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentInvalidNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Invalid)
		const parentYesNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		const childStartHash = await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const childCheckpointHash = await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[parentInvalidPeaks, parentYesPeaks, zeroPeakArray()],
			[parentInvalidLeafCount, parentYesLeafCount, 0n],
			[parentInvalidCarryTotal, parentYesCarryTotal, 0n],
			[parentInvalidNullifierRoot, parentYesNullifierRoot, zeroHash()],
		)
		const childLocalDepositHash = await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const childClaimHash = await claimDepositForWinningViaTestSecurityPool(child.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const childInvalidPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childInvalidNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Invalid)
		const childYesNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 2n)
		const grandchild = await deployEscalationGameWithProofPool()
		const grandchildStartHash = await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const grandchildCheckpointHash = await initializeSnapshotFromSourceViaTestSecurityPool(
			grandchild.testSecurityPoolAddress,
			child.escalationGameAddress,
			zeroHash(),
			[childInvalidPeaks, childYesPeaks, zeroPeakArray()],
			[childInvalidLeafCount, childYesLeafCount, 0n],
			[childInvalidCarryTotal, childYesCarryTotal, 0n],
			[childInvalidNullifierRoot, childYesNullifierRoot, zeroHash()],
		)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const settledChildLocalLeafProof = {
			depositor: client.account.address,
			amountAttoRep: reportBond,
			parentDepositIndex: computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n),
			cumulativeAmountAttoRep: 4n * reportBond,
			sourceNodeId: 1n,
			leafIndex: 1n,
			merkleMountainRangePeakIndex: 1n,
			merkleMountainRangeSiblings: [parentLeafHash],
			nullifierSiblings: nullifierTree.getProof(computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)),
		}

		await assert.rejects(
			withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, settledChildLocalLeafProof),
			/Bad nullifier proof|Deposit settled|Carry peak absent|Bad carry proof|Bad MMR proof length/,
			'grandchild carry settlement must reject a child-local leaf that was already settled before the recursive fork',
		)

		const grandchildRoot = await readCarryRoot(client, grandchild.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(grandchildRoot, hashParent(parentLeafHash, zeroHash()), 'the recursive grandchild snapshot should keep the settled child-local position cleared in place')
		const replayLogs = await getEscalationReplayLogs(
			[parentStartHash, parentInvalidDepositHash, parentYesDepositHash, childStartHash, childCheckpointHash, childLocalDepositHash, childClaimHash, grandchildStartHash, grandchildCheckpointHash],
			new Set([parent.escalationGameAddress.toLowerCase(), child.escalationGameAddress.toLowerCase(), grandchild.escalationGameAddress.toLowerCase()]),
		)
		const replayed = replayZoltarEvents(replayLogs)
		assert.strictEqual(replayed.escalationCarryRoots.get(grandchild.escalationGameAddress)?.[QuestionOutcome.Yes], grandchildRoot, 'event-only replay should match the recursive grandchild carry root')
		assert.strictEqual(replayed.escalationCarryPeaks.get(grandchild.escalationGameAddress)?.[QuestionOutcome.Yes]?.[1], childYesPeaks[1], 'event-only replay should match the recursive grandchild carry peak')
	})

	test('grandchild local settlement does not lock an inherited child-local carried deposit with the same deposit index', async () => {
		const childLocalDepositor = addressString(TEST_ADDRESSES[1])
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(
			child.testSecurityPoolAddress,
			parent.escalationGameAddress,
			zeroHash(),
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, childLocalDepositor, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		const childYesPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)
		const childLocalLeafHash = hashCarryLeaf(childLocalDepositor, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotFromSourceViaTestSecurityPool(grandchild.testSecurityPoolAddress, child.escalationGameAddress, zeroHash(), [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n], [zeroHash(), childYesNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		await claimDepositForWinningViaTestSecurityPool(grandchild.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const nullifierTree = new SparseNullifierTree()
		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], nullifierTree.getProof(childLocalParentDepositIndex), 1n)
		const childLocalBalanceBefore = await getERC20Balance(client, getRepTokenAddress(0n), childLocalDepositor)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedChildLocalProof)
		const childLocalBalanceAfter = await getERC20Balance(client, getRepTokenAddress(0n), childLocalDepositor)
		assert.ok(childLocalBalanceAfter > childLocalBalanceBefore, 'the committed depositor should receive the inherited payout')
		nullifierTree.consume(childLocalParentDepositIndex)

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [childLocalLeafHash], nullifierTree.getProof(0n), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'grandchild local settlement should not lock inherited carried deposits from the child snapshot')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
	})

	test('settling an inherited child-local carried deposit first still clears the matching grandchild-local unresolved carry', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(
			child.testSecurityPoolAddress,
			[zeroPeakArray(), await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroPeakArray()],
			[0n, await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[0n, await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes), 0n],
			[zeroHash(), await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes), zeroHash()],
		)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const childYesPeaks = await readCarryPeaks(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesLeafCount = await readCarryLeafCount(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const childYesNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const parentLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 3n * reportBond, 0n, 3n * reportBond, 1n)
		const childLocalParentDepositIndex = computeLocalParentDepositIndex(child.escalationGameAddress, QuestionOutcome.Yes, 0n)

		const grandchild = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(grandchild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(grandchild.testSecurityPoolAddress, [zeroPeakArray(), childYesPeaks, zeroPeakArray()], [0n, childYesLeafCount, 0n], [0n, childYesCarryTotal, 0n], [zeroHash(), childYesNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(grandchild.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, childYesCarryTotal, childYesCarryTotal)
		await advanceForkContinuationPastStart(grandchild.escalationGameAddress, recursiveResolutionTargetCost)

		const nullifierTree = new SparseNullifierTree()
		const inheritedChildLocalProof = await createCarryProof(child.escalationGameAddress, childLocalParentDepositIndex, 1n, 1n, [parentLeafHash], nullifierTree.getProof(childLocalParentDepositIndex), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedChildLocalProof)
		nullifierTree.consume(childLocalParentDepositIndex)

		await claimDepositForWinningViaTestSecurityPool(grandchild.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)

		const inheritedParentProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, childLocalParentDepositIndex, 4n * reportBond, 1n)], nullifierTree.getProof(0n), 1n)
		await withdrawDepositViaProofTestSecurityPool(grandchild.testSecurityPoolAddress, QuestionOutcome.Yes, inheritedParentProof)

		assert.strictEqual(await readCarryTotal(client, grandchild.escalationGameAddress, QuestionOutcome.Yes), 0n, 'inherited settlement first should still leave the matching grandchild-local deposit claimable and clear all unresolved carry')
		await assertOutcomeCarryTotalsMatchComponents(grandchild.escalationGameAddress)
	})
})
