import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '../support/bot-shared.ts'
import {
	applyCarryConsumption,
	applyCarryConsumptionToAccumulator,
	appendLocalCarryLeaf,
	assertNoNullifierPathCollisions,
	carryCheckpointSnapshotId,
	carryCommitment,
	carryGameAccounting,
	computeMerkleMountainRangeRootFromProof,
	computeNullifierRootFromProof,
	consumeSparseNullifier,
	createCarriedDepositProof,
	createCarriedDepositProofFromAccumulator,
	createCarryGameHistory,
	createMerkleMountainRangeProof,
	createSparseNullifierProof,
	currentCarryGameState,
	emptySparseNullifierState,
	hashCarryLeaf,
	hashCarryParent,
	initializeCarryGameFromCheckpoint,
	initializeCarryProofAccumulatorFromCheckpoint,
	materializeCarryProofAccumulatorState,
	matchCarryCheckpointSourceVersion,
	nullifierPath,
	sparseNullifierRoot,
	setCarryGameAccounting,
	validateCarryCheckpoint,
	validateCarryGameHistory,
	verifyCarriedDepositProof,
	verifyMerkleMountainRangeProof,
	verifySparseNullifierAbsence,
	type CarryCheckpoint,
	type CarryGameHistory,
	type CarryGameState,
	type CarryLeaf,
	type CarryOutcome,
	type CarryTriple,
} from '../../src/monitoring/carry-proof-index.ts'

function address(value: number): Address {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function hash(value: string): Hash {
	return keccak256(toHex(value))
}

function leaf(parameters: { amount?: bigint; cumulative?: bigint; depositor?: Address; outcome?: CarryOutcome; parentDepositIndex: bigint; sourceNodeId: bigint }): CarryLeaf {
	const amount = parameters.amount ?? 10n
	return {
		amountAttoRep: amount.toString(),
		cumulativeAmountAttoRep: (parameters.cumulative ?? amount).toString(),
		depositor: parameters.depositor ?? address(1),
		outcome: parameters.outcome ?? 1,
		parentDepositIndex: parameters.parentDepositIndex.toString(),
		sourceNodeId: parameters.sourceNodeId.toString(),
	}
}

function versionState(history: CarryGameHistory, sequence?: string) {
	if (sequence === undefined) return currentCarryGameState(history)
	const state = history.versions.find(version => version.sequence === sequence)?.state
	if (state === undefined) throw new Error(`Missing history version ${sequence}`)
	return state
}

function stateTriple<T>(factory: (state: CarryGameState, outcome: CarryOutcome) => T, state: CarryGameState): CarryTriple<T> {
	return [factory(state, 0), factory(state, 1), factory(state, 2)]
}

function checkpointFor(source: CarryGameHistory, targetGame: Address, sequence?: string): CarryCheckpoint {
	const state = versionState(source, sequence)
	const carryRoots = stateTriple((value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).root, state)
	const leafCounts = stateTriple((value, outcome) => carryCommitment(value.outcomes[outcome].currentSlots).leafCount, state)
	const nullifierRoots = stateTriple((value, outcome) => sparseNullifierRoot(value.outcomes[outcome].nullifier), state)
	const { unresolvedTotalsAttoRep, resolutionBalancesAttoRep } = carryGameAccounting(state)
	const commitment = {
		carryRoots,
		leafCounts,
		nullifierRoots,
		resolutionBalancesAttoRep,
		sourceGame: source.game,
		unresolvedTotalsAttoRep,
	}
	return {
		...commitment,
		snapshotId: carryCheckpointSnapshotId(commitment),
		targetGame,
	}
}

function append(history: CarryGameHistory, value: CarryLeaf) {
	return appendLocalCarryLeaf(history, value)
}

describe('fork-carry proof index', () => {
	test('hashes a carry leaf with the exact Solidity abi.encode layout', () => {
		const value = leaf({ amount: 17n, cumulative: 41n, outcome: 2, parentDepositIndex: 9n, sourceNodeId: 7n })
		const expected = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [value.depositor, 2, 17n, 9n, 41n, 7n]))
		expect(hashCarryLeaf(value)).toBe(expected)
	})

	test('matches Solidity MMR proofs for every leaf across single and multi-peak vectors', () => {
		for (const leafCount of [1, 2, 3, 5, 6]) {
			const hashes = Array.from({ length: leafCount }, (_, index) => hash(`leaf-${leafCount.toString()}-${index.toString()}`))
			const root = (() => {
				let history = createCarryGameHistory(address(100 + leafCount), address(200 + leafCount))
				for (let index = 0; index < leafCount; index += 1) {
					history = append(history, leaf({ amount: 1n, cumulative: BigInt(index + 1), parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) }))
				}
				const slots = currentCarryGameState(history).outcomes[1].currentSlots.map((slot, index) => ({ ...slot, hash: hashes[index] ?? slot.hash, leaf: { ...slot.leaf } }))
				// Arbitrary hashes are sufficient for the pure MMR verifier; construct the
				// root independently with the same append/bag shape below.
				const peaks: Array<Hash | undefined> = Array.from({ length: 64 }, () => undefined)
				let count = 0n
				for (const current of hashes) {
					let node = current
					let height = 0
					while (((count >> BigInt(height)) & 1n) === 1n) {
						const left = peaks[height]
						if (left === undefined) throw new Error('Missing fixture peak')
						node = hashCarryParent(left, node)
						peaks[height] = undefined
						height += 1
					}
					peaks[height] = node
					count += 1n
				}
				const occupied = peaks.filter((peak): peak is Hash => peak !== undefined)
				let bagged = occupied.at(-1)
				if (bagged === undefined) throw new Error('Missing fixture MMR root')
				for (let index = occupied.length - 2; index >= 0; index -= 1) {
					const peak = occupied[index]
					if (peak === undefined) throw new Error('Missing fixture bag peak')
					bagged = hashCarryParent(peak, bagged)
				}
				expect(slots).toHaveLength(leafCount)
				return bagged
			})()

			for (let index = 0; index < hashes.length; index += 1) {
				const proof = createMerkleMountainRangeProof(hashes, index)
				const leafHash = hashes[index]
				if (leafHash === undefined) throw new Error('Missing fixture leaf hash')
				expect(computeMerkleMountainRangeRootFromProof(leafHash, leafCount.toString(), proof)).toBe(root)
				expect(verifyMerkleMountainRangeProof(leafHash, leafCount.toString(), root, proof)).toBe(root)
			}
		}
	})

	test('uses a peak-relative leaf index and ascending-height other-peak order', () => {
		const hashes = Array.from({ length: 5 }, (_, index) => hash(`five-${index.toString()}`))
		const largePeakRoot = hashCarryParent(hashCarryParent(hashes[0] ?? zeroHash, hashes[1] ?? zeroHash), hashCarryParent(hashes[2] ?? zeroHash, hashes[3] ?? zeroHash))
		const tailProof = createMerkleMountainRangeProof(hashes, 4)
		expect(tailProof.leafIndex).toBe('0')
		expect(tailProof.merkleMountainRangePeakIndex).toBe('0')
		expect(tailProof.merkleMountainRangeSiblings).toEqual([largePeakRoot])

		const largePeakProof = createMerkleMountainRangeProof(hashes, 2)
		expect(largePeakProof.leafIndex).toBe('2')
		expect(largePeakProof.merkleMountainRangePeakIndex).toBe('2')
		expect(largePeakProof.merkleMountainRangeSiblings.at(-1)).toBe(hashes[4])
	})

	test('builds sequential 64-depth sparse nullifier proofs and rejects stale proofs', () => {
		const empty = emptySparseNullifierState()
		const firstProof = createSparseNullifierProof(empty, '0')
		expect(firstProof).toHaveLength(64)
		expect(verifySparseNullifierAbsence(empty, '0', firstProof)).toBe(sparseNullifierRoot(empty))

		const staleSecondProof = createSparseNullifierProof(empty, '1')
		const afterFirst = consumeSparseNullifier(empty, '0')
		const firstConsumedRoot = computeNullifierRootFromProof('0', firstProof, `0x${'0'.repeat(63)}1`)
		expect(firstConsumedRoot).toBe(sparseNullifierRoot(afterFirst))
		expect(() => verifySparseNullifierAbsence(afterFirst, '1', staleSecondProof)).toThrow('does not match')

		const currentSecondProof = createSparseNullifierProof(afterFirst, '1')
		expect(verifySparseNullifierAbsence(afterFirst, '1', currentSecondProof)).toBe(sparseNullifierRoot(afterFirst))
		const afterSecond = consumeSparseNullifier(afterFirst, '1')
		expect(sparseNullifierRoot(afterSecond)).not.toBe(sparseNullifierRoot(afterFirst))
		expect(() => consumeSparseNullifier(afterSecond, '1')).toThrow('already nullified')
	})

	test('detects explicit low-64-bit nullifier path collisions', () => {
		expect(() =>
			assertNoNullifierPathCollisions([
				{ parentDepositIndex: '1', path: '9' },
				{ parentDepositIndex: '2', path: '9' },
			]),
		).toThrow('path collision')
		expect(nullifierPath('1')).toBeLessThan(1n << 64n)
	})

	test('retains immutable historical versions and replaces a consumed local leaf with literal zero', () => {
		let source = createCarryGameHistory(address(10), address(20))
		source = append(source, leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n }))
		source = append(source, leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n }))
		source = append(source, leaf({ amount: 30n, cumulative: 60n, parentDepositIndex: 2n, sourceNodeId: 3n }))
		const before = versionState(source, '3')
		const nullifierBefore = sparseNullifierRoot(before.outcomes[1].nullifier)
		const consumed = applyCarryConsumption(source, {
			amountAttoRep: 20n.toString(),
			depositor: address(1),
			outcome: 1,
			parentDepositIndex: '1',
			resultingUnresolvedTotalAttoRep: 40n.toString(),
			sourceNodeId: '2',
		})
		expect(consumed.kind).toBe('local')
		const after = currentCarryGameState(consumed.history)
		expect(after.outcomes[1].currentSlots[1]?.hash).toBe(zeroHash)
		expect(after.outcomes[1].currentSlots[1]?.consumedLocally).toBe(true)
		expect(after.outcomes[1].snapshotSlots).toEqual([])
		expect(sparseNullifierRoot(after.outcomes[1].nullifier)).toBe(nullifierBefore)
		expect(versionState(consumed.history, '3')).toEqual(before)
		expect(versionState(consumed.history, '3').outcomes[1].currentSlots[1]?.hash).not.toBe(zeroHash)
	})

	test('validates checkpoint IDs and rejects tampered checkpoint fields', () => {
		let source = createCarryGameHistory(address(30), address(31))
		source = append(source, leaf({ parentDepositIndex: 0n, sourceNodeId: 1n }))
		const checkpoint = checkpointFor(source, address(32))
		expect(validateCarryCheckpoint(checkpoint)).toBe(checkpoint.snapshotId)
		expect(() => validateCarryCheckpoint({ ...checkpoint, leafCounts: ['0', '2', '0'] })).toThrow('does not match')
	})

	test('uses unresolved totals and resolution balances to distinguish otherwise identical historical commitments', () => {
		let source = createCarryGameHistory(address(33), address(34))
		source = append(source, leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n }))
		const beforeAccountingChange = checkpointFor(source, address(35), '1')
		source = setCarryGameAccounting(source, {
			resolutionBalancesAttoRep: ['0', '8', '0'],
			unresolvedTotalsAttoRep: ['0', '7', '0'],
		})
		const afterAccountingChange = checkpointFor(source, address(35), '2')

		expect(afterAccountingChange.carryRoots).toEqual(beforeAccountingChange.carryRoots)
		expect(afterAccountingChange.nullifierRoots).toEqual(beforeAccountingChange.nullifierRoots)
		expect(afterAccountingChange.leafCounts).toEqual(beforeAccountingChange.leafCounts)
		expect(matchCarryCheckpointSourceVersion(source, beforeAccountingChange).sequence).toBe('1')
		expect(matchCarryCheckpointSourceVersion(source, afterAccountingChange).sequence).toBe('2')

		const unmatchedAccounting = {
			...afterAccountingChange,
			unresolvedTotalsAttoRep: beforeAccountingChange.unresolvedTotalsAttoRep,
		}
		unmatchedAccounting.snapshotId = carryCheckpointSnapshotId(unmatchedAccounting)
		expect(() => matchCarryCheckpointSourceVersion(source, unmatchedAccounting)).toThrow('no matching historical source version')
	})

	test('initializes a child from an exact checkpoint and consumes inherited carry through the nullifier only', () => {
		let source = createCarryGameHistory(address(40), address(41))
		source = append(source, leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n }))
		source = append(source, leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n }))
		const child = initializeCarryGameFromCheckpoint(address(42), address(43), checkpointFor(source, address(42)), source)
		const before = currentCarryGameState(child)
		const proof = createCarriedDepositProof(before, 1, '0')
		expect(verifyCarriedDepositProof(before, 1, proof).carryRoot).toBe(carryCommitment(before.outcomes[1].snapshotSlots).root)

		const consumed = applyCarryConsumption(child, {
			amountAttoRep: 10n.toString(),
			depositor: address(1),
			outcome: 1,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		expect(consumed.kind).toBe('inherited')
		const after = currentCarryGameState(consumed.history)
		expect(after.outcomes[1].currentSlots).toEqual(before.outcomes[1].currentSlots)
		expect(after.outcomes[1].snapshotSlots).toEqual(before.outcomes[1].snapshotSlots)
		expect(sparseNullifierRoot(after.outcomes[1].nullifier)).not.toBe(sparseNullifierRoot(before.outcomes[1].nullifier))
		expect(() => createCarriedDepositProof(after, 1, '0')).toThrow('already nullified')
	})

	test('streams inherited consumption with proofs and state identical to the immutable reference engine', () => {
		let source = createCarryGameHistory(address(44), address(45))
		source = append(source, leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n }))
		source = append(source, leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n }))
		const checkpoint = checkpointFor(source, address(46))
		const child = initializeCarryGameFromCheckpoint(address(46), address(47), checkpoint, source)
		const childState = currentCarryGameState(child)
		const accumulator = initializeCarryProofAccumulatorFromCheckpoint(address(46), address(47), checkpoint, {
			game: source.game,
			state: currentCarryGameState(source),
		})
		expect(createCarriedDepositProofFromAccumulator(accumulator, 1, '1')).toEqual(createCarriedDepositProof(childState, 1, '1'))

		const reference = applyCarryConsumption(child, {
			amountAttoRep: 10n.toString(),
			depositor: address(1),
			outcome: 1,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		})
		const referenceState = currentCarryGameState(reference.history)
		expect(
			applyCarryConsumptionToAccumulator(accumulator, {
				amountAttoRep: 10n.toString(),
				depositor: address(1),
				expectedCarryRoot: carryCommitment(referenceState.outcomes[1].currentSlots).root,
				expectedNullifierRoot: sparseNullifierRoot(referenceState.outcomes[1].nullifier),
				outcome: 1,
				parentDepositIndex: '0',
				resultingUnresolvedTotalAttoRep: 20n.toString(),
				sourceNodeId: '1',
			}),
		).toBe('inherited')
		expect(materializeCarryProofAccumulatorState(accumulator)).toEqual(referenceState)
		expect(() => createCarriedDepositProofFromAccumulator(accumulator, 1, '0')).toThrow('already nullified')
	})

	test('builds a recursive ancestor proof containing a child-local sibling', () => {
		let parent = createCarryGameHistory(address(50), address(51))
		const ancestor = leaf({ amount: 30n, cumulative: 30n, parentDepositIndex: 0n, sourceNodeId: 1n })
		parent = append(parent, ancestor)

		let child = initializeCarryGameFromCheckpoint(address(52), address(53), checkpointFor(parent, address(52)), parent)
		const childParentDepositIndex = (BigInt(address(52)) << 96n) | (1n << 88n)
		const local = leaf({ amount: 10n, cumulative: 40n, parentDepositIndex: childParentDepositIndex, sourceNodeId: 1n })
		child = append(child, local)

		const grandchild = initializeCarryGameFromCheckpoint(address(54), address(55), checkpointFor(child, address(54)), child)
		const state = currentCarryGameState(grandchild)
		const proof = createCarriedDepositProof(state, 1, '0', '1')
		expect(proof.merkleMountainRangePeakIndex).toBe('1')
		expect(proof.leafIndex).toBe('0')
		expect(proof.merkleMountainRangeSiblings[0]).toBe(hashCarryLeaf(local))
		expect(verifyCarriedDepositProof(state, 1, proof).carryRoot).toBe(hashCarryParent(hashCarryLeaf(ancestor), hashCarryLeaf(local)))
	})

	test('matches a delayed checkpoint to the historical fork-time version after the source changes', () => {
		let source = createCarryGameHistory(address(60), address(61))
		source = append(source, leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n }))
		source = append(source, leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n }))
		const delayedCheckpoint = checkpointFor(source, address(62), '2')
		source = applyCarryConsumption(source, {
			amountAttoRep: 10n.toString(),
			depositor: address(1),
			outcome: 1,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		}).history
		expect(carryCommitment(currentCarryGameState(source).outcomes[1].currentSlots).root).not.toBe(delayedCheckpoint.carryRoots[1])

		const matched = matchCarryCheckpointSourceVersion(source, delayedCheckpoint)
		expect(matched.sequence).toBe('2')
		const child = initializeCarryGameFromCheckpoint(address(62), address(63), delayedCheckpoint, source)
		const proof = createCarriedDepositProof(currentCarryGameState(child), 1, '0')
		expect(verifyCarriedDepositProof(currentCarryGameState(child), 1, proof).carryRoot).toBe(delayedCheckpoint.carryRoots[1])
	})

	test('propagates inherited nullifiers recursively and makes stale descendant proofs impossible', () => {
		let parent = createCarryGameHistory(address(70), address(71))
		parent = append(parent, leaf({ amount: 10n, cumulative: 10n, parentDepositIndex: 0n, sourceNodeId: 1n }))
		parent = append(parent, leaf({ amount: 20n, cumulative: 30n, parentDepositIndex: 1n, sourceNodeId: 2n }))
		let child = initializeCarryGameFromCheckpoint(address(72), address(73), checkpointFor(parent, address(72)), parent)
		child = applyCarryConsumption(child, {
			amountAttoRep: 10n.toString(),
			depositor: address(1),
			outcome: 1,
			parentDepositIndex: '0',
			resultingUnresolvedTotalAttoRep: 20n.toString(),
			sourceNodeId: '1',
		}).history
		const grandchild = initializeCarryGameFromCheckpoint(address(74), address(75), checkpointFor(child, address(74)), child)
		const state = currentCarryGameState(grandchild)
		expect(() => createCarriedDepositProof(state, 1, '0')).toThrow('already nullified')
		const second = createCarriedDepositProof(state, 1, '1')
		expect(verifyCarriedDepositProof(state, 1, second).nullifierRoot).toBe(sparseNullifierRoot(state.outcomes[1].nullifier))
	})

	test('fails closed when a checkpoint does not match any retained source state', () => {
		let source = createCarryGameHistory(address(80), address(81))
		source = append(source, leaf({ parentDepositIndex: 0n, sourceNodeId: 1n }))
		const checkpoint = checkpointFor(source, address(82))
		const otherSource = createCarryGameHistory(address(83), address(84))
		expect(() => matchCarryCheckpointSourceVersion(otherSource, checkpoint)).toThrow('does not match carry history')
		const validIdWrongRoot = {
			...checkpoint,
			carryRoots: [checkpoint.carryRoots[0], hash('wrong-root'), checkpoint.carryRoots[2]] as CarryTriple<Hash>,
		}
		validIdWrongRoot.snapshotId = carryCheckpointSnapshotId(validIdWrongRoot)
		expect(() => matchCarryCheckpointSourceVersion(source, validIdWrongRoot)).toThrow('no matching historical source version')
	})

	test('is deterministic, JSON-safe, and does not mutate prior values', () => {
		const origin = createCarryGameHistory(address(90), address(91))
		const advanced = append(origin, leaf({ parentDepositIndex: 0n, sourceNodeId: 1n }))
		expect(origin.versions).toHaveLength(1)
		expect(advanced.versions).toHaveLength(2)
		expect(validateCarryGameHistory(advanced)).toBe(advanced)
		const serialized = JSON.stringify(advanced)
		expect(JSON.stringify(JSON.parse(serialized))).toBe(serialized)
	})
})
