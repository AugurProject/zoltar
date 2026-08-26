import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, toHex, zeroHash, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import { appendLocalCarryLeaf, applyCarryConsumption, carryCheckpointSnapshotId, carryCommitment, carryGameAccounting, createCarryGameHistory, currentCarryGameState, setCarryGameAccounting, sparseNullifierRoot, type CarryGameState, type CarryOutcome, type CarryTriple } from '../../src/monitoring/carry-proof-index.ts'
import { carryProofScanDigest, carryProofWithdrawalsDigest, carryUpdateMatchingCommitment, carryUpdateMatchingDigest, updateCarryProofJournal, type CarryProofScanContext } from '../../src/monitoring/carry-proof-scan.ts'
import {
	appendCarryProofJournalEvents,
	CARRY_DEPOSIT_CONSUMED_SIGNATURE,
	CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD,
	CLAIM_DEPOSIT_SIGNATURE,
	compactCarryProofJournal,
	DISPUTE_STAKED_REP_DRAINED_SIGNATURE,
	FORK_CARRY_CHECKPOINT_SIGNATURE,
	LOCAL_DEPOSIT_APPENDED_SIGNATURE,
	SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE,
	TRUTH_AUCTION_HAIRCUT_SIGNATURE,
} from '../../src/monitoring/carry-proof-journal.ts'
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
		transactionIndex: 0,
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
	let history = appendLocalCarryLeaf(createCarryGameHistory(sourceGame, sourcePool), leaf)
	const consumed = applyCarryConsumption(history, {
		amountAttoRep: leaf.amountAttoRep,
		depositor,
		outcome: 0,
		parentDepositIndex: leaf.parentDepositIndex,
		resultingUnresolvedTotalAttoRep: 0n.toString(),
		sourceNodeId: leaf.sourceNodeId,
	})
	history = consumed.history
	const consumedState = currentCarryGameState(history)
	const resultingCarryRoot = carryCommitment(consumedState.outcomes[0].currentSlots).root
	const resultingNullifierRoot = sparseNullifierRoot(consumedState.outcomes[0].nullifier)
	history = setCarryGameAccounting(history, { resolutionBalancesAttoRep: ['5', '0', '0'], unresolvedTotalsAttoRep: ['0', '0', '0'] })
	const state = currentCarryGameState(history)
	const accounting = carryGameAccounting(state)
	const carryRoots = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root)
	const nullifierRoots = stateTriple(state, (value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier))
	const leafCounts = stateTriple(state, (value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount)
	const checkpointInput = {
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		sourceGame,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	}
	const snapshotId = carryCheckpointSnapshotId(checkpointInput)
	const claimTransaction = 20_002
	const forkTransaction = 20_004
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
			block: 2,
			data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], [0, 10n, 3, 0n, resultingNullifierRoot, resultingCarryRoot]),
			logIndex: 0,
			topics: [eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE), toHex(0n, { size: 32 }), toHex(1n, { size: 32 }), topicAddress(depositor)],
			transaction: claimTransaction,
		}),
		canonicalLog({
			address: sourceGame,
			block: 2,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], [10n, 0n, 0n, false]),
			logIndex: 1,
			topics: [eventTopic(CLAIM_DEPOSIT_SIGNATURE), topicAddress(depositor), toHex(0n, { size: 32 }), toHex(0n, { size: 32 })],
			transaction: claimTransaction,
		}),
		canonicalLog({
			address: sourceGame,
			block: 3,
			data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 5n, 5n, 7n]),
			logIndex: 0,
			topics: [eventTopic(TRUTH_AUCTION_HAIRCUT_SIGNATURE)],
		}),
		canonicalLog({
			address: forker,
			block: 4,
			data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
			logIndex: 0,
			topics: [eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE), topicAddress(sourcePool), topicAddress(sourceGame)],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: forker,
			block: 4,
			data: encodeAbiParameters([{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [true, true, 0n, 0n, 0n, 0n, 0n, 1n, 100n, 7n, snapshotId]),
			logIndex: 2,
			topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(sourcePool), topicAddress(address(800))],
			transaction: forkTransaction,
		}),
		canonicalLog({
			address: childGame,
			block: 5,
			data: encodeAbiParameters([{ type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }], [carryRoots, nullifierRoots, leafCounts.map(BigInt), accounting.unresolvedTotalsAttoRep.map(BigInt), accounting.resolutionBalancesAttoRep.map(BigInt)]),
			logIndex: 0,
			topics: [eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE), topicAddress(sourceGame), snapshotId],
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
				[true, true, 0n, 0n, 10n, 10n, 10n, 1n, 10n, 0n, snapshotId],
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

function anchoredCandidateClient(fixture: ReturnType<typeof unconsumedCarryFixture>) {
	const base = scanClient(fixture.logs)
	const zoltar = address(700)
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
			if (functionName === 'parent' && target === childPool) return sourcePool
			if (functionName === 'escalationGame' && target === childPool) return childGame
			if (functionName === 'escalationGame' && target === sourcePool) return sourceGame
			if (functionName === 'securityPoolForker' && target === childPool) return forker
			if (functionName === 'systemState' && target === childPool) return 0n
			if (functionName === 'isEscalationResolved' && target === childPool) return true
			if (functionName === 'universeId' && target === childPool) return 1n
			if (functionName === 'zoltar' && target === childPool) return zoltar
			if (functionName === 'securityPool' && target === childGame) return childPool
			if (functionName === 'forkCarrySnapshotInitialized' && target === childGame) return true
			if (functionName === 'getFinalQuestionResolution' && target === childGame) return 0
			if (functionName === 'getQuestionOutcome' && target === forker) return 0
			if (functionName === 'isEscalationDepositClaimedDirectly' && target === forker) return false
			if (functionName === 'getDirectlyClaimedEscalationPrincipal' && target === forker) return 0n
			if (functionName === 'getOutcomeState' && target === childGame) return outcomeStates[Number(args[0])]
			if (functionName === 'getForkCarrySnapshot' && target === childGame) {
				return {
					carryLeafCounts: fixture.leafCounts.map(BigInt),
					carryPeaks: outcomeStates.map(state => state.currentPeaks),
					carryTotalsAttoRep: fixture.accounting.unresolvedTotalsAttoRep.map(BigInt),
					nullifierRoots: fixture.nullifierRoots,
				}
			}
			if ((functionName === 'applyInheritedClaimRetention' || functionName === 'applyInheritedSourceStorageBasis') && target === childGame) {
				const amountAttoRep = args[0]
				if (typeof amountAttoRep !== 'bigint') throw new Error(`${functionName} amount is not a bigint`)
				return amountAttoRep
			}
			if (functionName === 'getBindingCapitalAttoRep' && target === childGame) return 10n
			if (functionName === 'nonDecisionThresholdAttoRep' && target === childGame) return 10n
			if (functionName === 'getEscalationGameEndDate' && target === childGame) return 100n
			if (functionName === 'getForkThresholdAttoRep' && target === zoltar) return 10n
			if (functionName === 'getForkTime' && target === zoltar) return 0n
			throw new Error(`Unexpected read ${functionName} on ${target}`)
		},
		async simulateContract(parameters: { address: Address; functionName: string }) {
			if (parameters.address === childGame && parameters.functionName === 'withdrawDeposit') {
				return { result: { amountToWithdrawAttoRep: 16n, depositor, originalDepositAmountAttoRep: 10n } }
			}
			if (parameters.address === childPool && parameters.functionName === 'withdrawForkedEscalationDeposits') return { result: undefined }
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
		expect(update.journal.events.map(event => event.kind)).toEqual(['local-deposit-appended', 'carry-deposit-consumed', 'claim-deposit', 'truth-auction-haircut', 'dispute-staked-rep-drained-at-fork', 'security-pool-fork-snapshot', 'fork-carry-checkpoint'])
		expect(update.journal.events[0]).toMatchObject({ outcome: 0 })
	})

	test('automatically compacts a complete finalized block at the bounded suffix threshold', async () => {
		const data = encodeAbiParameters(
			[{ type: 'bool' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
			[false, false, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, zeroHash],
		)
		const logs = Array.from({ length: CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD }, (_, logIndex) =>
			canonicalLog({
				address: forker,
				block: 1,
				data,
				logIndex,
				topics: [eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE), topicAddress(sourcePool), topicAddress(address(800))],
			}),
		)
		const update = await updateCarryProofJournal(context(scanClient(logs), 1n))
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
