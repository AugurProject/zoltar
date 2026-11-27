import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { MAX_UINT256 } from '../../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getActivationTime, readCarryPeaks, readCarryRoot, readCarryLeafCount, readCarryTotal, readForkCarrySnapshotInitialized, readCarryLeafPage, readProofConsumedCarriedDepositIndexes } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { statoblast_EscalationGame_EscalationGame } from '../../types/contractArtifact'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { hashCarryLeaf, hashParent } from '../carryProofHelpers'
import { FRESH_FORK_RESPONSE_PERIOD, ESCALATION_TIME_LENGTH, zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation Game: fork carry and MMR proofs', () => {
	const fixture = useEscalationGameFixture()
	const {
		reportBond,
		recursiveResolutionTargetCost,
		fundEscalationGame,
		advanceForkContinuationPastStart,
		resumeEscalationFromFork,
		depositOnOutcomeViaProofTestQuestionLedger,
		traceCarryLeafPage,
		traceProofConsumedCarriedDepositIndexes,
		assertEscrowAccounting,
		withdrawDepositViaProofTestQuestionLedger,
		withdrawDepositViaProofTestQuestionLedgerWithGas,
		withdrawLocalDepositViaTestQuestionLedger,
		createCarryProof,
		depositOnOutcomeViaTestQuestionLedger,
		assertOutcomeCarryTotalsMatchComponents,
		initializeSnapshotViaTestQuestionLedger,
		initializeSnapshotWithResolutionBalancesViaTestQuestionLedger,
		assertCarryCommitmentStructure,
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

	test('#1396 carry pagination rejects never-issued Invalid node cursors', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		const [empty, next] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, 0n, 1n)
		assert.strictEqual(empty.length, 0)
		assert.strictEqual(next, 0n)
		await assert.rejects(readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, 1n, 1n), /Unknown carry cursor/)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		const [first] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, 0n, 1n)
		const leaf = first[0]
		if (leaf === undefined) throw new Error('Missing real Invalid deposit')
		const [resumed] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, leaf.sourceNodeId, 1n)
		assert.deepStrictEqual(resumed, first)
		await assert.rejects(readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, leaf.sourceNodeId, 1n), /Outcome mismatch/)
	})

	test('fork carry maintains an append-only Merkle Mountain Range root for inherited carryover deposits', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()

		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after first Yes deposit')

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const rootAfterFirstDeposit = await readCarryRoot(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterFirstDeposit, firstLeafHash, 'single appended leaf should be its own Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after second Yes deposit')
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 1n, 2n * reportBond, 2n)
		const expectedTwoLeafRoot = hashParent(firstLeafHash, secondLeafHash)
		const rootAfterSecondDeposit = await readCarryRoot(client, escalationGameAddress, QuestionOutcome.Yes)
		assert.strictEqual(rootAfterSecondDeposit, expectedTwoLeafRoot, 'two appended leaves should bag into the expected Merkle Mountain Range root')

		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, 3n * reportBond)
		await assertCarryCommitmentStructure(escalationGameAddress, 'after multi-peak and multi-outcome deposits')
	})

	test('fork carry leaf paging uses node cursors and skips consumed local leaves', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)
		await assertEscrowAccounting(escalationGameAddress, 6n * reportBond)
		await assertOutcomeCarryTotalsMatchComponents(escalationGameAddress)
		assert.strictEqual(await readCarryTotal(client, escalationGameAddress, QuestionOutcome.Yes), 6n * reportBond, 'all local Yes deposits should be represented in the carry total')

		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		await withdrawLocalDepositViaTestQuestionLedger(testQuestionLedgerAddress, 1n, QuestionOutcome.Yes)
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

	test('fork carry leaf paging bounds visited nodes across consumed history without losing live leaves', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		for (let index = 0; index < 9; index++) {
			await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		}
		const activationTime = await getActivationTime(client, escalationGameAddress)
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)
		for (let index = 1n; index < 9n; index++) {
			await withdrawLocalDepositViaTestQuestionLedger(testQuestionLedgerAddress, index, QuestionOutcome.Yes)
		}

		let cursor = 0n
		for (const expectedNextNodeId of [7n, 5n, 3n, 1n]) {
			const [page, nextNodeId] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, cursor, 2n)
			assert.deepStrictEqual(page, [], 'consumed nodes must count against the page scan budget')
			assert.strictEqual(nextNodeId, expectedNextNodeId, 'an empty page must resume at the first unvisited node')
			cursor = nextNodeId
		}
		const [lastPage, lastNextNodeId] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, cursor, 2n)
		assert.strictEqual(lastPage.length, 1, 'following empty page cursors must retain the oldest live leaf')
		assert.strictEqual(lastPage[0]?.parentDepositIndex, 0n)
		assert.strictEqual(lastPage[0]?.amountAttoRep, reportBond)
		assert.strictEqual(lastNextNodeId, 0n)
	})

	test('fork carry leaf paging rejects cursors from another outcome chain', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.No, 2n * reportBond)

		const [yesPage] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Yes, 0n, 1n)
		const yesNodeId = yesPage[0]?.sourceNodeId
		assert.notStrictEqual(yesNodeId, undefined)
		await assert.rejects(readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.No, yesNodeId ?? 0n, 1n), /Outcome mismatch/)
	})

	test('fork carry leaf paging rejects a never-issued cursor for every outcome, including the zero-valued Invalid outcome (#1396)', async () => {
		const { escalationGameAddress, testQuestionLedgerAddress } = await deployEscalationGameTestQuestionLedger()
		assert.deepStrictEqual(await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, 0n, 1n), [[], 0n], 'a game without local deposits has an empty Invalid page')
		// Node 1 has not been issued. An absent node's default outcome is Invalid,
		// so only an existence check keeps it from reading as a zero-valued deposit.
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]) {
			await assert.rejects(readCarryLeafPage(client, escalationGameAddress, outcome, 1n, 1n), /Unknown carry cursor/)
		}

		await depositOnOutcomeViaProofTestQuestionLedger(testQuestionLedgerAddress, client.account.address, QuestionOutcome.Invalid, reportBond)
		const [headPage, headNextNodeId] = await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, 0n, 1n)
		assert.strictEqual(headPage.length, 1, 'a real Invalid deposit is listed from the head')
		assert.strictEqual(headNextNodeId, 0n)
		const sourceNodeId = headPage[0]?.sourceNodeId
		if (sourceNodeId === undefined) throw new Error('Invalid deposit page has no leaf')
		assert.deepStrictEqual(await readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, sourceNodeId, 1n), [headPage, 0n], 'resuming from the issued node returns the same deposit')
		await assert.rejects(readCarryLeafPage(client, escalationGameAddress, QuestionOutcome.Invalid, sourceNodeId + 1n, 1n), /Unknown carry cursor/)
	})

	test('an empty fork carry snapshot completes initialization and checkpoints empty commitments', async () => {
		const child = await deployForkContinuationEscalationGame()

		const initializeSnapshotHash = await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n])

		const snapshotInitialized = await readForkCarrySnapshotInitialized(client, child.escalationGameAddress)
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

		assert.strictEqual(snapshotInitialized, true, 'an empty snapshot should not look uninitialized')
		assert.deepStrictEqual(forkCarrySnapshot[1], [0n, 0n, 0n], 'fork carry snapshots should export empty leaf counts')
		assert.deepStrictEqual(forkCarrySnapshot[2], [0n, 0n, 0n], 'fork carry snapshots should export empty carry totals')
		assert.deepStrictEqual(carryCheckpointLog.args.carryRoots, [zeroHash(), zeroHash(), zeroHash()], 'snapshot checkpoints should emit empty carry roots')
		assert.deepStrictEqual(carryCheckpointLog.args.leafCounts, [0n, 0n, 0n], 'snapshot checkpoints should emit empty leaf counts')
	})

	test('short carried proof reverts with a readable proof length reason', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD, 2n * reportBond)
		await initializeSnapshotWithResolutionBalancesViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, 2n, 0n], [0n, 2n * reportBond, 0n], [0n, 0n, 0n])
		await fundEscalationGame(child.escalationGameAddress, 2n * reportBond)
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const shortProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [])
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, shortProof), /Bad MMR proof length/)
	})

	test('fork carry child instances can settle multiple inherited carried deposits from proofs only', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)

		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const firstLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, reportBond, 0n, reportBond, 1n)
		const secondLeafHash = hashCarryLeaf(client.account.address, QuestionOutcome.Yes, 2n * reportBond, 1n, 3n * reportBond, 2n)

		const child = await deployForkContinuationEscalationGame(0n, parentCarryTotal)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n])
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)
		await assertCarryCommitmentStructure(parent.escalationGameAddress, 'parent before inherited proof settlement')
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child before inherited proof settlement')

		const firstProof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 1n, [secondLeafHash])
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, firstProof)
		await assertCarryCommitmentStructure(child.escalationGameAddress, 'child after first inherited proof settlement')

		const secondProof = await createCarryProof(parent.escalationGameAddress, 1n, 1n, 1n, [firstLeafHash])
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, secondProof)
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
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 3n * reportBond)

		const parentLeafCount = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
		const parentYesPeaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(-FRESH_FORK_RESPONSE_PERIOD)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, reportBond, 0n])
		await resumeEscalationFromFork(child.escalationGameAddress)
		await depositOnOutcomeViaProofTestQuestionLedger(child.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, 2n * reportBond)
		await advanceForkContinuationPastStart(child.escalationGameAddress, recursiveResolutionTargetCost)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [])
		const readBacking = async () => await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: child.escalationGameAddress, functionName: 'getDisputeBackingAttoRep' })
		const backingBefore = await readBacking()
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Carried source low/)
		assert.deepStrictEqual(await readProofConsumedCarriedDepositIndexes(client, child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256), [], 'rejection must not consume the proof identity')
		assert.strictEqual(await readBacking(), backingBefore, 'rejection must preserve backing')

		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), 3n * reportBond, 'rejection must preserve both inherited and local unresolved principal')
		await withdrawLocalDepositViaTestQuestionLedger(child.testQuestionLedgerAddress, 0n, QuestionOutcome.Yes)
		assert.strictEqual(await readCarryTotal(client, child.escalationGameAddress, QuestionOutcome.Yes), reportBond, 'the independently funded local deposit must still settle')
		await assertOutcomeCarryTotalsMatchComponents(child.escalationGameAddress)
	})

	test('fork carry proof settlement rejects reusing the same carried proof twice', async () => {
		const parent = await deployEscalationGameTestQuestionLedger()
		await depositOnOutcomeViaProofTestQuestionLedger(parent.testQuestionLedgerAddress, client.account.address, QuestionOutcome.Yes, reportBond)

		const { peaks: parentYesPeaks, leafCount: parentLeafCount, carryTotal: parentCarryTotal } = await readOutcomeCarrySnapshot(parent.escalationGameAddress, QuestionOutcome.Yes)

		const child = await deployForkContinuationEscalationGame(0n, parentCarryTotal)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), parentYesPeaks, zeroPeakArray()], [0n, parentLeafCount, 0n], [0n, parentCarryTotal, 0n])
		await advanceForkContinuationPastStart(child.escalationGameAddress)

		const proof = await createCarryProof(parent.escalationGameAddress, 0n, 0n, 0n, [])
		await assert.rejects(withdrawDepositViaProofTestQuestionLedgerWithGas(child.testQuestionLedgerAddress, QuestionOutcome.Yes, { ...proof, amountAttoRep: proof.amountAttoRep + 1n }), /Bad carry proof/)
		await assert.rejects(withdrawDepositViaProofTestQuestionLedgerWithGas(child.testQuestionLedgerAddress, QuestionOutcome.Yes, { ...proof, depositor: child.testQuestionLedgerAddress }), /Bad carry proof/)
		await withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof)
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Deposit settled/)
		assert.deepStrictEqual(await readProofConsumedCarriedDepositIndexes(client, child.escalationGameAddress, QuestionOutcome.Yes, 0n, MAX_UINT256), [0n], 'a rejected reuse must not record the proof twice')
	})

	test('fork carry proof settlement blocks incomplete initialization and rejects empty snapshots', async () => {
		const child = await deployForkContinuationEscalationGame()
		const proof = {
			depositor: client.account.address,
			amountAttoRep: reportBond,
			parentDepositIndex: 0n,
			cumulativeAmountAttoRep: reportBond,
			sourceNodeId: 1n,
			leafIndex: 0n,
			merkleMountainRangeSiblings: [],
			merkleMountainRangePeakIndex: 0n,
		}
		await assert.rejects(advanceForkContinuationPastStart(child.escalationGameAddress), /Fork snapshot incomplete/)
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Question not final/)
		await initializeSnapshotViaTestQuestionLedger(child.testQuestionLedgerAddress, [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 0n, 0n], [0n, 0n, 0n])
		await advanceForkContinuationPastStart(child.escalationGameAddress)
		await assert.rejects(withdrawDepositViaProofTestQuestionLedger(child.testQuestionLedgerAddress, QuestionOutcome.Yes, proof), /Not winning outcome|Carry peak absent/)
	})
})
