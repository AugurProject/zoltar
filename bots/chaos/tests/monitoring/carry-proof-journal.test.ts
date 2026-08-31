import { describe, expect, test } from 'bun:test'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '../support/bot-shared.ts'
import type { CanonicalUintString } from '../../src/core/units.ts'
import {
	appendCarryLeafToAccumulator,
	appendLocalCarryLeaf,
	applyCarryConsumptionToAccumulator,
	applyCarryConsumption,
	carryCheckpointSnapshotId,
	carryCommitment,
	carryGameAccounting,
	carryProofAccumulatorLocalConsumptionRoots,
	CARRY_MMR_MAXIMUM_PEAKS,
	createCarryProofAccumulator,
	createCarryGameHistory,
	currentCarryGameState,
	initializeCarryGameFromCheckpoint,
	setCarryGameAccounting,
	sparseNullifierRoot,
	type CarryCheckpoint,
	type CarryGameHistory,
	type CarryGameState,
	type CarryLeaf,
	type CarryOutcome,
	type CarryTriple,
} from '../../src/monitoring/carry-proof-index.ts'
import {
	appendCarryProofJournalEvents,
	appendCarryProofJournalEventsWithCompaction,
	archiveCarryProofJournalForProfileReset,
	assessCarryJournalReorg,
	carryProofJournalDigest,
	carryProofJournalSegmentDirectory,
	carryProofJournalSidecarPath,
	CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES,
	CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST,
	CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS,
	CARRY_PROOF_JOURNAL_MAXIMUM_SEGMENTS,
	CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS,
	CARRY_PROOF_JOURNAL_SEGMENT_BYTES,
	CARRY_PROOF_REPLAY_GAME_BASE_COST,
	CARRY_PROOF_REPLAY_NULLIFIER_COST,
	CARRY_PROOF_REPLAY_SLOT_COST,
	compactCarryProofJournal,
	createCarryProofJournal,
	deriveTruthAuctionHaircutJournalEventAccounting,
	injectCarryProofJournalPostCommitFaultForTesting,
	loadCarryProofJournal,
	parseCarryProofJournal,
	replayCarryProofJournal,
	saveCarryProofJournal,
	serializedCarryProofJournal,
	validateCarryProofJournal,
	validateCarryProofJournalSidecarIfPresent,
	type CarryJournalPosition,
	type CarryJournalRawAccounting,
	type CarryProofJournal,
	type CarryProofJournalEvent,
	type CarryProofJournalIdentity,
	type CarryDepositConsumedJournalEvent,
	type ClaimDepositJournalEvent,
	type DisputeStakedRepDrainedJournalEvent,
	type ForkCarryCheckpointJournalEvent,
	type LocalDepositAppendedJournalEvent,
	type SecurityPoolForkSnapshotJournalEvent,
	type TruthAuctionHaircutJournalEvent,
} from '../../src/monitoring/carry-proof-journal.ts'

function address(value: number): Address {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function hash(value: string): Hash {
	return keccak256(toHex(value))
}

const forker = address(900)
const sourceGame = address(100)
const sourcePool = address(101)
const childGame = address(200)
const childPool = address(201)
const grandchildGame = address(300)
const grandchildPool = address(301)
const depositor = address(1)

function blockHash(block: number) {
	return hash(`block-${block.toString()}`)
}

function position(block: number, logIndex: number, transaction = `tx-${block.toString()}`, transactionIndex = 0): CarryJournalPosition {
	return {
		blockHash: blockHash(block),
		blockNumber: block.toString(),
		logIndex: logIndex.toString(),
		transactionHash: hash(transaction),
		transactionIndex: transactionIndex.toString(),
	}
}

function leaf(parameters: { amount: bigint; cumulative: bigint; outcome?: CarryOutcome; parentDepositIndex: bigint; sourceNodeId: bigint }): CarryLeaf {
	return {
		amountAttoRep: parameters.amount.toString(),
		cumulativeAmountAttoRep: parameters.cumulative.toString(),
		depositor,
		outcome: parameters.outcome ?? 1,
		parentDepositIndex: parameters.parentDepositIndex.toString(),
		sourceNodeId: parameters.sourceNodeId.toString(),
	}
}

function localEvent(game: Address, pool: Address, value: CarryLeaf, block: number, logIndex = 0): LocalDepositAppendedJournalEvent {
	return {
		amountAttoRep: value.amountAttoRep,
		cumulativeAmountAttoRep: value.cumulativeAmountAttoRep,
		depositor: value.depositor,
		emitter: game,
		kind: 'local-deposit-appended',
		nodeId: value.sourceNodeId,
		outcome: value.outcome,
		parentDepositIndex: value.parentDepositIndex,
		pool,
		position: position(block, logIndex),
		signature: 'LocalDepositAppended(uint256,uint8,address,uint256,uint256,uint256)',
	}
}

function stateTriple<T>(state: CarryGameState, factory: (state: CarryGameState, outcome: CarryOutcome) => T): CarryTriple<T> {
	return [factory(state, 0), factory(state, 1), factory(state, 2)]
}

function checkpointFor(state: CarryGameState, targetGame: Address, source: Address): CarryCheckpoint {
	const carryRoots = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const leafCounts = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const nullifierRoots = stateTriple(state, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const accounting = carryGameAccounting(state)
	const commitment = {
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		sourceGame: source,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	}
	return {
		...commitment,
		snapshotId: carryCheckpointSnapshotId(commitment),
		targetGame,
	}
}

function forkDrain(checkpoint: CarryCheckpoint, block: number, pool = sourcePool, game = sourceGame): DisputeStakedRepDrainedJournalEvent {
	return {
		amountAttoRep: checkpoint.unresolvedTotalsAttoRep.reduce((total, amount) => total + BigInt(amount), 0n).toString(),
		emitter: forker,
		kind: 'dispute-staked-rep-drained-at-fork',
		pool,
		position: position(block, 0, `fork-${block.toString()}`),
		signature: 'DisputeStakedRepDrainedAtFork(address,address,uint256)',
		sourceGame: game,
	}
}

function forkSnapshot(checkpoint: CarryCheckpoint, block: number, pool = sourcePool): SecurityPoolForkSnapshotJournalEvent {
	const disputeStakedRepAtForkAttoRep = checkpoint.unresolvedTotalsAttoRep.reduce((total, amount) => total + BigInt(amount), 0n).toString()
	return {
		auctionableAttoRepAtFork: 0n.toString(),
		emitter: forker,
		escalationChildRepAtForkAttoRep: 0n.toString(),
		escalationElapsedAtFork: '0',
		escalationNonDecisionThresholdAtForkAttoRep: 100n.toString(),
		escalationSnapshotId: checkpoint.snapshotId,
		escalationSourceRepAtForkAttoRep: disputeStakedRepAtForkAttoRep,
		escalationStartBondAtForkAttoRep: 1n.toString(),
		kind: 'security-pool-fork-snapshot',
		migrationProxy: address(800 + block),
		ownFork: true,
		pool,
		position: position(block, 2, `fork-${block.toString()}`),
		settlementCollateralAtForkAttoEth: 0n.toString(),
		signature: 'SecurityPoolForkSnapshot(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)',
		totalPoolHeldRepAtForkAttoRep: 0n.toString(),
		unresolvedEscalation: true,
	}
}

function checkpointEvent(checkpoint: CarryCheckpoint, targetPool: Address, sourcePoolValue: Address, block: number): ForkCarryCheckpointJournalEvent {
	return {
		carryRoots: checkpoint.carryRoots,
		emitter: checkpoint.targetGame,
		kind: 'fork-carry-checkpoint',
		leafCounts: checkpoint.leafCounts,
		nullifierRoots: checkpoint.nullifierRoots,
		pool: targetPool,
		position: position(block, 0),
		resolutionBalancesAttoRep: checkpoint.resolutionBalancesAttoRep,
		signature: 'ForkCarryCheckpoint(address,bytes32,bytes32[3],bytes32[3],uint256[3],uint256[3],uint256[3])',
		snapshotId: checkpoint.snapshotId,
		sourceGame: checkpoint.sourceGame,
		sourcePool: sourcePoolValue,
		unresolvedTotalsAttoRep: checkpoint.unresolvedTotalsAttoRep,
	}
}

const identity: CarryProofJournalIdentity = {
	chainId: 1,
	initialCursor: { blockHash: blockHash(1), blockNumber: '1' },
	profileId: 'profile:test',
	securityPoolForker: forker,
	startBlock: '1',
}

const segmentGeneration = '00000000-0000-4000-8000-000000000000'

function segmentDescriptor(index: number, bytes = CARRY_PROOF_JOURNAL_SEGMENT_BYTES) {
	return {
		bytes: bytes.toString(),
		checksum: zeroHash,
		file: `segment.${segmentGeneration}.${index.toString().padStart(8, '0')}.part`,
	}
}

function stableJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableJsonValue)
	if (typeof value !== 'object' || value === null) return value
	const sorted: Record<string, unknown> = {}
	for (const [key, entry] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) sorted[key] = stableJsonValue(entry)
	return sorted
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectRecord(value: unknown, label: string) {
	if (!isObjectRecord(value)) throw new Error(`${label} must be an object`)
	return value
}

function segmentedManifestContents(value: Record<string, unknown>) {
	const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'manifestChecksum'))
	const stablePayload = JSON.stringify(stableJsonValue(payload))
	if (stablePayload === undefined) throw new Error('Segmented manifest payload is not JSON serializable')
	return `${JSON.stringify({ ...payload, manifestChecksum: keccak256(toHex(stablePayload)) }, undefined, 2)}\n`
}

function segmentedManifest(parameters: { payloadBytes: number; residentRecords: number; segmentDirectory?: string; segments: ReturnType<typeof segmentDescriptor>[] }) {
	const payload = {
		format: 'zoltar-chaos-carry-proof-journal-segmented-v3',
		identity: {
			chainId: identity.chainId,
			profileId: identity.profileId,
			securityPoolForker: identity.securityPoolForker,
			startBlock: identity.startBlock,
		},
		payloadBytes: parameters.payloadBytes.toString(),
		payloadChecksum: zeroHash,
		residentRecords: parameters.residentRecords.toString(),
		segmentCount: parameters.segments.length.toString(),
		segmentDirectory: parameters.segmentDirectory ?? `carry-journal-${'0'.repeat(64)}-segments-v3`,
		segments: parameters.segments,
	}
	return segmentedManifestContents(payload)
}

function journal(events: readonly CarryProofJournalEvent[], cursorBlock: number): CarryProofJournal {
	return appendCarryProofJournalEvents(createCarryProofJournal(identity), events, {
		blockHash: blockHash(cursorBlock),
		blockNumber: cursorBlock.toString(),
	})
}

function sourceFixture() {
	const first = leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n })
	const second = leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n })
	let history = createCarryGameHistory(sourceGame, sourcePool)
	history = appendLocalCarryLeaf(history, first)
	history = appendLocalCarryLeaf(history, second)
	return { events: [localEvent(sourceGame, sourcePool, first, 1), localEvent(sourceGame, sourcePool, second, 1, 1)], first, history, second }
}

function checkpointJournalFixture() {
	const source = sourceFixture()
	const checkpoint = checkpointFor(currentCarryGameState(source.history), childGame, sourceGame)
	const events: CarryProofJournalEvent[] = [...source.events, forkDrain(checkpoint, 2), forkSnapshot(checkpoint, 2), checkpointEvent(checkpoint, childPool, sourcePool, 3)]
	return { checkpoint, events, journal: journal(events, 3), source }
}

function consumptionEvent(
	history: CarryGameHistory,
	parameters: {
		amountAttoRep: CanonicalUintString
		block: number
		parentDepositIndex: string
		reason?: 0 | 1 | 2 | 3 | 4
		resultingUnresolvedTotalAttoRep: CanonicalUintString
		sourceNodeId: string
		transaction?: string
	},
) {
	const transaction = parameters.transaction ?? `consume-${parameters.block.toString()}`
	const result = applyCarryConsumption(history, {
		amountAttoRep: parameters.amountAttoRep,
		depositor,
		outcome: 1,
		parentDepositIndex: parameters.parentDepositIndex,
		resultingUnresolvedTotalAttoRep: parameters.resultingUnresolvedTotalAttoRep,
		sourceNodeId: parameters.sourceNodeId,
	})
	const state = currentCarryGameState(result.history)
	const event: CarryDepositConsumedJournalEvent = {
		amountAttoRep: parameters.amountAttoRep,
		depositor,
		emitter: history.game,
		kind: 'carry-deposit-consumed',
		outcome: 1,
		parentDepositIndex: parameters.parentDepositIndex,
		pool: history.pool,
		position: position(parameters.block, 0, transaction),
		reason: parameters.reason ?? (result.kind === 'inherited' ? 0 : 3),
		resultingCarryRoot: carryCommitment(state.outcomes[1].currentSlots).root,
		resultingNullifierRoot: sparseNullifierRoot(state.outcomes[1].nullifier),
		resultingUnresolvedTotalAttoRep: parameters.resultingUnresolvedTotalAttoRep,
		signature: 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)',
		sourceNodeId: parameters.sourceNodeId,
	}
	return { event, history: result.history }
}

function claimEvent(consumption: CarryDepositConsumedJournalEvent, block: number, transferredRep = false): ClaimDepositJournalEvent {
	return {
		amountToWithdrawAttoRep: consumption.amountAttoRep,
		burnAmountAttoRep: 0n.toString(),
		depositor: consumption.depositor,
		emitter: consumption.emitter,
		kind: 'claim-deposit',
		originalDepositAmountAttoRep: consumption.amountAttoRep,
		outcome: consumption.outcome,
		parentDepositIndex: consumption.parentDepositIndex,
		pool: consumption.pool,
		position: position(block, 1, consumption.position.transactionHash === hash(`consume-${block.toString()}`) ? `consume-${block.toString()}` : `direct-${block.toString()}`),
		signature: 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)',
		transferredRep,
	}
}

function rawAccounting(inherited: CarryTriple<string>, local: CarryTriple<string>): CarryJournalRawAccounting {
	return { inheritedTotalsAttoRep: inherited, localTotalsAttoRep: local }
}

async function probeCarryJournalPeakMemoryGrowth(runtimeStatePath: string) {
	const moduleUrl = new URL('../../src/monitoring/carry-proof-journal.ts', import.meta.url).href
	const probe = Bun.spawn(
		[
			process.execPath,
			'--eval',
			`import { carryProofJournalDigest, createCarryProofJournalIncrementalReplay, loadCarryProofJournal, replayCarryProofJournal, saveCarryProofJournal } from ${JSON.stringify(moduleUrl)}
const runtimeStatePath = process.env['CHAOS_CARRY_MEMORY_PROBE_PATH']
if (runtimeStatePath === undefined) throw new Error('Carry memory probe state path is missing')
const baselineResidentSetKilobytes = process.resourceUsage().maxRSS
const journal = await loadCarryProofJournal(runtimeStatePath, ${JSON.stringify(identity)})
const expectedCurrentRevision = carryProofJournalDigest(journal)
const incremental = createCarryProofJournalIncrementalReplay(journal)
incremental.release()
replayCarryProofJournal(journal, undefined, 0)
await saveCarryProofJournal(runtimeStatePath, journal, { expectedCurrentRevision })
console.log(JSON.stringify({ baselineResidentSetKilobytes, maximumResidentSetKilobytes: process.resourceUsage().maxRSS }))`,
		],
		{
			env: { ...process.env, CHAOS_CARRY_MEMORY_PROBE_PATH: runtimeStatePath },
			stderr: 'pipe',
			stdout: 'pipe',
		},
	)
	const [exitCode, stdout, stderr] = await Promise.all([probe.exited, new Response(probe.stdout).text(), new Response(probe.stderr).text()])
	if (exitCode !== 0) throw new Error(`Carry memory probe failed with exit ${exitCode.toString()}: ${stderr}`)
	const value = objectRecord(JSON.parse(stdout.trim()), 'carry memory probe output')
	const baselineResidentSetKilobytes = value['baselineResidentSetKilobytes']
	const maximumResidentSetKilobytes = value['maximumResidentSetKilobytes']
	if (typeof baselineResidentSetKilobytes !== 'number') throw new Error('Carry memory probe did not report baseline resident memory')
	if (typeof maximumResidentSetKilobytes !== 'number') throw new Error('Carry memory probe did not report maximum resident memory')
	return Math.max(0, maximumResidentSetKilobytes - baselineResidentSetKilobytes)
}

function resolvedForkSnapshot(block: number, logIndex: number): SecurityPoolForkSnapshotJournalEvent {
	return {
		auctionableAttoRepAtFork: 0n.toString(),
		emitter: forker,
		escalationChildRepAtForkAttoRep: 0n.toString(),
		escalationElapsedAtFork: '0',
		escalationNonDecisionThresholdAtForkAttoRep: 0n.toString(),
		escalationSnapshotId: zeroHash,
		escalationSourceRepAtForkAttoRep: 0n.toString(),
		escalationStartBondAtForkAttoRep: 0n.toString(),
		kind: 'security-pool-fork-snapshot',
		migrationProxy: address(700),
		ownFork: false,
		pool: address(100_000 + block * 100_000 + logIndex),
		position: position(block, logIndex, `resolved-${block.toString()}`),
		settlementCollateralAtForkAttoEth: 0n.toString(),
		signature: 'SecurityPoolForkSnapshot(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)',
		totalPoolHeldRepAtForkAttoRep: 0n.toString(),
		unresolvedEscalation: false,
	}
}

function locallySettledEvents(count: number, block: number) {
	const accumulator = createCarryProofAccumulator(sourceGame, sourcePool)
	const events: CarryProofJournalEvent[] = []
	for (let index = 0; index < count; index += 1) {
		const value = leaf({ amount: 1n, cumulative: BigInt(index + 1), parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) })
		appendCarryLeafToAccumulator(accumulator, value)
		events.push(localEvent(sourceGame, sourcePool, value, block, index * 2))
		const consumption = {
			amountAttoRep: value.amountAttoRep,
			depositor: value.depositor,
			outcome: value.outcome,
			parentDepositIndex: value.parentDepositIndex,
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			sourceNodeId: value.sourceNodeId,
		}
		const roots = carryProofAccumulatorLocalConsumptionRoots(accumulator, consumption)
		const event: CarryDepositConsumedJournalEvent = {
			...consumption,
			emitter: sourceGame,
			kind: 'carry-deposit-consumed',
			pool: sourcePool,
			position: position(block, index * 2 + 1),
			reason: 1,
			resultingCarryRoot: roots.carryRoot,
			resultingNullifierRoot: roots.nullifierRoot,
			signature: 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)',
		}
		applyCarryConsumptionToAccumulator(accumulator, {
			...consumption,
			expectedCarryRoot: roots.carryRoot,
			expectedNullifierRoot: roots.nullifierRoot,
		})
		events.push(event)
	}
	return events
}

describe('compact carry-proof journal', () => {
	test('replays and parses Invalid-outcome carry while rejecting BinaryOutcome.None', () => {
		const invalidLeaf = leaf({ amount: 10n, cumulative: 10n, outcome: 0, parentDepositIndex: 0n, sourceNodeId: 1n })
		let source = createCarryGameHistory(sourceGame, sourcePool)
		source = appendLocalCarryLeaf(source, invalidLeaf)
		const checkpoint = checkpointFor(currentCarryGameState(source), childGame, sourceGame)
		const fixture = journal([localEvent(sourceGame, sourcePool, invalidLeaf, 1), forkDrain(checkpoint, 2), forkSnapshot(checkpoint, 2), checkpointEvent(checkpoint, childPool, sourcePool, 3)], 3)
		expect(replayCarryProofJournal(fixture, depositor).proofCandidates.map(candidate => candidate.outcome)).toEqual([0])
		const serialized = serializedCarryProofJournal(fixture)
		expect(parseCarryProofJournal(serialized).events[0]?.kind).toBe('local-deposit-appended')
		const unsupported = serialized.replace(/"outcome":\s*0/, '"outcome": 3')
		expect(unsupported).not.toBe(serialized)
		expect(() => parseCarryProofJournal(unsupported)).toThrow('must be Invalid, Yes, or No')
	})

	test('replays a marker-bound checkpoint into deterministic wallet proof candidates without persisted state copies', () => {
		const fixture = checkpointJournalFixture()
		const replay = replayCarryProofJournal(fixture.journal, depositor)
		expect(replay.checkpointSnapshotCount).toBe(1)
		expect(replay.proofCandidates).toHaveLength(2)
		expect(replay.proofCandidates.map(candidate => candidate.parentDepositIndex)).toEqual(['0', '1'])
		expect(replay.games[childGame.toLowerCase()]?.state.outcomes[1].snapshotSlots).toHaveLength(2)
		const persisted = serializedCarryProofJournal(fixture.journal)
		expect(persisted).not.toContain('snapshotSlots')
		expect(persisted).not.toContain('versions')
		expect(parseCarryProofJournal(persisted, { chainId: 1, profileId: identity.profileId, securityPoolForker: forker, startBlock: '1' })).toEqual(fixture.journal)
	})

	test('binds a delayed child checkpoint to the fork-time source snapshot and excludes a later direct parent claim', () => {
		const fixture = sourceFixture()
		const forkTimeState = currentCarryGameState(fixture.history)
		const checkpoint = checkpointFor(forkTimeState, childGame, sourceGame)
		const consumed = consumptionEvent(fixture.history, {
			amountAttoRep: 10n.toString(),
			block: 3,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const claim = claimEvent(consumed.event, 3)
		const delayed = journal([...fixture.events, forkDrain(checkpoint, 2), forkSnapshot(checkpoint, 2), consumed.event, claim, checkpointEvent(checkpoint, childPool, sourcePool, 4)], 4)
		const replay = replayCarryProofJournal(delayed, depositor)
		expect(replay.games[sourceGame.toLowerCase()]?.state.outcomes[1].currentSlots[0]?.hash).toBe(`0x${'0'.repeat(64)}`)
		expect(replay.games[childGame.toLowerCase()]?.state.outcomes[1].snapshotSlots[0]?.hash).not.toBe(`0x${'0'.repeat(64)}`)
		expect(replay.directlyClaimedDeposits).toEqual([{ amountAttoRep: 10n.toString(), outcome: 1, parentDepositIndex: '0', sourceGame }])
		expect(replay.proofCandidates.map(candidate => candidate.parentDepositIndex)).toEqual(['1'])
	})

	test('applies a direct parent claim to an existing child before its next inherited consumption without a haircut', () => {
		const fixture = checkpointJournalFixture()
		const direct = consumptionEvent(fixture.source.history, {
			amountAttoRep: 10n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, fixture.checkpoint, fixture.source.history)
		const inherited = consumptionEvent(childHistory, {
			amountAttoRep: 20n.toString(),
			block: 5,
			parentDepositIndex: '1',
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			sourceNodeId: '2',
		})
		const replay = replayCarryProofJournal(journal([...fixture.events, direct.event, claimEvent(direct.event, 4), inherited.event, claimEvent(inherited.event, 5, true)], 5), depositor)
		const child = replay.games[childGame.toLowerCase()]
		if (child === undefined) throw new Error('Expected replayed child carry game')
		expect(carryGameAccounting(child.state).unresolvedTotalsAttoRep).toEqual(['0', '0', '0'])
		expect(child.rawAccounting).toEqual(rawAccounting(['0', '10', '0'], ['0', '0', '0']))
		expect(replay.proofCandidates.filter(candidate => candidate.game === childGame)).toEqual([])
	})

	test('replays recursive fork ancestry while retaining only actual checkpoint snapshots transiently', () => {
		const first = checkpointJournalFixture()
		let childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, first.checkpoint, first.source.history)
		const childParentDepositIndex = (BigInt(childGame) << 96n) | (1n << 88n)
		const childLeaf = leaf({ amount: 5n, cumulative: 35n, parentDepositIndex: childParentDepositIndex, sourceNodeId: 1n })
		childHistory = appendLocalCarryLeaf(childHistory, childLeaf)
		const grandchildCheckpoint = checkpointFor(currentCarryGameState(childHistory), grandchildGame, childGame)
		const recursive = journal([...first.events, localEvent(childGame, childPool, childLeaf, 4), forkDrain(grandchildCheckpoint, 5, childPool, childGame), forkSnapshot(grandchildCheckpoint, 5, childPool), checkpointEvent(grandchildCheckpoint, grandchildPool, childPool, 6)], 6)
		const replay = replayCarryProofJournal(recursive, depositor)
		expect(replay.checkpointSnapshotCount).toBe(2)
		const grandchildCandidates = replay.proofCandidates.filter(candidate => candidate.game === grandchildGame)
		expect(grandchildCandidates.map(candidate => candidate.parentDepositIndex)).toEqual(['0', '1', childParentDepositIndex.toString()])
		expect(grandchildCandidates[0]?.proof.merkleMountainRangePeakIndex).toBe('1')
	})

	test('excludes a root-claimed leaf from a no-haircut recursive fork before and after compaction', () => {
		const fixture = checkpointJournalFixture()
		const direct = consumptionEvent(fixture.source.history, {
			amountAttoRep: 10n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		let childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, fixture.checkpoint, fixture.source.history)
		childHistory = setCarryGameAccounting(childHistory, {
			resolutionBalancesAttoRep: ['0', '30', '0'],
			unresolvedTotalsAttoRep: ['0', '20', '0'],
		})
		const grandchildCheckpoint = checkpointFor(currentCarryGameState(childHistory), grandchildGame, childGame)
		const full = journal([...fixture.events, direct.event, claimEvent(direct.event, 4), forkDrain(grandchildCheckpoint, 5, childPool, childGame), forkSnapshot(grandchildCheckpoint, 5, childPool), checkpointEvent(grandchildCheckpoint, grandchildPool, childPool, 6)], 6)
		const fullReplay = replayCarryProofJournal(full, depositor)
		const compactReplay = replayCarryProofJournal(compactCarryProofJournal(full), depositor)
		const grandchildProofParents = (replay: typeof fullReplay) => replay.proofCandidates.filter(candidate => candidate.game === grandchildGame).map(candidate => candidate.parentDepositIndex)
		const grandchildPresenceParents = (replay: typeof fullReplay) => replay.proofCandidatePresence.filter(candidate => candidate.game === grandchildGame).map(candidate => candidate.parentDepositIndex)
		expect(grandchildProofParents(fullReplay)).toEqual(['1'])
		expect(grandchildPresenceParents(fullReplay)).toEqual(['1'])
		expect(grandchildProofParents(compactReplay)).toEqual(grandchildProofParents(fullReplay))
		expect(grandchildPresenceParents(compactReplay)).toEqual(grandchildPresenceParents(fullReplay))
	})

	test('derives truth-auction accounting from the exact haircut ratio and fails closed on an observed mismatch', () => {
		const fixture = checkpointJournalFixture()
		const derived = deriveTruthAuctionHaircutJournalEventAccounting(fixture.journal, {
			game: childGame,
			pool: childPool,
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
		})
		const haircut: TruthAuctionHaircutJournalEvent = {
			emitter: childGame,
			kind: 'truth-auction-haircut',
			pool: childPool,
			position: position(4, 0),
			rebasedElapsed: '7',
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
			repRemovedAttoRep: 15n.toString(),
			resultingResolutionBalancesAttoRep: derived.resolutionBalancesAttoRep,
			resultingUnresolvedTotalsAttoRep: derived.unresolvedTotalsAttoRep,
			signature: 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)',
		}
		const valid = journal([...fixture.events, haircut], 4)
		expect(carryGameAccounting(replayCarryProofJournal(valid).games[childGame.toLowerCase()]?.state ?? currentCarryGameState(createCarryGameHistory(childGame, childPool))).unresolvedTotalsAttoRep[1]).toBe('15')
		const invalid = journal([...fixture.events, { ...haircut, resultingUnresolvedTotalsAttoRep: ['0', '16', '0'] }], 4)
		expect(() => replayCarryProofJournal(invalid)).toThrow('unresolved total is not derivable')
	})

	test('rejects a truth-auction haircut on a root game that was not initialized as a fork continuation', () => {
		const source = sourceFixture()
		const rootHaircut: TruthAuctionHaircutJournalEvent = {
			emitter: sourceGame,
			kind: 'truth-auction-haircut',
			pool: sourcePool,
			position: position(2, 0),
			rebasedElapsed: '7',
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
			repRemovedAttoRep: 15n.toString(),
			resultingResolutionBalancesAttoRep: ['0', '15', '0'],
			resultingUnresolvedTotalsAttoRep: ['0', '15', '0'],
			signature: 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)',
		}
		expect(() => deriveTruthAuctionHaircutJournalEventAccounting(journal(source.events, 1), { game: sourceGame, pool: sourcePool, repBeforeAttoRep: 30n.toString(), repRemainingAttoRep: 15n.toString() })).toThrow(/fork continuation/i)
		expect(() => replayCarryProofJournal(journal([...source.events, rootHaircut], 2))).toThrow(/fork continuation/i)
	})

	test('derives inherited haircuts while preserving replayed local unresolved REP', () => {
		const fixture = checkpointJournalFixture()
		const local = leaf({ amount: 5n, cumulative: 35n, parentDepositIndex: 99n, sourceNodeId: 1n })
		const beforeHaircut = journal([...fixture.events, localEvent(childGame, childPool, local, 4)], 4)
		expect(
			deriveTruthAuctionHaircutJournalEventAccounting(beforeHaircut, {
				game: childGame,
				pool: childPool,
				repBeforeAttoRep: 30n.toString(),
				repRemainingAttoRep: 15n.toString(),
			}),
		).toEqual({
			resolutionBalancesAttoRep: ['0', '17', '0'],
			unresolvedTotalsAttoRep: ['0', '20', '0'],
		})
	})

	test('subtracts event-time direct parent claims before a child haircut across compaction', () => {
		const fixture = checkpointJournalFixture()
		const direct = consumptionEvent(fixture.source.history, {
			amountAttoRep: 10n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const beforeHaircut = journal([...fixture.events, direct.event, claimEvent(direct.event, 4)], 4)
		const derived = deriveTruthAuctionHaircutJournalEventAccounting(beforeHaircut, {
			game: childGame,
			pool: childPool,
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
		})
		expect(derived.unresolvedTotalsAttoRep).toEqual(['0', '10', '0'])
		const haircut: TruthAuctionHaircutJournalEvent = {
			emitter: childGame,
			kind: 'truth-auction-haircut',
			pool: childPool,
			position: position(5, 0),
			rebasedElapsed: '7',
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
			repRemovedAttoRep: 15n.toString(),
			resultingResolutionBalancesAttoRep: derived.resolutionBalancesAttoRep,
			resultingUnresolvedTotalsAttoRep: derived.unresolvedTotalsAttoRep,
			signature: 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)',
		}
		const full = appendCarryProofJournalEvents(beforeHaircut, [haircut], { blockHash: blockHash(5), blockNumber: '5' })
		const compactedPrefix = compactCarryProofJournal(beforeHaircut)
		const compacted = appendCarryProofJournalEvents(compactedPrefix, [haircut], { blockHash: blockHash(5), blockNumber: '5' })
		const fullChild = replayCarryProofJournal(full).games[childGame.toLowerCase()]
		const compactedChild = replayCarryProofJournal(compacted).games[childGame.toLowerCase()]
		if (fullChild === undefined || compactedChild === undefined) throw new Error('Expected replayed child carry game')
		expect(carryGameAccounting(fullChild.state).unresolvedTotalsAttoRep).toEqual(['0', '10', '0'])
		expect(compactedChild).toEqual(fullChild)
	})

	test('produces a canonical fixed-size quorum digest binding identity, cursor, and ordered events', () => {
		const fixture = checkpointJournalFixture().journal
		const roundTripped = parseCarryProofJournal(serializedCarryProofJournal(fixture))
		expect(carryProofJournalDigest(roundTripped)).toBe(carryProofJournalDigest(fixture))
		const advancedCursor = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
		expect(carryProofJournalDigest(advancedCursor)).not.toBe(carryProofJournalDigest(fixture))
		expect(carryProofJournalDigest({ ...fixture, profileId: 'profile:different' })).not.toBe(carryProofJournalDigest(fixture))
		expect(carryProofJournalDigest(fixture)).toMatch(/^0x[0-9a-f]{64}$/)
	})

	test('binds compacted replay state, raw accounting, prefix history, and the canonical suffix into quorum digest', () => {
		const fixture = checkpointJournalFixture().journal
		const compacted = compactCarryProofJournal(fixture, {
			[childGame.toLowerCase()]: rawAccounting(['0', '30', '0'], ['0', '0', '0']),
		})
		const checkpoint = compacted.checkpoint
		if (checkpoint === undefined) throw new Error('Expected a compacted carry checkpoint')
		const rawAccountingChanged: CarryProofJournal = {
			...compacted,
			checkpoint: {
				...checkpoint,
				games: checkpoint.games.map(game =>
					game.game === childGame
						? {
								...game,
								rawAccounting: rawAccounting(['0', '29', '0'], ['0', '0', '0']),
							}
						: game,
				),
			},
		}
		const prefixDigestChanged: CarryProofJournal = { ...compacted, checkpoint: { ...checkpoint, prefixEventDigest: hash('different-prefix') } }
		const withSuffix = appendCarryProofJournalEvents(compacted, [resolvedForkSnapshot(4, 0)], { blockHash: blockHash(4), blockNumber: '4' })
		expect(() => carryProofJournalDigest(rawAccountingChanged)).toThrow(/accounting is not derivable/i)
		const rawAndEffectiveAccountingChanged = structuredClone(rawAccountingChanged)
		const changedChild = rawAndEffectiveAccountingChanged.checkpoint?.games.find(game => game.game === childGame)
		if (changedChild === undefined) throw new Error('Expected a compacted child carry game')
		changedChild.state.outcomes[1].unresolvedTotalAttoRep = '29'
		expect(() => validateCarryProofJournal(rawAndEffectiveAccountingChanged)).toThrow(/raw accounting is not derivable from its source snapshot and consumption dispositions/i)
		expect(() => carryProofJournalDigest(prefixDigestChanged)).toThrow(/prefixEventDigest does not match its event and direct-claim MMR prefix commitment/i)
		expect(carryProofJournalDigest(withSuffix)).not.toBe(carryProofJournalDigest(compacted))
	})

	test('fails closed on compacted source-route, local-total, and uniqueness-state corruption', () => {
		const fixture = checkpointJournalFixture().journal
		const compacted = compactCarryProofJournal(fixture, {
			[childGame.toLowerCase()]: rawAccounting(['0', '30', '0'], ['0', '0', '0']),
		})
		const checkpoint = compacted.checkpoint
		if (checkpoint === undefined) throw new Error('Expected a compacted carry checkpoint')
		const wrongSourceRoute: CarryProofJournal = {
			...compacted,
			checkpoint: {
				...checkpoint,
				games: checkpoint.games.map(game => (game.source === null ? game : { ...game, source: { ...game.source, pool: grandchildPool } })),
			},
		}
		expect(() => validateCarryProofJournal(wrongSourceRoute)).toThrow('lacks its exact source snapshot')
		const wrongLocalTotal: CarryProofJournal = {
			...compacted,
			checkpoint: {
				...checkpoint,
				games: checkpoint.games.map(game => (game.game === sourceGame ? { ...game, localUnresolvedTotalsAttoRep: ['0', '29', '0'] } : game)),
			},
		}
		expect(() => validateCarryProofJournal(wrongLocalTotal)).toThrow('does not match outcome 1 local slots')
		const duplicateForkIdentity: CarryProofJournal = { ...compacted, checkpoint: { ...checkpoint, forkSnapshotIds: [...checkpoint.forkSnapshotIds, checkpoint.forkSnapshotIds[0] ?? zeroHash] } }
		expect(() => validateCarryProofJournal(duplicateForkIdentity)).toThrow('duplicate fork snapshot ids')
	})

	test('rejects compacted pending-snapshot, claim-retention, and haircut tampering', () => {
		const fixture = checkpointJournalFixture()
		const derived = deriveTruthAuctionHaircutJournalEventAccounting(fixture.journal, {
			game: childGame,
			pool: childPool,
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
		})
		const haircut: TruthAuctionHaircutJournalEvent = {
			emitter: childGame,
			kind: 'truth-auction-haircut',
			pool: childPool,
			position: position(4, 0),
			rebasedElapsed: '7',
			repBeforeAttoRep: 30n.toString(),
			repRemainingAttoRep: 15n.toString(),
			repRemovedAttoRep: 15n.toString(),
			resultingResolutionBalancesAttoRep: derived.resolutionBalancesAttoRep,
			resultingUnresolvedTotalsAttoRep: derived.unresolvedTotalsAttoRep,
			signature: 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)',
		}
		const compacted = compactCarryProofJournal(journal([...fixture.events, haircut], 4))
		expect(validateCarryProofJournal(compacted)).toEqual(compacted)

		const pendingSnapshotTamper = structuredClone(compacted)
		const pendingSnapshot = pendingSnapshotTamper.checkpoint?.pendingSourceSnapshots[0]
		if (pendingSnapshot === undefined) throw new Error('Expected a compacted pending source snapshot')
		pendingSnapshot.snapshotId = hash('tampered-pending-snapshot')
		expect(() => validateCarryProofJournal(pendingSnapshotTamper)).toThrow(/snapshotId does not match its persisted source carry state/i)

		const rootRetentionTamper = structuredClone(compacted)
		const root = rootRetentionTamper.checkpoint?.games.find(game => game.game === sourceGame)
		if (root === undefined) throw new Error('Expected a compacted root carry game')
		root.claimRetention.exponent = (BigInt(root.claimRetention.exponent) + 1n).toString()
		expect(() => validateCarryProofJournal(rootRetentionTamper)).toThrow(/claim retention is not exactly derivable from its ancestry and haircut/i)

		const inheritedRetentionTamper = structuredClone(compacted)
		const inherited = inheritedRetentionTamper.checkpoint?.games.find(game => game.game === childGame)
		if (inherited === undefined) throw new Error('Expected a compacted inherited carry game')
		inherited.claimRetention.exponent = (BigInt(inherited.claimRetention.exponent) + 1n).toString()
		expect(() => validateCarryProofJournal(inheritedRetentionTamper)).toThrow(/claim retention is not exactly derivable from its ancestry and haircut/i)

		const haircutTamper = structuredClone(compacted)
		const haircutGame = haircutTamper.checkpoint?.games.find(game => game.game === childGame)
		if (haircutGame?.haircut === null || haircutGame?.haircut === undefined) throw new Error('Expected a compacted inherited haircut')
		haircutGame.haircut.repRemainingAttoRep = '10'
		haircutGame.haircut.repRemovedAttoRep = '20'
		expect(() => validateCarryProofJournal(haircutTamper)).toThrow(/claim retention is not exactly derivable from its ancestry and haircut/i)
	})

	test('requires every compacted direct claim to point to its consumed and zeroed source slot', () => {
		const fixture = checkpointJournalFixture()
		const direct = consumptionEvent(fixture.source.history, {
			amountAttoRep: 10n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const compacted = compactCarryProofJournal(journal([...fixture.events, direct.event, claimEvent(direct.event, 4)], 4))
		expect(validateCarryProofJournal(compacted)).toEqual(compacted)
		const claimedSlot = compacted.checkpoint?.games.find(game => game.game === sourceGame)?.state.outcomes[1].currentSlots.find(slot => slot.leaf.parentDepositIndex === '0')
		expect(claimedSlot).toMatchObject({ consumedLocally: true, hash: zeroHash })

		const unconsumedSourceTamper = structuredClone(compacted)
		const tamperedSlot = unconsumedSourceTamper.checkpoint?.games.find(game => game.game === sourceGame)?.state.outcomes[1].currentSlots.find(slot => slot.leaf.parentDepositIndex === '0')
		const originalSlot = currentCarryGameState(fixture.source.history).outcomes[1].currentSlots.find(slot => slot.leaf.parentDepositIndex === '0')
		if (tamperedSlot === undefined || originalSlot === undefined) throw new Error('Expected source slots for compacted direct-claim tampering')
		tamperedSlot.consumedLocally = originalSlot.consumedLocally
		tamperedSlot.hash = originalSlot.hash
		const tamperedSource = unconsumedSourceTamper.checkpoint?.games.find(game => game.game === sourceGame)
		if (tamperedSource === undefined) throw new Error('Expected a compacted direct-claim source game')
		tamperedSource.localUnresolvedTotalsAttoRep = ['0', '30', '0']
		expect(() => validateCarryProofJournal(unconsumedSourceTamper)).toThrow(/direct claim .* does not match its source deposit/i)
	})

	test('rejects a child checkpoint that removes an inherited source nullifier baseline', () => {
		const fixture = checkpointJournalFixture()
		let childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, fixture.checkpoint, fixture.source.history)
		const inheritedConsumption = consumptionEvent(childHistory, {
			amountAttoRep: 10n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		childHistory = inheritedConsumption.history
		const grandchildCheckpoint = checkpointFor(currentCarryGameState(childHistory), grandchildGame, childGame)
		const recursive = journal([...fixture.events, inheritedConsumption.event, claimEvent(inheritedConsumption.event, 4, true), forkDrain(grandchildCheckpoint, 5, childPool, childGame), forkSnapshot(grandchildCheckpoint, 5, childPool), checkpointEvent(grandchildCheckpoint, grandchildPool, childPool, 6)], 6)
		const tampered = structuredClone(compactCarryProofJournal(recursive))
		const grandchild = tampered.checkpoint?.games.find(game => game.game === grandchildGame)
		if (grandchild === undefined) throw new Error('Expected a compacted grandchild carry game')
		expect(grandchild.state.outcomes[1].nullifier.consumed.map(entry => entry.parentDepositIndex)).toContain('0')
		grandchild.state.outcomes[1].nullifier.consumed = []
		expect(() => validateCarryProofJournal(tampered)).toThrow(/nullifiers do not retain their source baseline/i)
	})

	test('does not relabel an ordinary compacted local consumption with fabricated direct-claim evidence', () => {
		const fixture = sourceFixture()
		const originalReasons: readonly (1 | 2)[] = [1, 2]
		for (const originalReason of originalReasons) {
			const ordinaryConsumption = consumptionEvent(fixture.history, {
				amountAttoRep: 10n.toString(),
				block: 2,
				parentDepositIndex: '0',
				reason: originalReason,
				resultingUnresolvedTotalAttoRep: 20n.toString(),
				sourceNodeId: '1',
			})
			const compacted = compactCarryProofJournal(journal([...fixture.events, ordinaryConsumption.event], 2))
			const coordinatedRelabel = structuredClone(compacted)
			const coordinatedCheckpoint = coordinatedRelabel.checkpoint
			if (coordinatedCheckpoint === undefined) throw new Error('Expected a compacted carry checkpoint')
			const disposition = coordinatedCheckpoint.consumptionDispositions.find(entry => entry.game === sourceGame && entry.outcome === 1 && entry.parentDepositIndex === '0')
			if (disposition === undefined) throw new Error('Expected a compacted ordinary-consumption disposition')
			disposition.reason = 3
			const relabeledConsumption: CarryDepositConsumedJournalEvent = { ...ordinaryConsumption.event, reason: 3 }
			const canonicalDirectClaim = compactCarryProofJournal(journal([...fixture.events, relabeledConsumption, claimEvent(relabeledConsumption, 2)], 2)).checkpoint?.directClaimEvidence[0]
			if (canonicalDirectClaim === undefined) throw new Error('Expected canonical direct-claim evidence fixture')
			coordinatedCheckpoint.directClaimEvidence.push(canonicalDirectClaim)
			expect(() => validateCarryProofJournal(coordinatedRelabel)).toThrow(/event MMR.*(?:witness|prefix)|committed event MMR peak height/i)
		}
	})

	test('does not erase canonical direct-claim evidence by relabeling its compacted consumption', () => {
		const fixture = sourceFixture()
		const direct = consumptionEvent(fixture.history, {
			amountAttoRep: 10n.toString(),
			block: 2,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const compacted = compactCarryProofJournal(journal([...fixture.events, direct.event, claimEvent(direct.event, 2)], 2))
		const emptyDirectClaimMmr = compactCarryProofJournal(journal(fixture.events, 1)).checkpoint?.directClaimMmr
		if (emptyDirectClaimMmr === undefined) throw new Error('Expected an empty compacted direct-claim MMR')
		const relabeledReasons: readonly (1 | 2)[] = [1, 2]
		for (const reason of relabeledReasons) {
			const coordinatedRelabel = structuredClone(compacted)
			const checkpoint = coordinatedRelabel.checkpoint
			if (checkpoint === undefined) throw new Error('Expected a compacted carry checkpoint')
			const disposition = checkpoint.consumptionDispositions.find(entry => entry.game === sourceGame && entry.outcome === 1 && entry.parentDepositIndex === '0')
			if (disposition === undefined) throw new Error('Expected a compacted direct-claim disposition')
			disposition.reason = reason
			checkpoint.directClaimEvidence = []
			expect(() => validateCarryProofJournal(coordinatedRelabel)).toThrow(/direct-claim MMR/i)

			const rewrittenAccumulator = structuredClone(coordinatedRelabel)
			if (rewrittenAccumulator.checkpoint === undefined) throw new Error('Expected a compacted carry checkpoint')
			rewrittenAccumulator.checkpoint.directClaimMmr = structuredClone(emptyDirectClaimMmr)
			expect(() => validateCarryProofJournal(rewrittenAccumulator)).toThrow(/prefixEventDigest does not match its event and direct-claim MMR prefix commitment/i)
		}
	})

	test('updates canonical event MMR peaks and direct-claim witnesses across power-of-two recompactions', () => {
		const first = leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n })
		const second = leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n })
		let sourceHistory = createCarryGameHistory(sourceGame, sourcePool)
		sourceHistory = appendLocalCarryLeaf(sourceHistory, first)
		const atOne = compactCarryProofJournal(journal([localEvent(sourceGame, sourcePool, first, 1)], 1))
		sourceHistory = appendLocalCarryLeaf(sourceHistory, second)
		const atTwo = compactCarryProofJournal(appendCarryProofJournalEvents(atOne, [localEvent(sourceGame, sourcePool, second, 2)], { blockHash: blockHash(2), blockNumber: '2' }))
		expect(atOne.checkpoint?.prefixEventMmr.leafCount).toBe('1')
		expect(atTwo.checkpoint?.prefixEventMmr.leafCount).toBe('2')
		expect(atTwo.checkpoint?.prefixEventMmr.root).not.toBe(atOne.checkpoint?.prefixEventMmr.root)
		expect(atOne.checkpoint?.directClaimMmr.leafCount).toBe('0')
		expect(atTwo.checkpoint?.directClaimMmr).toEqual(atOne.checkpoint?.directClaimMmr)

		let directHistory = createCarryGameHistory(sourceGame, sourcePool)
		directHistory = appendLocalCarryLeaf(directHistory, first)
		const direct = consumptionEvent(directHistory, {
			amountAttoRep: 10n.toString(),
			block: 2,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			sourceNodeId: '1',
		})
		const directClaim = claimEvent(direct.event, 2)
		const baseEvents: CarryProofJournalEvent[] = [localEvent(sourceGame, sourcePool, first, 1), direct.event, directClaim]
		let incrementallyCompacted = compactCarryProofJournal(journal(baseEvents, 2))
		expect(incrementallyCompacted.checkpoint?.prefixEventMmr.leafCount).toBe('3')
		expect(incrementallyCompacted.checkpoint?.directClaimMmr.leafCount).toBe('1')
		expect(incrementallyCompacted.checkpoint?.directClaimEvidence[0]?.consumptionWitness.siblings).toHaveLength(1)
		expect(incrementallyCompacted.checkpoint?.directClaimEvidence[0]?.claimWitness.siblings).toHaveLength(0)
		const firstDirectClaimRoot = incrementallyCompacted.checkpoint?.directClaimMmr.root
		if (firstDirectClaimRoot === undefined) throw new Error('Expected a compacted direct-claim MMR root')

		const fourth = resolvedForkSnapshot(3, 0)
		incrementallyCompacted = compactCarryProofJournal(appendCarryProofJournalEvents(incrementallyCompacted, [fourth], { blockHash: blockHash(3), blockNumber: '3' }))
		expect(incrementallyCompacted.checkpoint?.prefixEventMmr.leafCount).toBe('4')
		expect(incrementallyCompacted.checkpoint?.directClaimMmr.root).toBe(firstDirectClaimRoot)
		expect(incrementallyCompacted.checkpoint?.directClaimEvidence[0]?.consumptionWitness.siblings).toHaveLength(2)

		const toSeven = [resolvedForkSnapshot(4, 0), resolvedForkSnapshot(4, 1), resolvedForkSnapshot(4, 2)]
		incrementallyCompacted = compactCarryProofJournal(appendCarryProofJournalEvents(incrementallyCompacted, toSeven, { blockHash: blockHash(4), blockNumber: '4' }))
		expect(incrementallyCompacted.checkpoint?.prefixEventMmr.leafCount).toBe('7')
		expect(incrementallyCompacted.checkpoint?.directClaimMmr.root).toBe(firstDirectClaimRoot)
		expect(incrementallyCompacted.checkpoint?.directClaimEvidence[0]?.consumptionWitness.siblings).toHaveLength(2)

		const eighth = resolvedForkSnapshot(5, 0)
		incrementallyCompacted = compactCarryProofJournal(appendCarryProofJournalEvents(incrementallyCompacted, [eighth], { blockHash: blockHash(5), blockNumber: '5' }))
		expect(incrementallyCompacted.checkpoint?.prefixEventMmr.leafCount).toBe('8')
		expect(incrementallyCompacted.checkpoint?.directClaimMmr.root).toBe(firstDirectClaimRoot)
		expect(incrementallyCompacted.checkpoint?.directClaimEvidence[0]?.consumptionWitness.siblings).toHaveLength(3)
		expect(replayCarryProofJournal(incrementallyCompacted).directlyClaimedDeposits).toEqual([{ amountAttoRep: 10n.toString(), outcome: 1, parentDepositIndex: '0', sourceGame }])

		const oneShot = compactCarryProofJournal(journal([...baseEvents, fourth, ...toSeven, eighth], 5))
		expect(incrementallyCompacted.checkpoint?.prefixEventMmr).toEqual(oneShot.checkpoint?.prefixEventMmr)
		expect(incrementallyCompacted.checkpoint?.directClaimMmr).toEqual(oneShot.checkpoint?.directClaimMmr)
		expect(incrementallyCompacted.checkpoint?.directClaimEvidence).toEqual(oneShot.checkpoint?.directClaimEvidence)
		expect(parseCarryProofJournal(serializedCarryProofJournal(incrementallyCompacted))).toEqual(incrementallyCompacted)

		const secondDirectLeaf = leaf({ amount: 5n, cumulative: 15n, parentDepositIndex: 1n, sourceNodeId: 2n })
		const secondDirectHistory = appendLocalCarryLeaf(direct.history, secondDirectLeaf)
		const secondDirect = consumptionEvent(secondDirectHistory, {
			amountAttoRep: 5n.toString(),
			block: 7,
			parentDepositIndex: '1',
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			sourceNodeId: '2',
		})
		const secondDirectEvents: CarryProofJournalEvent[] = [localEvent(sourceGame, sourcePool, secondDirectLeaf, 6), secondDirect.event, claimEvent(secondDirect.event, 7)]
		const withSecondDirectClaim = compactCarryProofJournal(appendCarryProofJournalEvents(incrementallyCompacted, secondDirectEvents, { blockHash: blockHash(7), blockNumber: '7' }))
		expect(withSecondDirectClaim.checkpoint?.directClaimMmr.leafCount).toBe('2')
		expect(withSecondDirectClaim.checkpoint?.directClaimMmr.root).not.toBe(firstDirectClaimRoot)
		const oneShotWithSecondDirectClaim = compactCarryProofJournal(journal([...baseEvents, fourth, ...toSeven, eighth, ...secondDirectEvents], 7))
		expect(withSecondDirectClaim.checkpoint?.prefixEventMmr).toEqual(oneShotWithSecondDirectClaim.checkpoint?.prefixEventMmr)
		expect(withSecondDirectClaim.checkpoint?.directClaimMmr).toEqual(oneShotWithSecondDirectClaim.checkpoint?.directClaimMmr)
		expect(withSecondDirectClaim.checkpoint?.directClaimEvidence).toEqual(oneShotWithSecondDirectClaim.checkpoint?.directClaimEvidence)
	})

	test('fails closed on compacted direct-claim event MMR witness and frontier tampering', () => {
		const first = leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n })
		let sourceHistory = createCarryGameHistory(sourceGame, sourcePool)
		sourceHistory = appendLocalCarryLeaf(sourceHistory, first)
		const direct = consumptionEvent(sourceHistory, {
			amountAttoRep: 10n.toString(),
			block: 2,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			sourceNodeId: '1',
		})
		const compacted = compactCarryProofJournal(journal([localEvent(sourceGame, sourcePool, first, 1), direct.event, claimEvent(direct.event, 2)], 2))

		const wrongIndex = structuredClone(compacted)
		const wrongIndexEvidence = wrongIndex.checkpoint?.directClaimEvidence[0]
		if (wrongIndexEvidence === undefined) throw new Error('Expected compacted direct-claim evidence')
		wrongIndexEvidence.consumptionWitness.leafIndex = '0'
		expect(() => validateCarryProofJournal(wrongIndex)).toThrow(/canonical prefix inclusion/i)

		const wrongSibling = structuredClone(compacted)
		const wrongSiblingEvidence = wrongSibling.checkpoint?.directClaimEvidence[0]
		if (wrongSiblingEvidence?.consumptionWitness.siblings[0] === undefined) throw new Error('Expected compacted direct-claim witness sibling')
		wrongSiblingEvidence.consumptionWitness.siblings[0] = hash('wrong-event-mmr-sibling')
		expect(() => validateCarryProofJournal(wrongSibling)).toThrow(/canonical prefix inclusion/i)

		const wrongRoot = structuredClone(compacted)
		if (wrongRoot.checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
		wrongRoot.checkpoint.prefixEventMmr.root = hash('wrong-event-mmr-root')
		expect(() => validateCarryProofJournal(wrongRoot)).toThrow(/root does not commit/i)

		const wrongPeak = structuredClone(compacted)
		if (wrongPeak.checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
		wrongPeak.checkpoint.prefixEventMmr.peaks[1] = hash('wrong-event-mmr-peak')
		expect(() => validateCarryProofJournal(wrongPeak)).toThrow(/root does not commit/i)

		const wrongCount = structuredClone(compacted)
		if (wrongCount.checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
		wrongCount.checkpoint.prefixEventCount = '4'
		wrongCount.checkpoint.prefixEventMmr.leafCount = '4'
		expect(() => validateCarryProofJournal(wrongCount)).toThrow(/event MMR.*(?:peak|root)/i)

		const missingEvidence = structuredClone(compacted)
		if (missingEvidence.checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
		missingEvidence.checkpoint.directClaimEvidence = []
		expect(() => validateCarryProofJournal(missingEvidence)).toThrow(/direct-claim MMR does not exactly match its complete canonical direct-claim evidence/i)

		const wrongDirectClaimRoot = structuredClone(compacted)
		if (wrongDirectClaimRoot.checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
		wrongDirectClaimRoot.checkpoint.directClaimMmr.root = hash('wrong-direct-claim-mmr-root')
		expect(() => validateCarryProofJournal(wrongDirectClaimRoot)).toThrow(/directClaimMmr\.root does not commit/i)

		const wrongDirectClaimCount = structuredClone(compacted)
		if (wrongDirectClaimCount.checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
		wrongDirectClaimCount.checkpoint.directClaimMmr.leafCount = '0'
		expect(() => validateCarryProofJournal(wrongDirectClaimCount)).toThrow(/direct-claim MMR.*peak/i)

		const duplicateEvidence = structuredClone(compacted)
		const duplicated = duplicateEvidence.checkpoint?.directClaimEvidence[0]
		if (duplicated === undefined || duplicateEvidence.checkpoint === undefined) throw new Error('Expected compacted direct-claim evidence')
		duplicateEvidence.checkpoint.directClaimEvidence.push(structuredClone(duplicated))
		expect(() => validateCarryProofJournal(duplicateEvidence)).toThrow(/duplicate direct-claim evidence/i)
	})

	test('replays thousands of mutations with fixed-depth indexed work and no per-event state materialization', () => {
		const eventCount = 4_096
		const events = Array.from({ length: eventCount }, (_, index) => localEvent(sourceGame, sourcePool, leaf({ amount: 1n, cumulative: BigInt(index + 1), parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) }), 1, index))
		const replay = replayCarryProofJournal(journal(events, 1))
		expect(replay.games[sourceGame.toLowerCase()]?.state.outcomes[1].currentSlots).toHaveLength(eventCount)
		expect(replay.instrumentation.accumulatorCount).toBe(1)
		expect(replay.instrumentation.streamingMutationCount).toBe(eventCount)
		expect(replay.instrumentation.accumulatorBuildSlotVisits).toBe(0)
		expect(replay.instrumentation.fullStateMaterializations).toBe(1)
		expect(replay.instrumentation.materializedSlotVisits).toBe(eventCount)
		expect(replay.instrumentation.mmrHashOperations).toBeLessThan(eventCount * 2)
	})

	test('rejects sparse-game replay amplification below the serialized resident-record limit', () => {
		const sparseGameCount = Math.floor(CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST / (CARRY_PROOF_REPLAY_GAME_BASE_COST + CARRY_PROOF_REPLAY_SLOT_COST)) + 1
		const events = Array.from({ length: sparseGameCount }, (_, index) => {
			const game = address(10_000 + index)
			return localEvent(game, sourcePool, leaf({ amount: 1n, cumulative: 1n, parentDepositIndex: 0n, sourceNodeId: 1n }), 1, index)
		})
		expect(events.length).toBeLessThan(CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS)
		expect(() => replayCarryProofJournal(journal(events, 1))).toThrow(`indexed replay exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST.toString()}-unit safety limit`)
	})

	test('rejects an oversized unsigned decimal lexically before bigint conversion', () => {
		const serialized = serializedCarryProofJournal(checkpointJournalFixture().journal)
		const oversizedDecimal = '9'.repeat(100_000)
		const adversarial = serialized.replace('"nodeId": "1"', `"nodeId": "${oversizedDecimal}"`)
		expect(adversarial).not.toBe(serialized)
		expect(() => parseCarryProofJournal(adversarial)).toThrow('nodeId exceeds uint256')
	})

	test('rejects nested checkpoint digit bombs and dense indexes during structural preflight', () => {
		const compacted = compactCarryProofJournal(checkpointJournalFixture().journal)
		const oversizedDecimal = '9'.repeat(100_000)
		const digitBomb = structuredClone(compacted)
		const digitBombSlot = digitBomb.checkpoint?.games[0]?.state.outcomes[1].currentSlots[0]
		if (digitBombSlot === undefined) throw new Error('Expected a compacted checkpoint slot')
		digitBombSlot.leaf.amountAttoRep = oversizedDecimal
		expect(() => validateCarryProofJournal(digitBomb)).toThrow('amountAttoRep exceeds uint256')

		const dense = structuredClone(compacted)
		const denseOutcome = dense.checkpoint?.games[0]?.state.outcomes[0]
		if (denseOutcome === undefined) throw new Error('Expected a compacted checkpoint outcome')
		const denseNullifierCount = Math.floor(CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST / CARRY_PROOF_REPLAY_NULLIFIER_COST) + 1
		denseOutcome.nullifier.consumed = Array.from({ length: denseNullifierCount }, (_, index) => ({ parentDepositIndex: index.toString(), path: '0' }))
		expect(denseNullifierCount).toBeLessThan(CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS)
		expect(() => validateCarryProofJournal(dense)).toThrow(`indexed replay exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST.toString()}-unit safety limit`)
	})

	test('signals canonical cursor reorgs and rejects duplicate, out-of-order, and unmarked checkpoint records', () => {
		const fixture = checkpointJournalFixture()
		expect(assessCarryJournalReorg(fixture.journal, { blockHash: hash('replacement'), blockNumber: '3' })).toMatchObject({ resetFromBlock: '1', resetRequired: true })
		expect(assessCarryJournalReorg(fixture.journal, { blockHash: blockHash(2), blockNumber: '2' }).resetRequired).toBe(true)
		expect(assessCarryJournalReorg(fixture.journal, fixture.journal.cursor)).toEqual({ resetRequired: false })
		expect(assessCarryJournalReorg(fixture.journal, { blockHash: blockHash(4), blockNumber: '4' }).resetRequired).toBe(true)
		const duplicate = { ...fixture.journal, events: [...fixture.journal.events, fixture.journal.events.at(-1)] }
		expect(() => validateCarryProofJournal(duplicate as CarryProofJournal)).toThrow('duplicate log')
		const unmarked = journal([...fixture.source.events, checkpointEvent(fixture.checkpoint, childPool, sourcePool, 3)], 3)
		expect(() => replayCarryProofJournal(unmarked)).toThrow('no canonical SecurityPoolForkSnapshot')
	})

	test('authenticates fork snapshots against their drain, source state, and unique parent pool', () => {
		const fixture = checkpointJournalFixture()
		const drain = forkDrain(fixture.checkpoint, 2)
		const snapshot = forkSnapshot(fixture.checkpoint, 2)
		const wrongDrain = { ...drain, amountAttoRep: 29n.toString() }
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, wrongDrain, snapshot], 2))).toThrow(/escalation REP does not match its dispute drain/i)
		const wrongSnapshot = { ...snapshot, escalationSnapshotId: hash('wrong-snapshot') }
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, drain, wrongSnapshot], 2))).toThrow(/does not match any canonical source carry state/i)
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, drain], 2))).toThrow(/dispute drain without its same-transaction fork snapshot/i)
		const repeatedPool = { ...resolvedForkSnapshot(4, 0), pool: sourcePool }
		expect(() => replayCarryProofJournal(appendCarryProofJournalEvents(fixture.journal, [repeatedPool], { blockHash: blockHash(4), blockNumber: '4' }))).toThrow(/pool.*duplicated/i)
	})

	test('authenticates unresolved fork REP by fork mode and zeroes resolved-fork-only fields', () => {
		const fixture = checkpointJournalFixture()
		const drain = forkDrain(fixture.checkpoint, 2)
		const ownFork = forkSnapshot(fixture.checkpoint, 2)
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, drain, ownFork], 2))).not.toThrow()
		const invalidOwnFork = { ...ownFork, escalationChildRepAtForkAttoRep: ownFork.escalationSourceRepAtForkAttoRep }
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, drain, invalidOwnFork], 2))).toThrow(/child escalation REP does not match its fork mode/i)

		const nonOwnFork = { ...ownFork, escalationChildRepAtForkAttoRep: ownFork.escalationSourceRepAtForkAttoRep, ownFork: false }
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, drain, nonOwnFork], 2))).not.toThrow()
		const invalidNonOwnFork = { ...nonOwnFork, escalationChildRepAtForkAttoRep: (BigInt(nonOwnFork.escalationSourceRepAtForkAttoRep) - 1n).toString() }
		expect(() => replayCarryProofJournal(journal([...fixture.source.events, drain, invalidNonOwnFork], 2))).toThrow(/child escalation REP does not match its fork mode/i)

		const resolved = resolvedForkSnapshot(4, 0)
		expect(() => replayCarryProofJournal(journal([resolved], 4))).not.toThrow()
		expect(() => replayCarryProofJournal(journal([{ ...resolved, ownFork: true }], 4))).toThrow(/resolved .* cannot be an own fork/i)
		for (const field of ['escalationElapsedAtFork', 'escalationStartBondAtForkAttoRep', 'escalationNonDecisionThresholdAtForkAttoRep'] as const) {
			expect(() => replayCarryProofJournal(journal([{ ...resolved, [field]: '1' }], 4))).toThrow(/nonzero escalation timing or threshold fields/i)
		}
	})

	test('authenticates ABI identity, consumption roots, and ClaimDeposit transferredRep semantics', () => {
		const source = sourceFixture()
		const consumed = consumptionEvent(source.history, {
			amountAttoRep: 10n.toString(),
			block: 2,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const wrongTransfer = journal([...source.events, consumed.event, claimEvent(consumed.event, 2, true)], 2)
		expect(() => replayCarryProofJournal(wrongTransfer)).toThrow('instead of 0')
		const wrongRoot = journal([...source.events, { ...consumed.event, resultingCarryRoot: hash('wrong-root') }, claimEvent(consumed.event, 2)], 2)
		expect(() => replayCarryProofJournal(wrongRoot)).toThrow('does not match event root')
		expect(() => replayCarryProofJournal(journal([...source.events, { ...consumed.event, reason: 4 }], 2))).toThrow('reason 4 has no canonical producer')

		const serialized = serializedCarryProofJournal(checkpointJournalFixture().journal)
		const wrongSignature = serialized.replace('LocalDepositAppended(uint256,uint8,address,uint256,uint256,uint256)', 'LocalDepositAppended(uint256)')
		expect(() => parseCarryProofJournal(wrongSignature)).toThrow('signature does not match')
	})

	test('accepts only winning-claim reason and transferred REP for inherited carry consumption', () => {
		const fixture = checkpointJournalFixture()
		const childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, fixture.checkpoint, fixture.source.history)
		const consumed = consumptionEvent(childHistory, {
			amountAttoRep: 10n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		expect(consumed.event.reason).toBe(0)
		const valid = journal([...fixture.events, consumed.event, claimEvent(consumed.event, 4, true)], 4)
		expect(replayCarryProofJournal(valid).directlyClaimedDeposits).toEqual([])

		const wrongTransfer = journal([...fixture.events, consumed.event, claimEvent(consumed.event, 4)], 4)
		expect(() => replayCarryProofJournal(wrongTransfer)).toThrow(/carry reason 0 instead of 3/i)

		for (const reason of [1, 2, 3, 4] as const) {
			const invalidConsumption = { ...consumed.event, reason }
			const suffix: CarryProofJournalEvent[] = reason === 3 ? [invalidConsumption, claimEvent(invalidConsumption, 4)] : [invalidConsumption]
			expect(() => replayCarryProofJournal(journal([...fixture.events, ...suffix], 4))).toThrow(reason === 4 ? /reason 4 has no canonical producer/i : /inherited carry consumption.*reason/i)
		}
		const wrongUnresolved = { ...consumed.event, resultingUnresolvedTotalAttoRep: 19n.toString() }
		expect(() => replayCarryProofJournal(journal([...fixture.events, wrongUnresolved, claimEvent(wrongUnresolved, 4, true)], 4))).toThrow(/does not match replay-derived 20/i)
	})

	test('derives inherited local overflow from prior consumption before a same-block haircut', () => {
		const first = leaf({ amount: 1n, cumulative: 1n, parentDepositIndex: 0n, sourceNodeId: 1n })
		const second = leaf({ amount: 1n, cumulative: 2n, parentDepositIndex: 1n, sourceNodeId: 2n })
		let sourceHistory = createCarryGameHistory(sourceGame, sourcePool)
		sourceHistory = appendLocalCarryLeaf(sourceHistory, first)
		sourceHistory = appendLocalCarryLeaf(sourceHistory, second)
		const childCheckpoint = checkpointFor(currentCarryGameState(sourceHistory), childGame, sourceGame)
		const childEvents: CarryProofJournalEvent[] = [localEvent(sourceGame, sourcePool, first, 1), localEvent(sourceGame, sourcePool, second, 1, 1), forkDrain(childCheckpoint, 2), forkSnapshot(childCheckpoint, 2), checkpointEvent(childCheckpoint, childPool, sourcePool, 3)]
		const direct = consumptionEvent(sourceHistory, {
			amountAttoRep: 1n.toString(),
			block: 4,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 1n.toString(),
			sourceNodeId: '1',
		})
		const childParentDepositIndex = (BigInt(childGame) << 96n) | (1n << 88n)
		const childLocal = leaf({ amount: 1n, cumulative: 3n, parentDepositIndex: childParentDepositIndex, sourceNodeId: 1n })
		let childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, childCheckpoint, sourceHistory)
		childHistory = appendLocalCarryLeaf(childHistory, childLocal)
		const beforeChildHaircut = journal([...childEvents, direct.event, claimEvent(direct.event, 4), localEvent(childGame, childPool, childLocal, 5)], 5)
		const childHaircutAccounting = deriveTruthAuctionHaircutJournalEventAccounting(beforeChildHaircut, {
			game: childGame,
			pool: childPool,
			repBeforeAttoRep: 3n.toString(),
			repRemainingAttoRep: 2n.toString(),
		})
		expect(childHaircutAccounting).toEqual({ resolutionBalancesAttoRep: ['0', '2', '0'], unresolvedTotalsAttoRep: ['0', '1', '0'] })
		const childHaircut: TruthAuctionHaircutJournalEvent = {
			emitter: childGame,
			kind: 'truth-auction-haircut',
			pool: childPool,
			position: position(6, 0),
			rebasedElapsed: '7',
			repBeforeAttoRep: 3n.toString(),
			repRemainingAttoRep: 2n.toString(),
			repRemovedAttoRep: 1n.toString(),
			resultingResolutionBalancesAttoRep: childHaircutAccounting.resolutionBalancesAttoRep,
			resultingUnresolvedTotalsAttoRep: childHaircutAccounting.unresolvedTotalsAttoRep,
			signature: 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)',
		}
		childHistory = setCarryGameAccounting(childHistory, childHaircutAccounting)
		const grandchildCheckpoint = checkpointFor(currentCarryGameState(childHistory), grandchildGame, childGame)
		const recursiveEvents: CarryProofJournalEvent[] = [...beforeChildHaircut.events, childHaircut, forkDrain(grandchildCheckpoint, 7, childPool, childGame), forkSnapshot(grandchildCheckpoint, 7, childPool), checkpointEvent(grandchildCheckpoint, grandchildPool, childPool, 8)]
		const grandchildParentDepositIndex = (BigInt(grandchildGame) << 96n) | (1n << 88n)
		const grandchildLocal = leaf({ amount: 1n, cumulative: 3n, parentDepositIndex: grandchildParentDepositIndex, sourceNodeId: 1n })
		let grandchildHistory = initializeCarryGameFromCheckpoint(grandchildGame, grandchildPool, grandchildCheckpoint, childHistory)
		grandchildHistory = appendLocalCarryLeaf(grandchildHistory, grandchildLocal)
		const priorConsumption = consumptionEvent(grandchildHistory, {
			amountAttoRep: 1n.toString(),
			block: 10,
			parentDepositIndex: childParentDepositIndex.toString(),
			resultingUnresolvedTotalAttoRep: 1n.toString(),
			sourceNodeId: '1',
		})
		const beforeOverflow = journal([...recursiveEvents, localEvent(grandchildGame, grandchildPool, grandchildLocal, 9), priorConsumption.event, claimEvent(priorConsumption.event, 10, true)], 10)
		const beforeOverflowGame = replayCarryProofJournal(beforeOverflow).games[grandchildGame.toLowerCase()]
		if (beforeOverflowGame === undefined) throw new Error('Expected replayed grandchild before overflow consumption')
		expect(beforeOverflowGame.rawAccounting).toEqual(rawAccounting(['0', '0', '0'], ['0', '1', '0']))

		const overflowConsumption = consumptionEvent(priorConsumption.history, {
			amountAttoRep: 1n.toString(),
			block: 11,
			parentDepositIndex: '1',
			resultingUnresolvedTotalAttoRep: 0n.toString(),
			sourceNodeId: '2',
		})
		const beforeGrandchildHaircut = appendCarryProofJournalEvents(beforeOverflow, [overflowConsumption.event, claimEvent(overflowConsumption.event, 11, true)], {
			blockHash: blockHash(11),
			blockNumber: '11',
		})
		const grandchildHaircutAccounting = deriveTruthAuctionHaircutJournalEventAccounting(beforeGrandchildHaircut, {
			game: grandchildGame,
			pool: grandchildPool,
			repBeforeAttoRep: 2n.toString(),
			repRemainingAttoRep: 1n.toString(),
		})
		const grandchildHaircut: TruthAuctionHaircutJournalEvent = {
			emitter: grandchildGame,
			kind: 'truth-auction-haircut',
			pool: grandchildPool,
			position: position(11, 2, 'consume-11'),
			rebasedElapsed: '7',
			repBeforeAttoRep: 2n.toString(),
			repRemainingAttoRep: 1n.toString(),
			repRemovedAttoRep: 1n.toString(),
			resultingResolutionBalancesAttoRep: grandchildHaircutAccounting.resolutionBalancesAttoRep,
			resultingUnresolvedTotalsAttoRep: grandchildHaircutAccounting.unresolvedTotalsAttoRep,
			signature: 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)',
		}
		const overflowJournal = appendCarryProofJournalEvents(beforeGrandchildHaircut, [grandchildHaircut], {
			blockHash: blockHash(11),
			blockNumber: '11',
		})
		const replay = replayCarryProofJournal(overflowJournal)
		const grandchild = replay.games[grandchildGame.toLowerCase()]
		if (grandchild === undefined) throw new Error('Expected replayed grandchild carry game')
		expect(grandchild.rawAccounting).toEqual(rawAccounting(['0', '0', '0'], ['0', '0', '0']))
		expect(carryGameAccounting(grandchild.state)).toEqual({
			resolutionBalancesAttoRep: ['0', '1', '0'],
			unresolvedTotalsAttoRep: ['0', '0', '0'],
		})

		let roundTripped = compactCarryProofJournal(overflowJournal)
		for (let round = 0; round < 3; round += 1) {
			roundTripped = parseCarryProofJournal(serializedCarryProofJournal(roundTripped))
			const replayed = replayCarryProofJournal(roundTripped).games[grandchildGame.toLowerCase()]
			if (replayed === undefined) throw new Error('Expected compacted grandchild carry game')
			expect(replayed.localUnresolvedTotalsAttoRep).toEqual(['0', '0', '0'])
			expect(replayed.rawAccounting).toEqual(rawAccounting(['0', '0', '0'], ['0', '0', '0']))
		}
	})

	test('replays checkpoint plus suffix exactly across post-cutover deposit, consumption, direct claim, and recursive fork', () => {
		const fixture = checkpointJournalFixture()
		const compactedPrefix = compactCarryProofJournal(fixture.journal, {
			[childGame.toLowerCase()]: rawAccounting(['0', '30', '0'], ['0', '0', '0']),
		})
		expect(compactedPrefix.events).toEqual([])
		expect(compactedPrefix.checkpoint?.cutoff).toEqual(fixture.journal.cursor)

		let childHistory = initializeCarryGameFromCheckpoint(childGame, childPool, fixture.checkpoint, fixture.source.history)
		const childParentDepositIndex = (BigInt(childGame) << 96n) | (1n << 88n)
		const local = leaf({ amount: 5n, cumulative: 35n, parentDepositIndex: childParentDepositIndex, sourceNodeId: 1n })
		childHistory = appendLocalCarryLeaf(childHistory, local)
		const consumed = consumptionEvent(childHistory, {
			amountAttoRep: 10n.toString(),
			block: 5,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 25n.toString(),
			sourceNodeId: '1',
		})
		const grandchildCheckpoint = checkpointFor(currentCarryGameState(consumed.history), grandchildGame, childGame)
		const suffix: CarryProofJournalEvent[] = [localEvent(childGame, childPool, local, 4), consumed.event, claimEvent(consumed.event, 5, true), forkDrain(grandchildCheckpoint, 6, childPool, childGame), forkSnapshot(grandchildCheckpoint, 6, childPool), checkpointEvent(grandchildCheckpoint, grandchildPool, childPool, 7)]
		const full = journal([...fixture.events, ...suffix], 7)
		const checkpointAndSuffix = appendCarryProofJournalEvents(compactedPrefix, suffix, { blockHash: blockHash(7), blockNumber: '7' })
		const fullReplay = replayCarryProofJournal(full, depositor)
		const compactReplay = replayCarryProofJournal(checkpointAndSuffix, depositor)
		expect(compactReplay.games).toEqual(fullReplay.games)
		expect(compactReplay.directlyClaimedDeposits).toEqual(fullReplay.directlyClaimedDeposits)
		expect(compactReplay.proofCandidates).toEqual(fullReplay.proofCandidates)
		expect(compactReplay.proofCandidates.map(candidate => candidate.proof)).toEqual(fullReplay.proofCandidates.map(candidate => candidate.proof))
		expect(compactReplay.checkpointSnapshotCount).toBe(fullReplay.checkpointSnapshotCount)

		const compactedAgain = compactCarryProofJournal(checkpointAndSuffix, {
			[childGame.toLowerCase()]: rawAccounting(['0', '20', '0'], ['0', '5', '0']),
			[grandchildGame.toLowerCase()]: rawAccounting(['0', '25', '0'], ['0', '0', '0']),
		})
		const replayedAgain = replayCarryProofJournal(compactedAgain, depositor)
		expect(replayedAgain.games).toEqual(fullReplay.games)
		expect(replayedAgain.directlyClaimedDeposits).toEqual(fullReplay.directlyClaimedDeposits)
		expect(replayedAgain.proofCandidates).toEqual(fullReplay.proofCandidates)
		expect(replayedAgain.checkpointSnapshotCount).toBe(fullReplay.checkpointSnapshotCount)
		expect(compactedAgain.checkpoint?.prefixEventCount).toBe(full.events.length.toString())
		expect(parseCarryProofJournal(serializedCarryProofJournal(compactedAgain))).toEqual(compactedAgain)
		expect(carryProofJournalDigest(compactedAgain)).toMatch(/^0x[0-9a-f]{64}$/)
	})

	test('fails closed when irreducible fork-topology evidence exceeds the resident envelope', () => {
		const atLimitCount = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS - CARRY_MMR_MAXIMUM_PEAKS * 2
		const atLimit = compactCarryProofJournal(
			journal(
				Array.from({ length: atLimitCount }, (_, index) => resolvedForkSnapshot(1, index)),
				1,
			),
		)
		expect(atLimit.events).toEqual([])
		expect(atLimit.checkpoint?.forkSnapshotPools).toHaveLength(atLimitCount)
		expect(() => appendCarryProofJournalEventsWithCompaction(atLimit, [resolvedForkSnapshot(2, 0)], { blockHash: blockHash(2), blockNumber: '2' })).toThrow('resident safety limit')
	})

	test('uses transient headroom for one bounded response when compaction restores the durable envelope', () => {
		const locallySettledCount = 8_000
		const atResidentCap = journal(locallySettledEvents(locallySettledCount, 1), 1)
		const additions = Array.from({ length: CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS }, (_, index) => resolvedForkSnapshot(2, index))
		const compacted = appendCarryProofJournalEventsWithCompaction(atResidentCap, additions, { blockHash: blockHash(2), blockNumber: '2' })
		expect(compacted.events).toEqual([])
		expect(compacted.checkpoint?.prefixEventCount).toBe((locallySettledCount * 2 + CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS).toString())
		expect(validateCarryProofJournal(compacted)).toEqual(compacted)
	})

	test('atomically round-trips an owner-only checksummed sidecar with deployment-profile identity', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			expect(await validateCarryProofJournalSidecarIfPresent(runtimeStatePath, identity)).toBe('absent')
			await expect(stat(carryProofJournalSidecarPath(runtimeStatePath))).rejects.toThrow()
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			expect((await stat(sidecar)).mode & 0o777).toBe(0o600)
			expect(await validateCarryProofJournalSidecarIfPresent(runtimeStatePath, identity)).toBe('valid')
			await expect(validateCarryProofJournalSidecarIfPresent(runtimeStatePath, { ...identity, profileId: 'profile:other' })).rejects.toThrow('different deployment profile')
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(fixture)
			await expect(loadCarryProofJournal(runtimeStatePath, { ...identity, profileId: 'profile:other' })).rejects.toThrow('different deployment profile')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects aggregate payload, resident-record, and segment-count overflow before opening a segment', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-manifest-bounds-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			await writeFile(sidecar, segmentedManifest({ payloadBytes: CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES + 1, residentRecords: 0, segments: [segmentDescriptor(0)] }), { mode: 0o600 })
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('payloadBytes exceeds the aggregate payload safety limit')

			await writeFile(
				sidecar,
				segmentedManifest({
					payloadBytes: CARRY_PROOF_JOURNAL_SEGMENT_BYTES * 2,
					residentRecords: CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS + 1,
					segments: [segmentDescriptor(0), segmentDescriptor(1)],
				}),
			)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('residentRecords exceeds the resident record safety limit')

			await writeFile(
				sidecar,
				segmentedManifest({
					payloadBytes: CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES,
					residentRecords: 0,
					segments: Array.from({ length: CARRY_PROOF_JOURNAL_MAXIMUM_SEGMENTS + 1 }, (_, index) => segmentDescriptor(index)),
				}),
			)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('segmentCount exceeds the segment-count safety limit')

			await writeFile(sidecar, Buffer.alloc(CARRY_PROOF_JOURNAL_SEGMENT_BYTES + 1))
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow(`exceeds its ${CARRY_PROOF_JOURNAL_SEGMENT_BYTES.toString()}-byte safety limit`)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects an oversized segment by stat before reading its contents', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-segment-stat-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			const segmentDirectory = carryProofJournalSegmentDirectory(runtimeStatePath)
			await mkdir(segmentDirectory, { mode: 0o700 })
			const first = segmentDescriptor(0)
			const second = segmentDescriptor(1, 1)
			await writeFile(sidecar, segmentedManifest({ payloadBytes: CARRY_PROOF_JOURNAL_SEGMENT_BYTES + 1, residentRecords: 1, segmentDirectory: basename(segmentDirectory), segments: [first, second] }), { mode: 0o600 })
			await writeFile(join(segmentDirectory, first.file), Buffer.alloc(CARRY_PROOF_JOURNAL_SEGMENT_BYTES + 1), { mode: 0o600 })
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow(`exceeds its ${CARRY_PROOF_JOURNAL_SEGMENT_BYTES.toString()}-byte safety limit`)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('retains the prior authenticated sidecar when a save exceeds the resident evidence envelope', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-resident-bounds-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const compacted = compactCarryProofJournal(fixture, {
				[childGame.toLowerCase()]: rawAccounting(['0', '30', '0'], ['0', '0', '0']),
			})
			const checkpoint = compacted.checkpoint
			if (checkpoint === undefined) throw new Error('Expected compacted carry checkpoint')
			const oversized: CarryProofJournal = {
				...compacted,
				checkpoint: {
					...checkpoint,
					prefixEventMmr: {
						...checkpoint.prefixEventMmr,
						peaks: Array.from({ length: CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS + 1 }, () => zeroHash),
					},
				},
			}
			await expect(saveCarryProofJournal(runtimeStatePath, oversized)).rejects.toThrow('resident safety limit')
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(fixture)
			expect(await readdir(carryProofJournalSegmentDirectory(runtimeStatePath))).toEqual([])
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('bounds crash-artifact cleanup work and succeeds on a deliberate retry', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-cleanup-bounds-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const segmentDirectory = carryProofJournalSegmentDirectory(runtimeStatePath)
			for (let index = 0; index < 257; index += 1) {
				const generation = `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
				await writeFile(join(segmentDirectory, `temporary.${index.toString()}.${generation}.tmp`), 'orphan', { mode: 0o600 })
			}
			for (let index = 0; index < 300; index += 1) await writeFile(join(directory, `unrelated-${index.toString().padStart(3, '0')}`), 'unrelated')
			const advanced = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
			await expect(saveCarryProofJournal(runtimeStatePath, advanced)).rejects.toThrow('per-save safety limit')
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(fixture)
			await saveCarryProofJournal(runtimeStatePath, advanced)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(advanced)
			expect((await readdir(segmentDirectory)).some(file => file.startsWith('temporary.'))).toBeFalse()
			expect((await readdir(directory)).filter(file => file.startsWith('unrelated-'))).toHaveLength(300)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('persists large authenticated checkpoints as bounded owner-only checksummed segments', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-segmented-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const events = Array.from({ length: 4_096 }, (_, index) => localEvent(sourceGame, sourcePool, leaf({ amount: 1n, cumulative: BigInt(index + 1), parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) }), 1, index))
			const compacted = compactCarryProofJournal(journal(events, 1), {})
			await saveCarryProofJournal(runtimeStatePath, compacted)
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			const segmentDirectory = carryProofJournalSegmentDirectory(runtimeStatePath)
			expect(await readFile(sidecar, 'utf8')).toContain('zoltar-chaos-carry-proof-journal-segmented-v3')
			const segmentNames = (await readdir(segmentDirectory)).filter(file => file.startsWith('segment.'))
			expect(segmentNames.length).toBeGreaterThan(1)
			expect((await stat(segmentDirectory)).mode & 0o777).toBe(0o700)
			for (const file of segmentNames) expect((await stat(join(segmentDirectory, file))).mode & 0o777).toBe(0o600)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(compacted)
			expect(await probeCarryJournalPeakMemoryGrowth(runtimeStatePath)).toBeLessThan(256 * 1024)
			const orphanSegment = `segment.${segmentGeneration}.99999999.part`
			const orphanTemporary = `temporary.999.${segmentGeneration}.tmp`
			await writeFile(join(segmentDirectory, orphanSegment), 'orphan', { mode: 0o600 })
			await writeFile(join(segmentDirectory, orphanTemporary), 'orphan', { mode: 0o600 })
			const advanced = appendCarryProofJournalEvents(compacted, [], { blockHash: blockHash(2), blockNumber: '2' })
			injectCarryProofJournalPostCommitFaultForTesting('cleanup')
			await saveCarryProofJournal(runtimeStatePath, advanced)
			const advancedSegmentNames = (await readdir(segmentDirectory)).filter(file => file.startsWith('segment.'))
			expect(advancedSegmentNames.some(file => segmentNames.includes(file))).toBeTrue()
			expect(advancedSegmentNames).not.toContain(orphanSegment)
			expect(await readdir(segmentDirectory)).not.toContain(orphanTemporary)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(advanced)
			const restoredParent = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-relocated-'))
			try {
				const restoredDirectory = join(restoredParent, 'restored-state')
				await cp(directory, restoredDirectory, { recursive: true })
				await chmod(carryProofJournalSegmentDirectory(join(restoredDirectory, 'operator.json')), 0o700)
				expect(await loadCarryProofJournal(join(restoredDirectory, 'operator.json'), identity)).toEqual(advanced)
			} finally {
				await rm(restoredParent, { force: true, recursive: true })
			}
			const advancedManifest = await readFile(sidecar, 'utf8')
			const advancedManifestValue = objectRecord(JSON.parse(advancedManifest), 'advanced carry manifest')
			const underreportedManifest = segmentedManifestContents({ ...advancedManifestValue, residentRecords: '0' })
			expect(underreportedManifest).not.toBe(advancedManifest)
			await writeFile(sidecar, underreportedManifest)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('resident record count does not match its segmented manifest')
			const manifestIdentity = objectRecord(advancedManifestValue['identity'], 'advanced carry manifest identity')
			await writeFile(sidecar, segmentedManifestContents({ ...advancedManifestValue, identity: { ...manifestIdentity, profileId: 'profile:manifest-only' } }))
			await expect(archiveCarryProofJournalForProfileReset(runtimeStatePath, { ...identity, profileId: 'profile:manifest-replacement' }, carryProofJournalDigest(advanced))).rejects.toThrow('different deployment profile')
			await writeFile(sidecar, advancedManifest)
			const otherRuntimeStatePath = join(directory, 'other-operator.json')
			await saveCarryProofJournal(otherRuntimeStatePath, advanced)
			const otherSidecar = carryProofJournalSidecarPath(otherRuntimeStatePath)
			const otherManifest = objectRecord(JSON.parse(await readFile(otherSidecar, 'utf8')), 'other carry manifest')
			const otherSegmentDirectory = carryProofJournalSegmentDirectory(otherRuntimeStatePath)
			const otherSegmentsBefore = await readdir(otherSegmentDirectory)
			await writeFile(sidecar, segmentedManifestContents({ ...advancedManifestValue, segmentDirectory: basename(otherSegmentDirectory) }))
			await expect(saveCarryProofJournal(runtimeStatePath, advanced)).rejects.toThrow('different segment directory')
			expect(await readdir(otherSegmentDirectory)).toEqual(otherSegmentsBefore)
			expect(otherManifest['segmentDirectory']).toBe(basename(otherSegmentDirectory))
			await writeFile(sidecar, advancedManifest)

			const firstSegment = /"file": "([^"]+\.part)"/.exec(advancedManifest)?.[1]
			if (firstSegment === undefined) throw new Error('Expected a persisted carry-journal segment')
			const segmentPath = join(segmentDirectory, firstSegment)
			const corrupted = await readFile(segmentPath)
			const firstByte = corrupted[0]
			if (firstByte === undefined) throw new Error('Carry-journal segment is empty')
			corrupted[0] = firstByte ^ 1
			await writeFile(segmentPath, corrupted)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('checksum does not match its manifest')
			corrupted[0] = firstByte
			await rm(segmentPath)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow()
			await writeFile(segmentPath, corrupted, { mode: 0o600 })
			const temporarilyMissingDirectory = `${segmentDirectory}.missing`
			await rename(segmentDirectory, temporarilyMissingDirectory)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow()
			await rename(temporarilyMissingDirectory, segmentDirectory)
			const replacementIdentity = { ...identity, profileId: 'profile:segmented-replacement' }
			const archivedPath = await archiveCarryProofJournalForProfileReset(runtimeStatePath, replacementIdentity, carryProofJournalDigest(advanced))
			if (archivedPath === undefined) throw new Error('Expected segmented carry journal archive')
			const archivedManifest = await readFile(archivedPath, 'utf8')
			expect(archivedManifest).toContain('zoltar-chaos-carry-proof-journal-segmented-v3')
			const archivedSegments = [...archivedManifest.matchAll(/"file": "([^"]+\.part)"/g)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
			expect(archivedSegments.length).toBeGreaterThan(1)
			const archivedSegmentDirectoryName = /"segmentDirectory": "([^"]+)"/.exec(archivedManifest)?.[1]
			if (archivedSegmentDirectoryName === undefined) throw new Error('Expected archived carry segment directory')
			const archivedSegmentDirectory = join(directory, archivedSegmentDirectoryName)
			const replacement = await loadCarryProofJournal(runtimeStatePath, replacementIdentity)
			await saveCarryProofJournal(runtimeStatePath, replacement)
			for (const file of archivedSegments) expect((await stat(join(archivedSegmentDirectory, file))).mode & 0o777).toBe(0o600)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('archives an incompatible sidecar only for an authorized deployment-profile reset', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-profile-reset-'))
		try {
			const runtimeStatePath = join(directory, 'runtime.json')
			const fixture = checkpointJournalFixture().journal
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const replacementIdentity = { ...identity, profileId: 'profile:replacement' }
			await expect(loadCarryProofJournal(runtimeStatePath, replacementIdentity)).rejects.toThrow('different deployment profile')
			const replacement = await loadCarryProofJournal(runtimeStatePath, replacementIdentity, { allowProfileReset: true })
			const archivePrefix = `${basename(carryProofJournalSidecarPath(runtimeStatePath))}.profile-reset.`
			const archivedFiles = (await readdir(directory)).filter(file => file.startsWith(archivePrefix))
			expect(archivedFiles).toHaveLength(1)
			const archivedFile = archivedFiles[0]
			if (archivedFile === undefined) throw new Error('Expected the old carry sidecar to be archived')
			const archivedPath = join(directory, archivedFile)
			expect((await stat(archivedPath)).mode & 0o777).toBe(0o600)
			expect(parseCarryProofJournal(await readFile(archivedPath, 'utf8'), { chainId: identity.chainId, profileId: identity.profileId, securityPoolForker: identity.securityPoolForker, startBlock: identity.startBlock })).toEqual(fixture)
			expect(replacement).toMatchObject({ events: [], profileId: replacementIdentity.profileId })
			expect((await loadCarryProofJournal(runtimeStatePath, replacementIdentity)).profileId).toBe(replacementIdentity.profileId)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('serializes a profile archive with a save queued at the same mutation boundary', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-archive-queue-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			const advanced = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const replacementIdentity = { ...identity, profileId: 'profile:queued-replacement' }
			const [archivedPath, saveError] = await Promise.all([
				archiveCarryProofJournalForProfileReset(runtimeStatePath, replacementIdentity, carryProofJournalDigest(fixture)),
				saveCarryProofJournal(runtimeStatePath, advanced).then(
					() => new Error('Expected stale queued save to fail'),
					error => error,
				),
			])
			if (archivedPath === undefined) throw new Error('Expected queued carry journal archive')
			expect(parseCarryProofJournal(await readFile(archivedPath, 'utf8'))).toEqual(fixture)
			expect(saveError).toBeInstanceOf(Error)
			expect(saveError).toHaveProperty('message', expect.stringContaining('different deployment profile'))
			expect(await loadCarryProofJournal(runtimeStatePath, replacementIdentity)).toEqual(createCarryProofJournal(replacementIdentity))
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('queues save validation behind an active sidecar mutation', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-preparation-queue-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			const firstEvent = fixture.events[0]
			if (firstEvent === undefined) throw new Error('Expected a carry journal event')
			const invalid = { ...fixture, events: [...fixture.events, firstEvent] }
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const completionOrder: string[] = []
			const replacementIdentity = { ...identity, profileId: 'profile:validation-queue-replacement' }
			const archivePromise = archiveCarryProofJournalForProfileReset(runtimeStatePath, replacementIdentity, carryProofJournalDigest(fixture)).then(path => {
				completionOrder.push('archive')
				return path
			})
			const rejectedSavePromise = saveCarryProofJournal(runtimeStatePath, invalid).then(
				() => new Error('Expected invalid queued save to fail'),
				error => {
					completionOrder.push('save rejection')
					return error
				},
			)
			const [archivedPath, saveError] = await Promise.all([archivePromise, rejectedSavePromise])
			if (archivedPath === undefined) throw new Error('Expected queued carry journal archive')
			expect(completionOrder).toEqual(['archive', 'save rejection'])
			expect(saveError).toBeInstanceOf(Error)
			expect(saveError).toHaveProperty('message', expect.stringContaining('duplicate log'))
			expect(parseCarryProofJournal(await readFile(archivedPath, 'utf8'))).toEqual(fixture)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('binds equal-cursor replacement and canonical reset to the expected persisted revision', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-revision-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			const atFour = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
			await saveCarryProofJournal(runtimeStatePath, atFour)
			const atFourRevision = carryProofJournalDigest(atFour)
			const divergent = { ...atFour, cursor: { blockHash: blockHash(44), blockNumber: '4' } }
			await expect(saveCarryProofJournal(runtimeStatePath, divergent)).rejects.toThrow(/changes canonical hash.*reset authorization/i)
			await expect(saveCarryProofJournal(runtimeStatePath, divergent, { expectedCurrentRevision: atFourRevision })).rejects.toThrow(/changes canonical hash.*reset authorization/i)
			const emptyAtFour = appendCarryProofJournalEvents(createCarryProofJournal(identity), [], atFour.cursor)
			await expect(saveCarryProofJournal(runtimeStatePath, emptyAtFour, { expectedCurrentRevision: atFourRevision })).rejects.toThrow(/diverges from persisted cursor/i)

			const compacted = compactCarryProofJournal(atFour, {
				[childGame.toLowerCase()]: rawAccounting(['0', '30', '0'], ['0', '0', '0']),
			})
			await saveCarryProofJournal(runtimeStatePath, compacted, { expectedCurrentRevision: atFourRevision })
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(compacted)

			const atFive = appendCarryProofJournalEvents(compacted, [], { blockHash: blockHash(5), blockNumber: '5' })
			const compactedRevision = carryProofJournalDigest(compacted)
			await saveCarryProofJournal(runtimeStatePath, atFive, { expectedCurrentRevision: compactedRevision })
			const reset = createCarryProofJournal(identity)
			await expect(saveCarryProofJournal(runtimeStatePath, reset, { allowCanonicalReset: true })).rejects.toThrow(/requires an expected current.*revision/i)
			await expect(saveCarryProofJournal(runtimeStatePath, reset, { allowCanonicalReset: true, expectedCurrentRevision: compactedRevision })).rejects.toThrow('changed after the replacement was prepared')
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(atFive)
			await saveCarryProofJournal(runtimeStatePath, reset, { allowCanonicalReset: true, expectedCurrentRevision: carryProofJournalDigest(atFive) })
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(reset)
			const scannedOrigin = appendCarryProofJournalEvents(reset, [], reset.cursor)
			await saveCarryProofJournal(runtimeStatePath, scannedOrigin, { expectedCurrentRevision: carryProofJournalDigest(reset) })
			await expect(saveCarryProofJournal(runtimeStatePath, reset, { expectedCurrentRevision: carryProofJournalDigest(scannedOrigin) })).rejects.toThrow(/clears canonical scan progress.*reset authorization/i)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('does not report a stale CAS revision after the active pointer has committed', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-post-commit-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const advanced = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
			injectCarryProofJournalPostCommitFaultForTesting('parent-directory-sync')
			await saveCarryProofJournal(runtimeStatePath, advanced, { expectedCurrentRevision: carryProofJournalDigest(fixture) })
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(advanced)

			const next = appendCarryProofJournalEvents(advanced, [], { blockHash: blockHash(5), blockNumber: '5' })
			await saveCarryProofJournal(runtimeStatePath, next, { expectedCurrentRevision: carryProofJournalDigest(advanced) })
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(next)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('snapshots queued save capabilities, payloads, and load identities at invocation', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-invocation-snapshot-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			const advanced = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
			await saveCarryProofJournal(runtimeStatePath, advanced)
			const options: { allowCanonicalReset?: boolean; expectedCurrentRevision?: Hash } = {}
			const unauthorizedReset = saveCarryProofJournal(runtimeStatePath, fixture, options)
			options.allowCanonicalReset = true
			await expect(unauthorizedReset).rejects.toThrow('precedes persisted cursor 4')

			const atFive = appendCarryProofJournalEvents(advanced, [], { blockHash: blockHash(5), blockNumber: '5' })
			const submittedHash = atFive.cursor.blockHash
			const submittedRevision = carryProofJournalDigest(atFive)
			const submittedSave = saveCarryProofJournal(runtimeStatePath, atFive)
			atFive.cursor.blockHash = blockHash(55)
			await submittedSave
			expect((await loadCarryProofJournal(runtimeStatePath, identity)).cursor.blockHash).toBe(submittedHash)

			const mutableIdentity = { ...identity, initialCursor: { ...identity.initialCursor }, profileId: 'profile:queued-load' }
			const submittedProfileId = mutableIdentity.profileId
			const archive = archiveCarryProofJournalForProfileReset(runtimeStatePath, mutableIdentity, submittedRevision)
			const queuedLoad = loadCarryProofJournal(runtimeStatePath, mutableIdentity)
			mutableIdentity.profileId = 'profile:mutated-after-load'
			await archive
			expect((await queuedLoad).profileId).toBe(submittedProfileId)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('authenticates archives and installs only an authorized distinct replacement profile atomically', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-atomic-profile-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			const replacementIdentity = { ...identity, profileId: 'profile:atomic-replacement' }
			await writeFile(sidecar, 'not-json', { mode: 0o600 })
			await expect(archiveCarryProofJournalForProfileReset(runtimeStatePath, replacementIdentity, zeroHash)).rejects.toThrow('not valid JSON')
			expect(await readFile(sidecar, 'utf8')).toBe('not-json')

			await rm(sidecar)
			const fixture = checkpointJournalFixture().journal
			const advanced = appendCarryProofJournalEvents(fixture, [], { blockHash: blockHash(4), blockNumber: '4' })
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const fixtureRevision = carryProofJournalDigest(fixture)
			await expect(archiveCarryProofJournalForProfileReset(runtimeStatePath, { ...replacementIdentity, chainId: 0 }, fixtureRevision)).rejects.toThrow(/chainId must be a positive safe integer/i)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(fixture)
			await expect(archiveCarryProofJournalForProfileReset(runtimeStatePath, identity, fixtureRevision)).rejects.toThrow(/different replacement identity/i)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(fixture)

			const replacementLoad = loadCarryProofJournal(runtimeStatePath, replacementIdentity, { allowProfileReset: true })
			const staleSave = saveCarryProofJournal(runtimeStatePath, advanced)
			expect(await replacementLoad).toEqual(createCarryProofJournal(replacementIdentity))
			await expect(staleSave).rejects.toThrow('different deployment profile')
			expect(await loadCarryProofJournal(runtimeStatePath, replacementIdentity)).toEqual(createCarryProofJournal(replacementIdentity))
			const archivePrefix = `${basename(sidecar)}.profile-reset.`
			expect((await readdir(directory)).filter(file => file.startsWith(archivePrefix))).toHaveLength(1)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects permissive, truncated, corrupt, and symbolic-link sidecars', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-corrupt-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			await chmod(sidecar, 0o644)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('owner-only mode 0600')
			await chmod(sidecar, 0o600)
			const complete = await readFile(sidecar, 'utf8')
			await writeFile(sidecar, complete.slice(0, -20), { mode: 0o600 })
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('not valid JSON')
			await writeFile(sidecar, complete.replace('profile:test', 'profile:evil'), { mode: 0o600 })
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('checksum does not match')

			await rm(sidecar, { force: true })
			const target = join(directory, 'target.json')
			await writeFile(target, complete, { mode: 0o600 })
			await symlink(target, sidecar)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('must not be a symbolic link')
			await expect(saveCarryProofJournal(runtimeStatePath, fixture)).rejects.toThrow('must not be a symbolic link')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})
})
