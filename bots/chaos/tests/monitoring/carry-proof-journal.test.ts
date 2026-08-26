import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '../support/bot-shared.ts'
import type { CanonicalUintString } from '../../src/core/units.ts'
import {
	appendLocalCarryLeaf,
	applyCarryConsumption,
	carryCheckpointSnapshotId,
	carryCommitment,
	carryGameAccounting,
	createCarryGameHistory,
	currentCarryGameState,
	initializeCarryGameFromCheckpoint,
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
	archiveCarryProofJournalForProfileReset,
	assessCarryJournalReorg,
	carryProofJournalDigest,
	carryProofJournalSidecarPath,
	compactCarryProofJournal,
	createCarryProofJournal,
	deriveTruthAuctionHaircutJournalEventAccounting,
	loadCarryProofJournal,
	parseCarryProofJournal,
	replayCarryProofJournal,
	saveCarryProofJournal,
	serializedCarryProofJournal,
	validateCarryProofJournal,
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
	return {
		auctionableAttoRepAtFork: 0n.toString(),
		emitter: forker,
		escalationChildRepAtForkAttoRep: 0n.toString(),
		escalationElapsedAtFork: '0',
		escalationNonDecisionThresholdAtForkAttoRep: 100n.toString(),
		escalationSnapshotId: checkpoint.snapshotId,
		escalationSourceRepAtForkAttoRep: 0n.toString(),
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

function consumptionEvent(history: CarryGameHistory, parameters: { amountAttoRep: CanonicalUintString; block: number; parentDepositIndex: string; resultingUnresolvedTotalAttoRep: CanonicalUintString; sourceNodeId: string; transaction?: string }) {
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
		reason: 3,
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
		pool: sourcePool,
		position: position(block, logIndex, `resolved-${block.toString()}`),
		settlementCollateralAtForkAttoEth: 0n.toString(),
		signature: 'SecurityPoolForkSnapshot(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)',
		totalPoolHeldRepAtForkAttoRep: 0n.toString(),
		unresolvedEscalation: false,
	}
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
		expect(replay.directlyClaimedDeposits).toEqual([{ outcome: 1, parentDepositIndex: '0', sourceGame }])
		expect(replay.proofCandidates.map(candidate => candidate.parentDepositIndex)).toEqual(['1'])
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
		expect(carryProofJournalDigest(rawAccountingChanged)).not.toBe(carryProofJournalDigest(compacted))
		expect(carryProofJournalDigest(prefixDigestChanged)).not.toBe(carryProofJournalDigest(compacted))
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

		const serialized = serializedCarryProofJournal(checkpointJournalFixture().journal)
		const wrongSignature = serialized.replace('LocalDepositAppended(uint256,uint8,address,uint256,uint256,uint256)', 'LocalDepositAppended(uint256)')
		expect(() => parseCarryProofJournal(wrongSignature)).toThrow('signature does not match')
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
		const suffix: CarryProofJournalEvent[] = [localEvent(childGame, childPool, local, 4), consumed.event, claimEvent(consumed.event, 5), forkDrain(grandchildCheckpoint, 6, childPool, childGame), forkSnapshot(grandchildCheckpoint, 6, childPool), checkpointEvent(grandchildCheckpoint, grandchildPool, childPool, 7)]
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

	test('streams beyond the former 250k-event stop through bounded whole-block cutovers', () => {
		const formerLimit = 250_000
		const batchSize = 10_000
		let compacted = createCarryProofJournal(identity)
		let total = 0
		for (let block = 1; total <= formerLimit; block += 1) {
			const count = Math.min(batchSize, formerLimit + 1 - total)
			const events = Array.from({ length: count }, (_, index) => resolvedForkSnapshot(block, index))
			compacted = compactCarryProofJournal(appendCarryProofJournalEvents(compacted, events, { blockHash: blockHash(block), blockNumber: block.toString() }), {})
			total += count
		}
		expect(compacted.events).toEqual([])
		expect(compacted.checkpoint?.prefixEventCount).toBe((formerLimit + 1).toString())
		expect(serializedCarryProofJournal(compacted).length).toBeLessThan(20_000)
		expect(validateCarryProofJournal(compacted)).toEqual(compacted)
	})

	test('atomically round-trips an owner-only checksummed sidecar with deployment-profile identity', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const fixture = checkpointJournalFixture().journal
			await saveCarryProofJournal(runtimeStatePath, fixture)
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			expect((await stat(sidecar)).mode & 0o777).toBe(0o600)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(fixture)
			await expect(loadCarryProofJournal(runtimeStatePath, { ...identity, profileId: 'profile:other' })).rejects.toThrow('different deployment profile')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('persists large authenticated checkpoints as owner-only checksummed segments without a total-size stop', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-carry-journal-segmented-'))
		try {
			const runtimeStatePath = join(directory, 'operator.json')
			const events = Array.from({ length: 4_096 }, (_, index) => localEvent(sourceGame, sourcePool, leaf({ amount: 1n, cumulative: BigInt(index + 1), parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) }), 1, index))
			const compacted = compactCarryProofJournal(journal(events, 1), {})
			await saveCarryProofJournal(runtimeStatePath, compacted)
			const sidecar = carryProofJournalSidecarPath(runtimeStatePath)
			expect(await readFile(sidecar, 'utf8')).toContain('zoltar-chaos-carry-proof-journal-segmented-v2')
			const segmentNames = (await readdir(directory)).filter(file => file.includes('.segment.'))
			expect(segmentNames.length).toBeGreaterThan(1)
			for (const file of segmentNames) expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600)
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(compacted)
			const advanced = appendCarryProofJournalEvents(compacted, [], { blockHash: blockHash(2), blockNumber: '2' })
			await saveCarryProofJournal(runtimeStatePath, advanced)
			const advancedSegmentNames = (await readdir(directory)).filter(file => file.includes('.segment.'))
			expect(advancedSegmentNames.some(file => segmentNames.includes(file))).toBeTrue()
			expect(await loadCarryProofJournal(runtimeStatePath, identity)).toEqual(advanced)

			const firstSegment = advancedSegmentNames[0]
			if (firstSegment === undefined) throw new Error('Expected a persisted carry-journal segment')
			const segmentPath = join(directory, firstSegment)
			const corrupted = await readFile(segmentPath)
			const firstByte = corrupted[0]
			if (firstByte === undefined) throw new Error('Carry-journal segment is empty')
			corrupted[0] = firstByte ^ 1
			await writeFile(segmentPath, corrupted)
			await expect(loadCarryProofJournal(runtimeStatePath, identity)).rejects.toThrow('checksum does not match its manifest')
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
			const archivedPath = await archiveCarryProofJournalForProfileReset(runtimeStatePath)
			if (archivedPath === undefined) throw new Error('Expected the old carry sidecar to be archived')
			expect((await stat(archivedPath)).mode & 0o777).toBe(0o600)
			expect(parseCarryProofJournal(await readFile(archivedPath, 'utf8'), { chainId: identity.chainId, profileId: identity.profileId, securityPoolForker: identity.securityPoolForker, startBlock: identity.startBlock })).toEqual(fixture)
			const replacement = await loadCarryProofJournal(runtimeStatePath, replacementIdentity)
			expect(replacement).toMatchObject({ events: [], profileId: replacementIdentity.profileId })
			await saveCarryProofJournal(runtimeStatePath, replacement)
			expect((await loadCarryProofJournal(runtimeStatePath, replacementIdentity)).profileId).toBe(replacementIdentity.profileId)
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
