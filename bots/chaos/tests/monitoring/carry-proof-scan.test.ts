import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeAbiParameters, getAddress, toHex, zeroHash, type Address, type Hash, type Hex } from '../support/bot-shared.ts'
import {
	appendLocalCarryLeaf,
	applyCarryConsumption,
	carryCheckpointSnapshotId,
	carryCommitment,
	carryGameAccounting,
	createCarryGameHistory,
	currentCarryGameState,
	initializeCarryGameFromCheckpoint,
	setCarryGameAccounting,
	sparseNullifierRoot,
	type CarryGameState,
	type CarryOutcome,
	type CarryTriple,
} from '../../src/monitoring/carry-proof-index.ts'
import { CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE, CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES, carryProofScanDigest, carryProofWithdrawalsDigest, carryUpdateMatchingCommitment, carryUpdateMatchingDigest, updateCarryProofJournal, type CarryProofScanContext } from '../../src/monitoring/carry-proof-scan.ts'
import {
	appendCarryProofJournalEvents,
	CARRY_DEPOSIT_CONSUMED_SIGNATURE,
	CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD,
	CLAIM_DEPOSIT_SIGNATURE,
	compactCarryProofJournal,
	DISPUTE_STAKED_REP_DRAINED_SIGNATURE,
	FORK_CARRY_CHECKPOINT_SIGNATURE,
	loadCarryProofJournal,
	LOCAL_DEPOSIT_APPENDED_SIGNATURE,
	saveCarryProofJournal,
	SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE,
	TRUTH_AUCTION_HAIRCUT_SIGNATURE,
} from '../../src/monitoring/carry-proof-journal.ts'
import { DISCOVERY_RPC_CONCURRENCY } from '../../src/monitoring/discovery.ts'
import { eventTopic } from '../../src/operations/planning.ts'

function address(value: number): Address {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function hash(value: number): Hash {
	return toHex(BigInt(value), { size: 32 })
}

function topicAddress(value: Address) {
	return toHex(BigInt(value), { size: 32 })
}

const forker = address(900)
const sourceGame = address(100)
const sourcePool = address(101)
const childGame = address(200)
const childPool = address(201)
const grandchildGame = address(300)
const grandchildPool = address(301)
const depositor = address(1)
const walletWithoutDeposits = address(999)

type TestLog = {
	address: Address
	blockHash: Hash
	blockNumber: bigint
	data: Hex
	logIndex: number
	removed: boolean
	topics: Hash[]
	transactionHash: Hash
	transactionIndex: number
}

function canonicalLog(parameters: { address: Address; block: number; data: Hex; logIndex: number; topics: Hash[]; transaction?: number }): TestLog {
	return {
		address: parameters.address,
		blockHash: hash(parameters.block),
		blockNumber: BigInt(parameters.block),
		data: parameters.data,
		logIndex: parameters.logIndex,
		removed: false,
		topics: parameters.topics,
		transactionHash: hash(parameters.transaction ?? 10_000 + parameters.block),
		transactionIndex: parameters.transaction ?? 0,
	}
}

function stateTriple<T>(state: CarryGameState, factory: (state: CarryGameState, outcome: CarryOutcome) => T): CarryTriple<T> {
	return [factory(state, 0), factory(state, 1), factory(state, 2)]
}

function allCarryLogs() {
	const leaf = {
		amountAttoRep: 10n.toString(),
		cumulativeAmountAttoRep: 10n.toString(),
		depositor,
		outcome: 0 as const,
		parentDepositIndex: '0',
		sourceNodeId: '1',
	}
	const historyAtFork = setCarryGameAccounting(appendLocalCarryLeaf(createCarryGameHistory(sourceGame, sourcePool), leaf), {
		resolutionBalancesAttoRep: ['10', '0', '0'],
		unresolvedTotalsAttoRep: ['10', '0', '0'],
	})
	const stateAtFork = currentCarryGameState(historyAtFork)
	const accountingAtFork = carryGameAccounting(stateAtFork)
	const carryRoots = stateTriple(stateAtFork, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const nullifierRoots = stateTriple(stateAtFork, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const leafCounts = stateTriple(stateAtFork, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const checkpointInput = {
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accountingAtFork.resolutionBalancesAttoRep,
		sourceGame,
		unresolvedTotalsAttoRep: accountingAtFork.unresolvedTotalsAttoRep,
	}
	const snapshotId = carryCheckpointSnapshotId(checkpointInput)
	const consumed = applyCarryConsumption(historyAtFork, {
		amountAttoRep: leaf.amountAttoRep,
		depositor,
		outcome: 0,
		parentDepositIndex: leaf.parentDepositIndex,
		resultingUnresolvedTotalAttoRep: 0n.toString(),
		sourceNodeId: leaf.sourceNodeId,
	})
	const consumedState = currentCarryGameState(consumed.history)
	const resultingCarryRoot = carryCommitment(consumedState.outcomes[0].currentSlots).root
	const resultingNullifierRoot = sparseNullifierRoot(consumedState.outcomes[0].nullifier)
	const claimTransaction = 20_004
	const forkTransaction = 20_002
	return [
		canonicalLog({
			address: sourceGame,
			block: 1,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 0n, 10n]),
			logIndex: 0,
			topics: [eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE), toHex(1n, { size: 32 }), toHex(0n, { size: 32 }), topicAddress(depositor)],
		}),
		canonicalLog({
			address: sourceGame,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], [0, 10n, 3, 0n, resultingNullifierRoot, resultingCarryRoot]),
			logIndex: 0,
			topics: [eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE), toHex(0n, { size: 32 }), toHex(1n, { size: 32 }), topicAddress(depositor)],
			transaction: claimTransaction,
		}),
		canonicalLog({
			address: sourceGame,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], [10n, 0n, 0n, false]),
			logIndex: 1,
			topics: [eventTopic(CLAIM_DEPOSIT_SIGNATURE), topicAddress(depositor), toHex(0n, { size: 32 }), toHex(0n, { size: 32 })],
			transaction: claimTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters([{ type: 'uint256' }], [10n]),
			logIndex: 0,
			topics: [eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE), topicAddress(sourcePool), topicAddress(sourceGame)],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters(
				[{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
				[false, true, 0n, 0n, 10n, 10n, 10n, 1n, 100n, 7n, snapshotId],
			),
			logIndex: 2,
			topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(sourcePool), topicAddress(address(800))],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 3,
			data: encodeAbiParameters([{ type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }], [carryRoots, nullifierRoots, leafCounts.map(BigInt), accountingAtFork.unresolvedTotalsAttoRep.map(BigInt), accountingAtFork.resolutionBalancesAttoRep.map(BigInt)]),
			logIndex: 0,
			topics: [eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE), topicAddress(sourceGame), snapshotId],
		}),
		canonicalLog({
			address: childGame,
			block: 5,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 5n, 5n, 7n]),
			logIndex: 1,
			topics: [eventTopic(TRUTH_AUCTION_HAIRCUT_SIGNATURE)],
		}),
	].reverse()
}

function sameBlockConsumptionThenHaircutLogs() {
	const inheritedLeaf = {
		amountAttoRep: 10n.toString(),
		cumulativeAmountAttoRep: 10n.toString(),
		depositor,
		outcome: 0 as const,
		parentDepositIndex: '0',
		sourceNodeId: '1',
	}
	const sourceHistory = appendLocalCarryLeaf(createCarryGameHistory(sourceGame, sourcePool), inheritedLeaf)
	const sourceState = currentCarryGameState(sourceHistory)
	const accounting = carryGameAccounting(sourceState)
	const carryRoots = stateTriple(sourceState, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const nullifierRoots = stateTriple(sourceState, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const leafCounts = stateTriple(sourceState, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const checkpoint = {
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		snapshotId: zeroHash,
		sourceGame,
		targetGame: childGame,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	}
	checkpoint.snapshotId = carryCheckpointSnapshotId(checkpoint)
	const childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, checkpoint, sourceHistory)
	const consumed = applyCarryConsumption(childHistory, {
		amountAttoRep: inheritedLeaf.amountAttoRep,
		depositor,
		outcome: inheritedLeaf.outcome,
		parentDepositIndex: inheritedLeaf.parentDepositIndex,
		resultingUnresolvedTotalAttoRep: 0n.toString(),
		sourceNodeId: inheritedLeaf.sourceNodeId,
	})
	const consumedState = currentCarryGameState(consumed.history)
	const resultingCarryRoot = carryCommitment(consumedState.outcomes[0].currentSlots).root
	const resultingNullifierRoot = sparseNullifierRoot(consumedState.outcomes[0].nullifier)
	const forkTransaction = 40_002
	const claimTransaction = 40_004
	return [
		canonicalLog({
			address: sourceGame,
			block: 1,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 0n, 10n]),
			logIndex: 0,
			topics: [eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE), toHex(1n, { size: 32 }), toHex(0n, { size: 32 }), topicAddress(depositor)],
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters([{ type: 'uint256' }], [10n]),
			logIndex: 0,
			topics: [eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE), topicAddress(sourcePool), topicAddress(sourceGame)],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters(
				[{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
				[false, true, 0n, 0n, 10n, 10n, 10n, 1n, 10n, 0n, checkpoint.snapshotId],
			),
			logIndex: 1,
			topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(sourcePool), topicAddress(address(800))],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 3,
			data: encodeAbiParameters([{ type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }], [carryRoots, nullifierRoots, leafCounts.map(BigInt), accounting.unresolvedTotalsAttoRep.map(BigInt), accounting.resolutionBalancesAttoRep.map(BigInt)]),
			logIndex: 0,
			topics: [eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE), topicAddress(sourceGame), checkpoint.snapshotId],
		}),
		canonicalLog({
			address: childGame,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], [0, 10n, 0, 0n, resultingNullifierRoot, resultingCarryRoot]),
			logIndex: 0,
			topics: [eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE), toHex(0n, { size: 32 }), toHex(1n, { size: 32 }), topicAddress(depositor)],
			transaction: claimTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], [10n, 5n, 5n, true]),
			logIndex: 1,
			topics: [eventTopic(CLAIM_DEPOSIT_SIGNATURE), topicAddress(depositor), toHex(0n, { size: 32 }), toHex(0n, { size: 32 })],
			transaction: claimTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 5n, 5n, 7n]),
			logIndex: 2,
			topics: [eventTopic(TRUTH_AUCTION_HAIRCUT_SIGNATURE)],
			transaction: claimTransaction,
		}),
	].reverse()
}

function unconsumedCarryFixture() {
	const leaf = {
		amountAttoRep: 10n.toString(),
		cumulativeAmountAttoRep: 10n.toString(),
		depositor,
		outcome: 0 as const,
		parentDepositIndex: '0',
		sourceNodeId: '1',
	}
	const history = setCarryGameAccounting(appendLocalCarryLeaf(createCarryGameHistory(sourceGame, sourcePool), leaf), {
		resolutionBalancesAttoRep: ['10', '0', '0'],
		unresolvedTotalsAttoRep: ['10', '0', '0'],
	})
	const state = currentCarryGameState(history)
	const accounting = carryGameAccounting(state)
	const carryRoots = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const nullifierRoots = stateTriple(state, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const leafCounts = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const snapshotId = carryCheckpointSnapshotId({
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		sourceGame,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	})
	const forkTransaction = 30_002
	const logs = [
		canonicalLog({
			address: sourceGame,
			block: 1,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 0n, 10n]),
			logIndex: 0,
			topics: [eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE), toHex(1n, { size: 32 }), toHex(0n, { size: 32 }), topicAddress(depositor)],
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters([{ type: 'uint256' }], [10n]),
			logIndex: 0,
			topics: [eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE), topicAddress(sourcePool), topicAddress(sourceGame)],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters(
				[{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
				[false, true, 0n, 0n, 10n, 10n, 10n, 1n, 10n, 0n, snapshotId],
			),
			logIndex: 1,
			topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(sourcePool), topicAddress(address(800))],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 3,
			data: encodeAbiParameters([{ type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }], [carryRoots, nullifierRoots, leafCounts.map(BigInt), accounting.unresolvedTotalsAttoRep.map(BigInt), accounting.resolutionBalancesAttoRep.map(BigInt)]),
			logIndex: 0,
			topics: [eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE), topicAddress(sourceGame), snapshotId],
		}),
	]
	return { accounting, history, leafCounts, logs, nullifierRoots, snapshotId, state }
}

function recursiveUnconsumedCarryFixture() {
	const first = unconsumedCarryFixture()
	const childCheckpoint = {
		carryRoots: stateTriple(first.state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root),
		leafCounts: first.leafCounts,
		nullifierRoots: first.nullifierRoots,
		resolutionBalancesAttoRep: first.accounting.resolutionBalancesAttoRep,
		snapshotId: first.snapshotId,
		sourceGame,
		targetGame: childGame,
		unresolvedTotalsAttoRep: first.accounting.unresolvedTotalsAttoRep,
	}
	const childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, childCheckpoint, first.history)
	const childState = currentCarryGameState(childHistory)
	const accounting = carryGameAccounting(childState)
	const carryRoots = stateTriple(childState, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const nullifierRoots = stateTriple(childState, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const leafCounts = stateTriple(childState, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const checkpoint = {
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		snapshotId: zeroHash,
		sourceGame: childGame,
		targetGame: grandchildGame,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	}
	checkpoint.snapshotId = carryCheckpointSnapshotId(checkpoint)
	const history = initializeCarryGameFromCheckpoint(grandchildGame, grandchildPool, checkpoint, childHistory)
	const forkTransaction = 40_002
	const logs = [
		...first.logs,
		canonicalLog({
			address: forker,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint256' }], [10n]),
			logIndex: 0,
			topics: [eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE), topicAddress(childPool), topicAddress(childGame)],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 4,
			data: encodeAbiParameters(
				[{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
				[false, true, 0n, 0n, 10n, 10n, 10n, 1n, 10n, 0n, checkpoint.snapshotId],
			),
			logIndex: 1,
			topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(childPool), topicAddress(address(801))],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: grandchildGame,
			block: 5,
			data: encodeAbiParameters([{ type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }], [carryRoots, nullifierRoots, leafCounts.map(BigInt), accounting.unresolvedTotalsAttoRep.map(BigInt), accounting.resolutionBalancesAttoRep.map(BigInt)]),
			logIndex: 0,
			topics: [eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE), topicAddress(childGame), checkpoint.snapshotId],
		}),
	]
	return { accounting, history, leafCounts, logs, nullifierRoots, snapshotId: checkpoint.snapshotId, state: currentCarryGameState(history) }
}

function manyUnconsumedCarryFixture(depositCount: number) {
	if (!Number.isSafeInteger(depositCount) || depositCount <= CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES) {
		throw new Error('Paged carry fixture must exceed the withdrawal candidate page')
	}
	let history = createCarryGameHistory(sourceGame, sourcePool)
	const logs: TestLog[] = []
	for (let index = 0; index < depositCount; index += 1) {
		const cumulativeAmountAttoRep = BigInt(index + 1)
		const parentDepositIndex = BigInt(index)
		const sourceNodeId = BigInt(index + 1)
		history = appendLocalCarryLeaf(history, {
			amountAttoRep: 1n.toString(),
			cumulativeAmountAttoRep: cumulativeAmountAttoRep.toString(),
			depositor,
			outcome: 0,
			parentDepositIndex: parentDepositIndex.toString(),
			sourceNodeId: sourceNodeId.toString(),
		})
		logs.push(
			canonicalLog({
				address: sourceGame,
				block: 1,
				data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, parentDepositIndex, cumulativeAmountAttoRep]),
				logIndex: index,
				topics: [eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE), toHex(sourceNodeId, { size: 32 }), toHex(0n, { size: 32 }), topicAddress(depositor)],
			}),
		)
	}
	const totalAttoRep = BigInt(depositCount)
	history = setCarryGameAccounting(history, {
		resolutionBalancesAttoRep: [totalAttoRep.toString(), '0', '0'],
		unresolvedTotalsAttoRep: [totalAttoRep.toString(), '0', '0'],
	})
	const state = currentCarryGameState(history)
	const accounting = carryGameAccounting(state)
	const carryRoots = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const nullifierRoots = stateTriple(state, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const leafCounts = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const snapshotId = carryCheckpointSnapshotId({
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		sourceGame,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	})
	const forkTransaction = 40_002
	logs.push(
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters([{ type: 'uint256' }], [totalAttoRep]),
			logIndex: 0,
			topics: [eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE), topicAddress(sourcePool), topicAddress(sourceGame)],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 2,
			data: encodeAbiParameters(
				[{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
				[false, true, 0n, 0n, totalAttoRep, totalAttoRep, totalAttoRep, 1n, totalAttoRep, 0n, snapshotId],
			),
			logIndex: 1,
			topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(sourcePool), topicAddress(address(800))],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 3,
			data: encodeAbiParameters([{ type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }], [carryRoots, nullifierRoots, leafCounts.map(BigInt), accounting.unresolvedTotalsAttoRep.map(BigInt), accounting.resolutionBalancesAttoRep.map(BigInt)]),
			logIndex: 0,
			topics: [eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE), topicAddress(sourceGame), snapshotId],
		}),
	)
	return { accounting, leafCounts, logs, nullifierRoots, snapshotId, state }
}

function scanClient(logs: TestLog[], changedBlockHashes = new Map<number, Hash>()) {
	const implementation = {
		async getBlock(parameters: { blockNumber?: bigint }) {
			const number = parameters.blockNumber
			if (number === undefined) throw new Error('Block number required')
			return { hash: changedBlockHashes.get(Number(number)) ?? hash(Number(number)), number, timestamp: 1_000n }
		},
		async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
			return logs.filter(log => log.blockNumber >= (parameters.fromBlock ?? 0n) && log.blockNumber <= (parameters.toBlock ?? 1n << 64n))
		},
	}
	return new Proxy({} as CarryProofScanContext['client'], {
		get(_target, property) {
			const value = implementation[property as keyof typeof implementation]
			if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
			return value
		},
	})
}

function anchoredCandidateClient(
	fixture: Pick<ReturnType<typeof unconsumedCarryFixture>, 'accounting' | 'leafCounts' | 'logs' | 'nullifierRoots' | 'state'>,
	options: {
		bindingCapitalAttoRep?: bigint
		directClaimed?: (parentDepositIndex: bigint) => boolean
		onDirectClaimRead?: (claimSourcePool: Address, parentDepositIndex: bigint) => void
		onDirectPrincipalRead?: (sourcePool: Address) => void
		route?: { game: Address; pool: Address; sourceGame: Address; sourcePool: Address }
		routes?: readonly { game: Address; pool: Address; sourceGame: Address; sourcePool: Address }[]
		withdrawalResult?: (proof: { amountAttoRep: bigint; depositor: Address }) => { amountToWithdrawAttoRep: bigint; depositor: Address; originalDepositAmountAttoRep: bigint }
	} = {},
) {
	const base = scanClient(fixture.logs)
	const zoltar = address(700)
	const bindingCapitalAttoRep = options.bindingCapitalAttoRep ?? 10n
	const routes = options.routes ?? [options.route ?? { game: childGame, pool: childPool, sourceGame, sourcePool }]
	const outcomeStates = ([0, 1, 2] as const).map(outcome => {
		const outcomeState = fixture.state.outcomes[outcome]
		const commitment = carryCommitment(outcomeState.currentSlots)
		return {
			balanceAttoRep: BigInt(outcomeState.resolutionBalanceAttoRep),
			currentCarryRoot: commitment.root,
			currentCarryTotalAttoRep: BigInt(outcomeState.unresolvedTotalAttoRep),
			currentLeafCount: BigInt(commitment.leafCount),
			currentNullifierRoot: sparseNullifierRoot(outcomeState.nullifier),
			currentPeaks: commitment.peaks,
			inheritedUnresolvedTotalAttoRep: BigInt(outcomeState.unresolvedTotalAttoRep),
			localHeadNodeId: 0n,
			localUnresolvedTotalAttoRep: 0n,
			snapshotLeafCount: BigInt(commitment.leafCount),
			snapshotPeaks: commitment.peaks,
		}
	})
	const implementation = {
		async getBlock(parameters: { blockNumber?: bigint }) {
			return base.getBlock(parameters)
		},
		async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
			return base.getLogs(parameters)
		},
		async readContract(parameters: { address: Address; args?: readonly unknown[]; functionName: string }) {
			const { address: target, args = [], functionName } = parameters
			const poolRoute = routes.find(route => target === route.pool)
			const sourceRoute = routes.find(route => target === route.sourcePool)
			const gameRoute = routes.find(route => target === route.game)
			if (functionName === 'parent' && poolRoute !== undefined) return poolRoute.sourcePool
			if (functionName === 'escalationGame' && poolRoute !== undefined) return poolRoute.game
			if (functionName === 'escalationGame' && sourceRoute !== undefined) return sourceRoute.sourceGame
			if (functionName === 'securityPoolForker' && poolRoute !== undefined) return forker
			if (functionName === 'systemState' && poolRoute !== undefined) return 0n
			if (functionName === 'isEscalationResolved' && poolRoute !== undefined) return true
			if (functionName === 'universeId' && poolRoute !== undefined) return 1n
			if (functionName === 'zoltar' && poolRoute !== undefined) return zoltar
			if (functionName === 'securityPool' && gameRoute !== undefined) return gameRoute.pool
			if (functionName === 'forkCarrySnapshotInitialized' && gameRoute !== undefined) return true
			if (functionName === 'getFinalQuestionResolution' && gameRoute !== undefined) return 0
			if (functionName === 'getQuestionOutcome' && target === forker) return 0
			if (functionName === 'isEscalationDepositClaimedDirectly' && target === forker) {
				const claimSourcePool = args[0]
				const parentDepositIndex = args[2]
				if (typeof claimSourcePool !== 'string') throw new Error('Direct-claim source pool is not an address')
				if (typeof parentDepositIndex !== 'bigint') throw new Error('Direct-claim parent deposit index is not a bigint')
				options.onDirectClaimRead?.(getAddress(claimSourcePool), parentDepositIndex)
				return options.directClaimed?.(parentDepositIndex) ?? false
			}
			if (functionName === 'getDirectlyClaimedEscalationPrincipal' && target === forker) {
				const source = args[0]
				if (typeof source !== 'string') throw new Error('Direct-principal source pool is not an address')
				options.onDirectPrincipalRead?.(getAddress(source))
				return 0n
			}
			if (functionName === 'getOutcomeState' && gameRoute !== undefined) return outcomeStates[Number(args[0])]
			if (functionName === 'getForkCarrySnapshot' && gameRoute !== undefined) {
				return {
					carryLeafCounts: fixture.leafCounts.map(BigInt),
					carryPeaks: outcomeStates.map(state => state.currentPeaks),
					carryTotalsAttoRep: fixture.accounting.unresolvedTotalsAttoRep.map(BigInt),
					nullifierRoots: fixture.nullifierRoots,
				}
			}
			if ((functionName === 'applyInheritedClaimRetention' || functionName === 'applyInheritedSourceStorageBasis') && gameRoute !== undefined) {
				const amountAttoRep = args[0]
				if (typeof amountAttoRep !== 'bigint') throw new Error(`${functionName} amount is not a bigint`)
				return amountAttoRep
			}
			if (functionName === 'getBindingCapitalAttoRep' && gameRoute !== undefined) return bindingCapitalAttoRep
			if (functionName === 'nonDecisionThresholdAttoRep' && gameRoute !== undefined) return bindingCapitalAttoRep
			if (functionName === 'getEscalationGameEndDate' && gameRoute !== undefined) return 100n
			if (functionName === 'getForkThresholdAttoRep' && target === zoltar) return bindingCapitalAttoRep
			if (functionName === 'getForkTime' && target === zoltar) return 0n
			throw new Error(`Unexpected read ${functionName} on ${target}`)
		},
		async simulateContract(parameters: { address: Address; args?: readonly unknown[]; functionName: string }) {
			const gameRoute = routes.find(route => parameters.address === route.game)
			const poolRoute = routes.find(route => parameters.address === route.pool)
			if (gameRoute !== undefined && parameters.functionName === 'withdrawDeposit') {
				if (options.withdrawalResult !== undefined) {
					const proof = parameters.args?.[0]
					if (typeof proof !== 'object' || proof === null || !('amountAttoRep' in proof) || typeof proof.amountAttoRep !== 'bigint' || !('depositor' in proof) || typeof proof.depositor !== 'string') {
						throw new Error('Withdrawal proof simulation argument is malformed')
					}
					return { result: options.withdrawalResult({ amountAttoRep: proof.amountAttoRep, depositor: getAddress(proof.depositor) }) }
				}
				return { result: { amountToWithdrawAttoRep: 16n, depositor, originalDepositAmountAttoRep: 10n } }
			}
			if (poolRoute !== undefined && parameters.functionName === 'withdrawForkedEscalationDeposits') return { result: undefined }
			throw new Error(`Unexpected simulation ${parameters.functionName} on ${parameters.address}`)
		},
	}
	return new Proxy({} as CarryProofScanContext['client'], {
		get(_target, property) {
			const value = implementation[property as keyof typeof implementation]
			if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
			return value
		},
	})
}

function context(client: CarryProofScanContext['client'], anchorBlockNumber = 5n): CarryProofScanContext {
	return {
		anchorBlockNumber,
		chainId: 31337,
		client,
		escalationGames: [
			{ escalationGame: sourceGame, pool: sourcePool },
			{ escalationGame: childGame, pool: childPool },
		],
		expectedAnchorHash: hash(Number(anchorBlockNumber)),
		knownPools: [sourcePool, childPool],
		maxBlockSpan: 100n,
		profileId: 'profile:test',
		securityPoolForker: forker,
		startBlock: 1n,
		wallet: walletWithoutDeposits,
	}
}

describe('canonical carry proof scan', () => {
	test('strictly decodes all seven journal events in global canonical order including Invalid outcome', async () => {
		const update = await updateCarryProofJournal(context(scanClient(allCarryLogs())))
		expect(update.complete).toBeTrue()
		expect(update.withdrawals).toEqual([])
		expect(update.journal.events.map(event => event.kind)).toEqual(['local-deposit-appended', 'dispute-staked-rep-drained-at-fork', 'security-pool-fork-snapshot', 'fork-carry-checkpoint', 'carry-deposit-consumed', 'claim-deposit', 'truth-auction-haircut'])
		expect(update.journal.events[0]).toMatchObject({ outcome: 0 })
	})

	test('derives a child haircut from an inherited consumption earlier in the same canonical block', async () => {
		const update = await updateCarryProofJournal(context(scanClient(sameBlockConsumptionThenHaircutLogs()), 4n))
		expect(update.journal.events.slice(-3).map(event => [event.kind, event.position.blockNumber, event.position.logIndex])).toEqual([
			['carry-deposit-consumed', '4', '0'],
			['claim-deposit', '4', '1'],
			['truth-auction-haircut', '4', '2'],
		])
		expect(update.journal.events.at(-1)).toMatchObject({
			resultingResolutionBalancesAttoRep: ['5', '0', '0'],
			resultingUnresolvedTotalsAttoRep: ['0', '0', '0'],
		})
	})

	test('requests one topic-zero OR filter containing all seven supported carry events', async () => {
		let requestedTopics: unknown
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				return { hash: hash(Number(number)), number, timestamp: 1_000n }
			},
			async getLogs(parameters: { topics?: unknown }) {
				requestedTopics = parameters.topics
				return []
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		await updateCarryProofJournal(context(client, 1n))
		const expectedTopics = [
			eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE),
			eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE),
			eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE),
			eventTopic(CLAIM_DEPOSIT_SIGNATURE),
			eventTopic(TRUTH_AUCTION_HAIRCUT_SIGNATURE),
			eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE),
			eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE),
		]
		expect(requestedTopics).toEqual([expectedTopics])
		expect(new Set(expectedTopics)).toHaveLength(7)
	})

	test('bisects provider range-limit failures and advances only through the successful prefix', async () => {
		const requestedRanges: [bigint, bigint][] = []
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				return { hash: hash(Number(number)), number, timestamp: 1_000n }
			},
			async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
				const fromBlock = parameters.fromBlock
				const toBlock = parameters.toBlock
				if (fromBlock === undefined || toBlock === undefined) throw new Error('Bounded log range required')
				requestedRanges.push([fromBlock, toBlock])
				if (toBlock - fromBlock + 1n > 2n) throw new Error('query returned more than 10000 results')
				return []
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const update = await updateCarryProofJournal(context(client, 8n))
		expect(requestedRanges).toEqual([
			[1n, 8n],
			[1n, 4n],
			[1n, 2n],
		])
		expect(update).toMatchObject({ complete: false, fromBlock: '1', reset: false, toBlock: '2' })
		expect(update.journal.cursor).toEqual({ blockHash: hash(2), blockNumber: '2' })
	})

	test('bisects oversized successful responses without losing logs between progressing prefixes', async () => {
		const logs = Array.from({ length: 4 }, (_, index) =>
			canonicalLog({
				address: sourceGame,
				block: index + 1,
				data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, BigInt(index), BigInt(index + 1)]),
				logIndex: 0,
				topics: [eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE), toHex(BigInt(index + 1), { size: 32 }), toHex(0n, { size: 32 }), topicAddress(depositor)],
			}),
		)
		const requestedRanges: [bigint, bigint][] = []
		const base = scanClient(logs)
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				return await base.getBlock(parameters)
			},
			async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
				const fromBlock = parameters.fromBlock
				const toBlock = parameters.toBlock
				if (fromBlock === undefined || toBlock === undefined) throw new Error('Bounded log range required')
				requestedRanges.push([fromBlock, toBlock])
				if (fromBlock === 1n && toBlock === 4n) return Array.from({ length: CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE + 1 }, () => logs[0])
				return await base.getLogs(parameters)
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const first = await updateCarryProofJournal(context(client, 4n))
		expect(first).toMatchObject({ complete: false, fromBlock: '1', toBlock: '2' })
		expect(first.journal.events.map(event => event.position.blockNumber)).toEqual(['1', '2'])
		const second = await updateCarryProofJournal({ ...context(client, 4n), previous: first.journal })
		expect(second).toMatchObject({ complete: true, fromBlock: '3', toBlock: '4' })
		expect(second.journal.events.map(event => event.position.blockNumber)).toEqual(['1', '2', '3', '4'])
		expect(requestedRanges).toEqual([
			[1n, 4n],
			[1n, 2n],
			[3n, 4n],
		])
	})

	test('fails closed when one block alone exceeds the log-response safety limit', async () => {
		const sample = allCarryLogs()[0]
		if (sample === undefined) throw new Error('Carry log fixture missing')
		const base = scanClient([])
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				return await base.getBlock(parameters)
			},
			async getLogs() {
				return Array.from({ length: CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE + 1 }, () => sample)
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		await expect(updateCarryProofJournal(context(client, 1n))).rejects.toThrow(`block 1 exceeds its ${CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE.toString()}-log response safety limit`)
	})

	test('persists an empty origin scan and resumes the next canonical block without a false reorg', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-scan-resume-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const first = await updateCarryProofJournal(context(scanClient([]), 1n))
			expect(first.journal).toMatchObject({ cursor: { blockHash: hash(1), blockNumber: '1' }, scanStarted: true })
			await saveCarryProofJournal(runtimeStatePath, first.journal)
			const loaded = await loadCarryProofJournal(runtimeStatePath, {
				chainId: 31337,
				initialCursor: { blockHash: hash(1), blockNumber: '1' },
				profileId: 'profile:test',
				securityPoolForker: forker,
				startBlock: '1',
			})
			const requestedRanges: [bigint, bigint][] = []
			const base = scanClient([])
			const implementation = {
				async getBlock(parameters: { blockNumber?: bigint }) {
					return await base.getBlock(parameters)
				},
				async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
					const fromBlock = parameters.fromBlock
					const toBlock = parameters.toBlock
					if (fromBlock === undefined || toBlock === undefined) throw new Error('Bounded log range required')
					requestedRanges.push([fromBlock, toBlock])
					return []
				},
			}
			const client = new Proxy({} as CarryProofScanContext['client'], {
				get(_target, property) {
					const value = implementation[property as keyof typeof implementation]
					if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
					return value
				},
			})
			const resumed = await updateCarryProofJournal({ ...context(client, 2n), previous: loaded })
			expect(requestedRanges).toEqual([[2n, 2n]])
			expect(resumed).toMatchObject({ complete: true, fromBlock: '2', reset: false, toBlock: '2' })
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('automatically compacts a whole-block backfill batch before canonical catch-up completes', async () => {
		const logs = Array.from({ length: CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD }, (_, logIndex) =>
			canonicalLog({
				address: sourceGame,
				block: 1,
				data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, BigInt(logIndex), BigInt(logIndex + 1)]),
				logIndex,
				topics: [eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE), toHex(BigInt(logIndex + 1), { size: 32 }), toHex(0n, { size: 32 }), topicAddress(depositor)],
			}),
		)
		const update = await updateCarryProofJournal({ ...context(scanClient(logs), 2n), maxBlockSpan: 1n })
		expect(update.complete).toBeFalse()
		expect(update.journal.events).toEqual([])
		expect(update.journal.checkpoint).toMatchObject({ cutoff: { blockHash: hash(1), blockNumber: '1' }, prefixEventCount: CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD.toString() })
	})

	test('bounds each backfill batch and resets to the inclusive origin after a cursor reorg', async () => {
		const first = await updateCarryProofJournal({ ...context(scanClient([]), 2n), maxBlockSpan: 2n })
		expect(first).toMatchObject({ complete: true, fromBlock: '1', toBlock: '2' })
		const changedHashes = new Map([[2, hash(999)]])
		const reset = await updateCarryProofJournal({ ...context(scanClient([], changedHashes), 3n), expectedAnchorHash: hash(3), maxBlockSpan: 2n, previous: first.journal })
		expect(reset).toMatchObject({ complete: false, fromBlock: '1', reset: true, toBlock: '2' })
	})

	test('rebuilds from protocol start when canonical history changes behind a compacted cutoff', async () => {
		const fixture = unconsumedCarryFixture()
		const indexed = await updateCarryProofJournal(context(scanClient(fixture.logs), 3n))
		const compacted = compactCarryProofJournal(indexed.journal, {
			[childGame.toLowerCase()]: { inheritedTotalsAttoRep: fixture.accounting.unresolvedTotalsAttoRep, localTotalsAttoRep: ['0', '0', '0'] },
		})
		const advanced = appendCarryProofJournalEvents(compacted, [], { blockHash: hash(4), blockNumber: '4' })
		const changedHashes = new Map([[3, hash(999)]])
		const reset = await updateCarryProofJournal({ ...context(scanClient([], changedHashes), 5n), previous: advanced })
		expect(reset).toMatchObject({ complete: true, fromBlock: '1', reset: true, toBlock: '5' })
		expect(reset.journal.checkpoint).toBeUndefined()
	})

	test('rejects unsupported outcomes, malformed lengths, duplicate logs, and wrong emitters', async () => {
		const valid = allCarryLogs().find(log => log.topics[0] === eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE))
		if (valid === undefined) throw new Error('Local fixture missing')
		const invalidOutcome = { ...valid, topics: [valid.topics[0] ?? hash(0), valid.topics[1] ?? hash(0), toHex(3n, { size: 32 }), valid.topics[3] ?? hash(0)] }
		await expect(updateCarryProofJournal(context(scanClient([invalidOutcome])))).rejects.toThrow('must be Invalid, Yes, or No')
		await expect(updateCarryProofJournal(context(scanClient([{ ...valid, data: '0x' }])))).rejects.toThrow('data bytes')
		await expect(updateCarryProofJournal(context(scanClient([valid, valid])))).rejects.toThrow('duplicate log')
		await expect(updateCarryProofJournal(context(scanClient([{ ...valid, address: forker }])))).rejects.toThrow('Escalation-game carry event')
	})

	test('rejects distinct transaction hashes sharing one block transaction index', async () => {
		const valid = allCarryLogs().find(log => log.topics[0] === eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE))
		if (valid === undefined) throw new Error('Local fixture missing')
		const first = canonicalLog({ address: valid.address, block: 2, data: valid.data, logIndex: 0, topics: valid.topics })
		const second = { ...first, logIndex: 1, transactionHash: hash(999) }
		await expect(updateCarryProofJournal(context(scanClient([first, second]), 2n))).rejects.toThrow('distinct transaction hashes at block transaction position 2:0')
	})

	test('rejects a single log whose declared block hash is not canonical', async () => {
		const valid = allCarryLogs().find(log => log.topics[0] === eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE))
		if (valid === undefined) throw new Error('Local fixture missing')
		const declared = canonicalLog({ address: valid.address, block: 2, data: valid.data, logIndex: 0, topics: valid.topics })
		await expect(updateCarryProofJournal(context(scanClient([declared], new Map([[2, hash(999)]])), 3n))).rejects.toThrow('block 2 hash does not match the expected canonical hash')
	})

	test('rejects when the canonical anchor changes during a completed scan', async () => {
		const base = scanClient([])
		let anchorReads = 0
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				if (parameters.blockNumber === 2n) {
					anchorReads += 1
					if (anchorReads === 2) return { hash: hash(999), number: 2n, timestamp: 1_000n }
				}
				return await base.getBlock(parameters)
			},
			async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
				return await base.getLogs(parameters)
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		await expect(updateCarryProofJournal(context(client, 2n))).rejects.toThrow('block 2 hash does not match the expected canonical hash')
		expect(anchorReads).toBe(2)
	})

	test('propagates a previous-cursor transport failure instead of treating it as a reorg', async () => {
		const previous = await updateCarryProofJournal(context(scanClient([]), 1n))
		const base = scanClient([])
		let startBlockReads = 0
		let logReads = 0
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				if (parameters.blockNumber === 1n) {
					startBlockReads += 1
					if (startBlockReads === 2) throw new Error('RPC transport unavailable')
				}
				return await base.getBlock(parameters)
			},
			async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
				logReads += 1
				return await base.getLogs(parameters)
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		await expect(updateCarryProofJournal({ ...context(client, 2n), previous: previous.journal })).rejects.toThrow('RPC transport unavailable')
		expect(logReads).toBe(0)
	})

	test('bounds concurrent log-block authentication and drains in-flight probes before rejecting', async () => {
		const valid = allCarryLogs().find(log => log.topics[0] === eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE))
		if (valid === undefined) throw new Error('Local fixture missing')
		const authenticationLogCount = DISCOVERY_RPC_CONCURRENCY + 1
		const logs = Array.from({ length: authenticationLogCount }, (_, index) =>
			canonicalLog({
				address: valid.address,
				block: index + 2,
				data: valid.data,
				logIndex: 0,
				topics: valid.topics,
			}),
		)
		let activeAuthenticationProbes = 0
		let authenticatedCalls = 0
		let maximumActiveAuthenticationProbes = 0
		let resolveAuthenticationStarted: (() => void) | undefined
		const authenticationStarted = new Promise<void>(resolve => {
			resolveAuthenticationStarted = resolve
		})
		let releaseAuthenticationProbes: (() => void) | undefined
		const authenticationRelease = new Promise<void>(resolve => {
			releaseAuthenticationProbes = resolve
		})
		const anchorBlockNumber = BigInt(authenticationLogCount + 2)
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				const number = parameters.blockNumber
				if (number === undefined) throw new Error('Block number required')
				if (number < 2n || number >= anchorBlockNumber) return { hash: hash(Number(number)), number, timestamp: 1_000n }
				authenticatedCalls += 1
				activeAuthenticationProbes += 1
				maximumActiveAuthenticationProbes = Math.max(maximumActiveAuthenticationProbes, activeAuthenticationProbes)
				if (authenticatedCalls === DISCOVERY_RPC_CONCURRENCY) resolveAuthenticationStarted?.()
				try {
					await authenticationStarted
					if (number === 2n) throw new Error('canonical probe failed')
					await authenticationRelease
					return { hash: hash(Number(number)), number, timestamp: 1_000n }
				} finally {
					activeAuthenticationProbes -= 1
				}
			},
			async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
				return logs.filter(log => log.blockNumber >= (parameters.fromBlock ?? 0n) && log.blockNumber <= (parameters.toBlock ?? 1n << 64n))
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		const completion = updateCarryProofJournal(context(client, anchorBlockNumber))
		await authenticationStarted
		let settled = false
		void completion.then(
			() => {
				settled = true
			},
			() => {
				settled = true
			},
		)
		await Promise.resolve()
		await Promise.resolve()
		expect(settled).toBeFalse()
		expect(maximumActiveAuthenticationProbes).toBe(DISCOVERY_RPC_CONCURRENCY)
		releaseAuthenticationProbes?.()
		await expect(completion).rejects.toThrow('canonical probe failed')
		expect(activeAuthenticationProbes).toBe(0)
		expect(authenticatedCalls).toBe(DISCOVERY_RPC_CONCURRENCY)
	})

	test('rejects conflicting local log hashes before authenticating that block', async () => {
		const valid = allCarryLogs().find(log => log.topics[0] === eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE))
		if (valid === undefined) throw new Error('Local fixture missing')
		const first = canonicalLog({ address: valid.address, block: 2, data: valid.data, logIndex: 0, topics: valid.topics })
		const logs = [first, { ...first, blockHash: hash(999) }]
		const base = scanClient(logs)
		let conflictingBlockProbes = 0
		const implementation = {
			async getBlock(parameters: { blockNumber?: bigint }) {
				if (parameters.blockNumber === 2n) conflictingBlockProbes += 1
				return await base.getBlock(parameters)
			},
			async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
				return await base.getLogs(parameters)
			},
		}
		const client = new Proxy({} as CarryProofScanContext['client'], {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected method ${String(property)}`)
				return value
			},
		})
		await expect(updateCarryProofJournal(context(client, 3n))).rejects.toThrow('conflicting block hashes for block 2')
		expect(conflictingBlockProbes).toBe(0)
	})

	test('selects the endpoint candidate matching only the quorum digest', async () => {
		const first = await updateCarryProofJournal(context(scanClient([]), 1n))
		const second = { ...first }
		const other = { ...first, digest: hash(700) }
		expect(carryUpdateMatchingDigest([other, first, second], first.digest).journal).toEqual(first.journal)
		expect(() => carryUpdateMatchingDigest([other], first.digest)).toThrow('No carry proof scan candidate')
		const withdrawal = {
			amountAttoRep: 1n.toString(),
			amountToWithdrawAttoRep: 1n.toString(),
			burnAmountAttoRep: 0n.toString(),
			claimSourceGame: sourceGame,
			depositor,
			game: childGame,
			outcome: 0 as const,
			parentDepositIndex: '0',
			pool: childPool,
			preflightExpectedResult: '0x' as const,
			proof: { amountAttoRep: 1n.toString(), cumulativeAmountAttoRep: 1n.toString(), depositor, leafIndex: '0', merkleMountainRangePeakIndex: '0', merkleMountainRangeSiblings: [], nullifierSiblings: [], parentDepositIndex: '0', sourceNodeId: '1' },
			resultingCarryRoot: hash(1),
			resultingNullifierRoot: hash(2),
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			snapshotId: hash(3),
			sourceGame,
			sourceNodeId: '1',
			sourcePool,
		}
		const divergent = { ...first, digest: carryProofScanDigest(first.journal, [withdrawal]), withdrawals: [withdrawal], withdrawalsDigest: carryProofWithdrawalsDigest([withdrawal]) }
		expect(divergent.journalDigest).toBe(first.journalDigest)
		expect(divergent.withdrawalsDigest).not.toBe(first.withdrawalsDigest)
		expect(() => carryUpdateMatchingCommitment([divergent], { journalDigest: first.journalDigest, withdrawalsDigest: first.withdrawalsDigest })).toThrow('journal and withdrawal digests')
		expect(carryUpdateMatchingCommitment([divergent, first], { journalDigest: first.journalDigest, withdrawalsDigest: first.withdrawalsDigest })).toBe(first)
	})

	test('verifies and simulates an exact anchored Invalid-outcome proof candidate', async () => {
		const fixture = unconsumedCarryFixture()
		const indexed = await updateCarryProofJournal(context(scanClient(fixture.logs), 3n))
		const update = await updateCarryProofJournal({ ...context(anchoredCandidateClient(fixture), 3n), previous: indexed.journal, wallet: depositor })
		expect(update.withdrawals).toHaveLength(1)
		expect(update.withdrawals[0]).toMatchObject({
			amountToWithdrawAttoRep: 16n.toString(),
			burnAmountAttoRep: 4n.toString(),
			claimSourceGame: sourceGame,
			depositor,
			game: childGame,
			outcome: 0,
			parentDepositIndex: '0',
			pool: childPool,
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			snapshotId: fixture.snapshotId,
			sourceGame,
			sourcePool,
		})
		expect(update.withdrawals[0]?.proof.nullifierSiblings).toHaveLength(64)
	})

	test('rejects an anchored direct-claim bit missing from the canonical claim journal', async () => {
		const fixture = unconsumedCarryFixture()
		const indexed = await updateCarryProofJournal(context(scanClient(fixture.logs), 3n))
		await expect(updateCarryProofJournal({ ...context(anchoredCandidateClient(fixture, { directClaimed: () => true }), 3n), previous: indexed.journal, wallet: depositor })).rejects.toThrow('directly claimed on-chain but absent from the canonical claim journal')
	})

	test('authenticates a recursively inherited leaf against its original claim pool while accounting against its immediate source pool', async () => {
		const fixture = recursiveUnconsumedCarryFixture()
		const recursiveContext = (client: CarryProofScanContext['client']): CarryProofScanContext => ({
			...context(client, 5n),
			escalationGames: [
				{ escalationGame: sourceGame, pool: sourcePool },
				{ escalationGame: childGame, pool: childPool },
				{ escalationGame: grandchildGame, pool: grandchildPool },
			],
			knownPools: [sourcePool, childPool, grandchildPool],
		})
		const indexed = await updateCarryProofJournal(recursiveContext(scanClient(fixture.logs)))
		const claimPools: Address[] = []
		const principalPools: Address[] = []
		const client = anchoredCandidateClient(fixture, {
			onDirectClaimRead(claimPool) {
				claimPools.push(claimPool)
			},
			onDirectPrincipalRead(principalPool) {
				principalPools.push(principalPool)
			},
			routes: [
				{ game: childGame, pool: childPool, sourceGame, sourcePool },
				{ game: grandchildGame, pool: grandchildPool, sourceGame: childGame, sourcePool: childPool },
			],
		})
		const update = await updateCarryProofJournal({ ...recursiveContext(client), previous: indexed.journal, wallet: depositor })
		expect(claimPools).toEqual([sourcePool, sourcePool])
		expect(principalPools).toEqual([sourcePool, sourcePool, sourcePool, childPool, childPool, childPool])
		expect(update.withdrawalPresence.find(candidate => candidate.game === grandchildGame)).toEqual({
			claimSourceGame: sourceGame,
			game: grandchildGame,
			outcome: 0,
			parentDepositIndex: '0',
			pool: grandchildPool,
			sourceGame: childGame,
			sourceNodeId: '1',
		})
		expect(update.withdrawals.find(candidate => candidate.game === grandchildGame)).toMatchObject({ claimSourceGame: sourceGame, game: grandchildGame, sourceGame: childGame, sourcePool: childPool })
	})

	test('rotates bounded 32-proof pages fairly while retaining lightweight presence for every candidate', async () => {
		const candidateCount = CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES + 8
		const fixture = manyUnconsumedCarryFixture(candidateCount)
		const indexed = await updateCarryProofJournal(context(scanClient(fixture.logs), 3n))
		const firstDirectReads: bigint[] = []
		const firstClient = anchoredCandidateClient(fixture, {
			bindingCapitalAttoRep: BigInt(candidateCount),
			onDirectClaimRead(_claimSourcePool, parentDepositIndex) {
				firstDirectReads.push(parentDepositIndex)
			},
			withdrawalResult(proof) {
				return { amountToWithdrawAttoRep: proof.amountAttoRep, depositor: proof.depositor, originalDepositAmountAttoRep: proof.amountAttoRep }
			},
		})
		const first = await updateCarryProofJournal({ ...context(firstClient, 3n), previous: indexed.journal, wallet: depositor })
		expect(first.withdrawalCandidateCount).toBe(candidateCount)
		expect(first.withdrawalPresence).toHaveLength(candidateCount)
		expect(first.withdrawals).toHaveLength(CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES)
		expect(firstDirectReads).toEqual([...Array.from({ length: 24 }, (_, index) => BigInt(index + 16)), ...Array.from({ length: 8 }, (_, index) => BigInt(index))])

		const secondDirectReads: bigint[] = []
		const secondClient = anchoredCandidateClient(fixture, {
			bindingCapitalAttoRep: BigInt(candidateCount),
			onDirectClaimRead(_claimSourcePool, parentDepositIndex) {
				secondDirectReads.push(parentDepositIndex)
			},
			withdrawalResult(proof) {
				return { amountToWithdrawAttoRep: proof.amountAttoRep, depositor: proof.depositor, originalDepositAmountAttoRep: proof.amountAttoRep }
			},
		})
		const second = await updateCarryProofJournal({ ...context(secondClient, 4n), previous: first.journal, wallet: depositor })
		expect(second.withdrawalCandidateCount).toBe(candidateCount)
		expect(second.withdrawalPresence).toEqual(first.withdrawalPresence)
		expect(second.withdrawals).toHaveLength(CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES)
		expect(secondDirectReads).toEqual(Array.from({ length: 32 }, (_, index) => BigInt(index + 8)))
		expect(new Set([...firstDirectReads, ...secondDirectReads])).toEqual(new Set(Array.from({ length: candidateCount }, (_, index) => BigInt(index))))
	})

	test('derives identical anchored withdrawal calldata proofs from a compacted prefix and suffix replay', async () => {
		const fixture = unconsumedCarryFixture()
		const indexed = await updateCarryProofJournal(context(scanClient(fixture.logs), 3n))
		const client = anchoredCandidateClient(fixture)
		const full = await updateCarryProofJournal({ ...context(client, 3n), previous: indexed.journal, wallet: depositor })
		const compacted = compactCarryProofJournal(indexed.journal, {
			[childGame.toLowerCase()]: {
				inheritedTotalsAttoRep: fixture.accounting.unresolvedTotalsAttoRep,
				localTotalsAttoRep: ['0', '0', '0'],
			},
		})
		const fromCheckpoint = await updateCarryProofJournal({ ...context(client, 3n), previous: compacted, wallet: depositor })
		expect(fromCheckpoint.withdrawals).toEqual(full.withdrawals)
		expect(fromCheckpoint.withdrawalsDigest).toBe(full.withdrawalsDigest)
		expect(fromCheckpoint.withdrawals[0]?.proof).toEqual(full.withdrawals[0]?.proof)
	})
})
