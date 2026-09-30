import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { MAX_UINT256 } from '../../testSupport/simulator/utils/constants'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getActivationTime, readCarryPeaks, readCarryRoot, readCarryLeafCount, readCarryTotal, readNullifierRoot, readForkCarrySnapshotInitialized, readCarryLeafPage, readProofConsumedCarriedDepositIndexes } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { hashCarryLeaf, hashParent, SparseNullifierTree } from '../carryProofHelpers'
import { ESCALATION_TIME_LENGTH, zeroHash, oneHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: fork carry and MMR proofs', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		nonDecisionThresholdAttoRep,
		recursiveResolutionTargetCost,
		deployEscalationGameWithProofPool,
		startEscalation,
		startEscalationFromFork,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		depositOnOutcomeViaProofTestSecurityPool,
		traceCarryLeafPage,
		traceProofConsumedCarriedDepositIndexes,
		assertEscrowAccounting,
		recordForkedEscrowForOutcomeViaTestSecurityPool,
		withdrawDepositViaProofTestSecurityPool,
		withdrawDepositViaProofTestSecurityPoolWithGas,
		claimDepositForWinningViaTestSecurityPool,
		createCarryProof,
		depositOnOutcomeViaTestSecurityPool,
		assertOutcomeCarryTotalsMatchComponents,
		initializeSnapshotViaTestSecurityPool,
		initializeSnapshotWithResolutionBalancesViaTestSecurityPool,
		assertCarryCommitmentStructure,
	} = fixture
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
	})

	test('fork carry maintains an append-only Merkle Mountain Range root for inherited carryover deposits', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after first Yes deposit')

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const rootAfterFirstDeposit = await readCarryRoot(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterFirstDeposit, firstLeafHash, 'single appended leaf should be its own Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after second Yes deposit')
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 1n, 2n * reportBond, 2n)
		const expectedTwoLeafRoot = hashParent(firstLeafHash, secondLeafHash)
		const rootAfterSecondDeposit = await readCarryRoot(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterSecondDeposit, expectedTwoLeafRoot, 'two appended leaves should bag into the expected Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Invalid, 3n * reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after multi-peak and multi-outcome deposits')
	})

	test('fork carry leaf paging uses node cursors and skips consumed local leaves', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)
		await assertEscrowAccounting(escalationGameAddress, 6n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(client, escalationGameAddress, QuestionOutcome.Yes), 6n * reportBond, 'all local Yes deposits should be represented in the carry total')

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await claimDepositForWinningViaTestSecurityPool(testSecurityPoolAddress, 1n, QuestionOutcome.Yes)
		await assertEscrowAccounting(escalationGameAddress, 4n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(client, escalationGameAddress, QuestionOutcome.Yes), 4n * reportBond, 'claiming the middle local deposit should remove only that unresolved carry')

		const [firstPage, firstNextNodeId] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		assert.strictEqual(firstPage.length, 1, 'first page should include one unresolved leaf')
		assert.strictEqual(firstPage[0]?.parentDepositIndex, 2n, 'first page should start from the newest unresolved leaf')
		assert.strictEqual(firstPage[0]?.amountAttoRep, 3n * reportBond, 'first page should preserve the newest unresolved leaf amount')
		assert.strictEqual(firstNextNodeId, 2n, 'first page should return the next raw node cursor')

		const [secondPage, secondNextNodeId] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, firstNextNodeId, 2n)
		assert.strictEqual(secondPage.length, 1, 'second page should skip the consumed middle leaf and include the oldest unresolved leaf')
		assert.strictEqual(secondPage[0]?.parentDepositIndex, 0n, 'second page should return the remaining unresolved oldest leaf')
		assert.strictEqual(secondPage[0]?.amountAttoRep, reportBond, 'second page should preserve the oldest unresolved leaf amount')
		assert.strictEqual(secondNextNodeId, 0n, 'second page should finish the cursor traversal')

		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.None, 0n, 1n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 0n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		await traceCarryLeafPage(escalationGameAddress, QuestionOutcome.Yes, firstNextNodeId, 2n)
	})

	test('fork carry leaf paging rejects cursors from another outcome chain', async () => {
		const { escalationGameAddress, testSecurityPoolAddress } = await deployEscalationGameWithProofPool()
		await startEscalation(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(testSecurityPoolAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)

		const [yesPage] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		const yesNodeId = yesPage[0]?.sourceNodeId
		assert.notStrictEqual(yesNodeId, undefined)
		await assert.rejects(readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.No, yesNodeId ?? 0n, 1n), /Outcome mismatch/)
	})

	test('fork carry snapshot initialization normalizes zero nullifier roots to the empty sparse-tree root', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)

		const initializeSnapshotHash = await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])

		const emptyNullifierRoot = new SparseNullifierTree().root
		const snapshotInitialized = await readForkCarrySnapshotInitialized(client, child.escalationGameAddress)
		const yesNullifierRoot = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const forkCarrySnapshot = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: child.escalationGameAddress,
			functionName: 'getForkCarrySnapshot',
			args: [],
		})
		const initializeSnapshotReceipt = await client.waitForTransactionReceipt({ hash: initializeSnapshotHash })
		const carryCheckpointLog = initializeSnapshotReceipt.logs
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
			.find(log => log?.eventName === 'ForkCarryCheckpoint')

		if (carryCheckpointLog === undefined) {
			throw new Error('missing ForkCarryCheckpoint log')
		}

		assert.strictEqual(snapshotInitialized, true, 'initialized snapshots with empty nullifier roots should not look uninitialized')
		assert.strictEqual(yesNullifierRoot, emptyNullifierRoot, 'outcome state should expose the normalized empty nullifier root')
		assert.strictEqual(forkCarrySnapshot[3][1], emptyNullifierRoot, 'fork carry snapshots should export normalized empty nullifier roots')
		assert.deepStrictEqual(carryCheckpointLog.args.nullifierRoots, [emptyNullifierRoot, emptyNullifierRoot, emptyNullifierRoot], 'snapshot checkpoints should emit normalized empty nullifier roots')
	})

	test('short carried proof reverts with a readable proof length reason', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotWithResolutionBalancesViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, 2n, 0n], [0n, 2n * reportBond, 0n], [0n, 0n, 0n], [zeroHash(), zeroHash(), zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond, 2n * reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await fundEscalationGame(child.escalationGameAddress, 2n * reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const shortProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [], new SparseNullifierTree().getProof(0n))
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, shortProof), /Bad MMR proof length/)
	})

	test('fork carry child instances can settle multiple inherited carried deposits from proofs only', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await assertCarryCommitmentStructure(parent.escalationGameAddress, 'parent before inherited proof settlement')
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child before inherited proof settlement')

		const nullifierTree = new SparseNullifierTree()
		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash], nullifierTree.getProof(0n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, firstProof)
		nullifierTree.consume(0n)
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child after first inherited proof settlement')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash], nullifierTree.getProof(1n))
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, secondProof)
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child after all inherited proof settlements')

		const remainingCarryTotal = await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(remainingCarryTotal, 0n)
		const consumedIndexes = await readProofConsumedCarriedDepositIndexes(client, child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256)
		assert.deepStrictEqual(consumedIndexes, [0n, 1n], 'max-count proof-consumed paging should return all consumed inherited indexes')
		assert.strictEqual(new Set(consumedIndexes).size, consumedIndexes.length, 'consumed inherited proof indexes should remain unique')
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.None, 0n, 1n)
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 2n, 1n)
		await traceProofConsumedCarriedDepositIndexes(child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256)
	})

	test('an inconsistent inherited snapshot cannot consume unrelated local principal', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, reportBond, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await depositOnOutcomeViaProofTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond, 3n * reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], new SparseNullifierTree().getProof(0n))
		const nullifierBefore = await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes)
		const backingBefore = await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress)
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Carried REP low/)
		assert.strictEqual(await readNullifierRoot(client, child.escalationGameAddress, QuestionOutcome.Yes), nullifierBefore, 'rejection must not consume the proof identity')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(0n), child.escalationGameAddress), backingBefore, 'rejection must preserve backing')

		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 3n * reportBond, 'rejection must preserve both inherited and local unresolved principal')
		await claimDepositForWinningViaTestSecurityPool(child.testSecurityPoolAddress, 0n, QuestionOutcome.Yes)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), reportBond, 'the independently funded local deposit must still settle')
		await assertOutcomeCarryTotalsMatchComponents(child.escalationGameAddress)
	})

	test('fork carry proof settlement rejects reusing the same carried proof twice', async () => {
		const parent = await deployEscalationGameWithProofPool()
		await startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentCarryTotal = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentNullifierRoot = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await initializeSnapshotViaTestSecurityPool(child.testSecurityPoolAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n], [zeroHash(), parentNullifierRoot, zeroHash()])
		await recordForkedEscrowForOutcomeViaTestSecurityPool(child.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, parentCarryTotal, parentCarryTotal)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const nullifierTree = new SparseNullifierTree()
		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [], nullifierTree.getProof(0n))
		const invalidNullifierProof = { ...proof, nullifierSiblings: [oneHash(), ...nullifierTree.getProof(0n).slice(1)] }
		await assert.rejects(withdrawDepositViaProofTestSecurityPoolWithGas(child.testSecurityPoolAddress, QuestionOutcome.Yes, { ...proof, nullifierSiblings: [] }), /Bad nullifier length/)
		await assert.rejects(withdrawDepositViaProofTestSecurityPoolWithGas(child.testSecurityPoolAddress, QuestionOutcome.Yes, invalidNullifierProof), /Bad nullifier proof/)
		await withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof)
		await assert.rejects(withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, proof), /Bad nullifier proof|Deposit settled/)
	})

	test('fork carry proof settlement rejects when no carry snapshot is available', async () => {
		const child = await deployEscalationGameWithProofPool()
		await startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		await assert.rejects(
			withdrawDepositViaProofTestSecurityPool(child.testSecurityPoolAddress, QuestionOutcome.Yes, {
				depositor: client.account.address,
				amountAttoRep: reportBond,
				parentDepositIndex: 0n,
				cumulativeAmountAttoRep: reportBond,
				sourceNodeId: 1n,
				leafIndex: 0n,
				merkleMountainRangeSiblings: [],
				merkleMountainRangePeakIndex: 0n,
				nullifierSiblings: new SparseNullifierTree().getProof(0n),
			}),
			/Not winning outcome|Carry peak absent/,
		)
	})
})
