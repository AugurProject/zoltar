import { expect, test } from 'bun:test'
import { sampleClaimPositions } from '../../src/claim-snapshots.ts'
import { allocatedWinningPayout, ordinaryWinningPayout } from '../../src/claim-payout.ts'

test('separates retained principal from reward intervals and applies fork haircut after reward rounding', () => {
	expect(allocatedWinningPayout({ principal: 81n, rewardAmount: 33n, rewardCumulative: 75n, binding: 100n, winningBalance: 160n, forkThreshold: 500n, nonDecisionThreshold: 1000n })).toEqual({ payout: 47n, burn: 8n })
})

test('ordinary payout intervals telescope across reward and haircut rounding', () => {
	const base = { principal: 1n, rewardAmount: 1n, rewardCumulative: 0n, binding: 7n, winningBalance: 11n, forkThreshold: 13n, nonDecisionThreshold: 19n }
	let payout = 0n
	let burn = 0n
	for (let end = 1n; end <= 11n; end++) {
		const part = ordinaryWinningPayout({ ...base, rewardCumulative: end })
		payout += part.payout
		burn += part.burn
	}
	expect({ payout, burn }).toEqual(ordinaryWinningPayout({ ...base, principal: 11n, rewardAmount: 11n, rewardCumulative: 11n }))
	expect({ payout, burn }).toEqual({ payout: 10n, burn: 2n })
})

test('failed proof reads produce explicit unavailable evidence rather than claimable principal', async () => {
	await expect(
		sampleClaimPositions(
			'0x1111111111111111111111111111111111111111',
			async () => {
				throw new Error('pruned state')
			},
			{},
		),
	).rejects.toThrow('pruned state')
})

import { bagCarryPeaks, buildCarryMerkleMountainRangeProof, createSparseNullifier, hashCarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { abiForKind } from '../../src/abi-catalog.ts'
import { encodeFunctionData, type Hex, getAddress } from '../../src/ethereum.ts'
import type { StateRead } from '../../src/snapshots.ts'

const root = getAddress('0x1111111111111111111111111111111111111111')
const child = getAddress('0x2222222222222222222222222222222222222222')
const rootPool = getAddress('0x3333333333333333333333333333333333333333')
const childPool = getAddress('0x4444444444444444444444444444444444444444')
const owner = getAddress('0x5555555555555555555555555555555555555555')
const forker = getAddress('0x6666666666666666666666666666666666666666')
const zoltar = getAddress('0x7777777777777777777777777777777777777777')
const zero: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
const state = { finalQuestionResolution: '1', endTimestamp: '100', bindingCapitalAttoRep: String(100n), nonDecisionThresholdAttoRep: String(1000n) }
const fixtureKinds = new Map([
	[root, 'escalationGame'],
	[child, 'escalationGame'],
	[rootPool, 'questionLedger'],
	[childPool, 'questionLedger'],
	[forker, 'questionForker'],
	[zoltar, 'zoltar'],
])
const leaves = [0n, 1n, 2n].map(index => ({ depositor: owner, amountAttoRep: 50n, parentDepositIndex: index, cumulativeAmountAttoRep: (index + 1n) * 50n, sourceNodeId: index + 1n }))
const hashes = leaves.map(leaf => hashCarryLeaf(leaf, 1))
const first = hashes[0]
const second = hashes[1]
const third = hashes[2]
if (first === undefined || second === undefined || third === undefined) throw new Error('Missing fixture leaves')
const peaks = Array.from({ length: 64 }, () => zero)
peaks[0] = third
peaks[1] = bagCarryPeaks([first, second])

const fixtureRead =
	(options: { consumed?: bigint[]; badRoot?: boolean; badNullifier?: boolean; pending?: boolean; cycle?: boolean; recordedForkThreshold?: bigint; forkTime?: bigint } = {}): StateRead =>
	async (target, _abi, name, args = []) => {
		const kind = fixtureKinds.get(target)
		if (kind === undefined) throw new Error(`Unexpected claim target ${target}`)
		const abi = abiForKind(kind)
		if (abi === undefined) throw new Error(`Missing compiled claim ABI ${kind}`)
		encodeFunctionData({ abi, functionName: name, args })
		const outcome = Number(args[0] ?? 0)
		switch (name) {
			case 'questionLedger':
				return target === root ? rootPool : childPool
			case 'forkContinuation':
				return target === child
			case 'parent':
				return options.cycle ? childPool : rootPool
			case 'escalationGame':
				return options.cycle ? child : root
			case 'questionForker':
				return forker
			case 'getQuestionOutcome':
				return options.pending ? 3n : 1n
			case 'zoltar':
				return zoltar
			case 'universeId':
				return 1n
			case 'getForkTime':
				return options.forkTime ?? 0n
			case 'getForkThresholdAttoRep':
				return 500n
			case 'settlementForkThresholdAttoRep':
				return options.recordedForkThreshold ?? 0n
			case 'getOutcomeState':
				return {
					balanceAttoRep: 150n,
					snapshotLeafCount: target === child && outcome === 1 ? 3n : 0n,
					snapshotCarryRoot: target === child && outcome === 1 && !options.badRoot ? buildCarryMerkleMountainRangeProof(hashes, 0).root : zero,
					currentNullifierRoot: options.badNullifier ? zero : createSparseNullifier(target === child && outcome === 1 ? (options.consumed ?? []) : []).getRoot(),
					localHeadNodeId: target === root && outcome === 1 ? 3n : 0n,
				}
			case 'getCarryLeafPageByOutcome':
				return [target === root && outcome === 1 ? leaves : [], 0n]
			case 'nodes': {
				const leaf = leaves[Number(args[0]) - 1]
				if (leaf === undefined) throw new Error('Missing node fixture')
				return [leaf.sourceNodeId - 1n, owner, 1n, leaf.amountAttoRep, leaf.parentDepositIndex, leaf.cumulativeAmountAttoRep, leaf.sourceNodeId - 1n]
			}
			case 'getProofConsumedCarriedDepositIndexesByOutcome':
				return target === child && outcome === 1 ? (options.consumed ?? []) : []
			default:
				throw new Error(`Unexpected ${name}`)
		}
	}

test('reconstructs inherited membership and independent unspent proofs with tagged allocations', async () => {
	const result = await sampleClaimPositions(child, fixtureRead(), state)
	expect(result.status).toBe('available')
	expect(result.positions).toHaveLength(3)
	expect(result.positions[2]).toMatchObject({ kind: 'inherited', status: 'claimable', retained_principal_atto_rep: '50', payout_atto_rep: '35', burn_atto_rep: '13', proof: { leafIndex: '2', merkleMountainRangePeakIndex: '0', merkleMountainRangeSiblings: [peaks[1]] } })
	expect(result.positions.every(position => !('auction_haircut_atto_rep' in position))).toBe(true)
	expect(result.positions[2]?.['membership_root']).toBe(buildCarryMerkleMountainRangeProof(hashes, 2).root)
	expect(result.positions.every(position => position['nullifier_root'] === createSparseNullifier([]).getRoot())).toBe(true)
})

test('ordinary claim evidence uses the recorded threshold and telescoping interval payouts', async () => {
	const result = await sampleClaimPositions(root, fixtureRead({ recordedForkThreshold: 7n }), state)
	expect(result.positions.map(position => position['payout_atto_rep'])).toEqual(['0', '0', '1'])
	expect(result.positions.map(position => position['burn_atto_rep'])).toEqual(['13', '13', '14'])
	expect(result.positions[2]?.['calculation']).toMatchObject({ fork_threshold_atto_rep: '7' })
})

test('claim evidence uses the threshold the game recorded instead of the live one', async () => {
	const live = await sampleClaimPositions(root, fixtureRead(), state)
	expect(live.positions[2]?.['calculation']).toMatchObject({ fork_threshold_atto_rep: '500' })
	const recorded = await sampleClaimPositions(root, fixtureRead({ recordedForkThreshold: 900n }), state)
	expect(recorded.positions[2]?.['calculation']).toMatchObject({ fork_threshold_atto_rep: '900' })
})

test('a game with no recorded threshold uses the live threshold even after a later fork', async () => {
	const result = await sampleClaimPositions(root, fixtureRead({ forkTime: 200n }), state)
	expect(result.positions[2]?.['calculation']).toMatchObject({ fork_threshold_atto_rep: '500' })
})

test('claim snapshots continue past empty consumed-node pages', async () => {
	const read = fixtureRead()
	const rootHash = buildCarryMerkleMountainRangeProof([...hashes, ...Array.from({ length: 125 }, () => zero)], 0).root
	const cursors: unknown[] = []
	const sparseRead: StateRead = async (target, abi, name, args = []) => {
		if (name === 'getOutcomeState' && args[0] === 1) {
			return { balanceAttoRep: 150n, snapshotLeafCount: target === child ? 128n : 0n, snapshotCarryRoot: rootHash, currentNullifierRoot: createSparseNullifier([]).getRoot(), localHeadNodeId: target === root ? 128n : 0n }
		}
		if (name === 'getCarryLeafPageByOutcome' && target === root && args[0] === 1) {
			cursors.push(args[1])
			expect(args[2]).toBe(100n)
			return args[1] === 0n ? [[], 28n] : [[...leaves].reverse(), 0n]
		}
		if (name === 'nodes' && typeof args[0] === 'bigint' && args[0] > 3n) {
			const nodeId = args[0]
			return [nodeId - 1n, owner, 1n, 50n, nodeId - 1n, nodeId * 50n, nodeId - 1n]
		}
		return await read(target, abi, name, args)
	}
	const result = await sampleClaimPositions(child, sparseRead, state)
	expect(result.positions).toHaveLength(3)
	expect(result.positions.map(position => position['deposit_index'])).toEqual(['0', '1', '2'])
	expect(cursors).toEqual([0n, 28n])
})

test('excludes consumed leaves and retains unspent inherited claims and pending statuses', async () => {
	const consumed = await sampleClaimPositions(child, fixtureRead({ consumed: [0n] }), state)
	expect(consumed.positions).toHaveLength(2)
	expect(consumed.positions[0]).toMatchObject({ status: 'claimable' })
	expect(consumed.positions[1]).toMatchObject({ status: 'claimable' })
	const pending = await sampleClaimPositions(child, fixtureRead({ pending: true }), { ...state, finalQuestionResolution: '3' })
	expect(pending.positions.every(position => position['status'] === 'pending' && position['payout_atto_rep'] === undefined)).toBe(true)
})

test('fails closed for mismatched proof commitments and cyclic ancestors', async () => {
	await expect(sampleClaimPositions(child, fixtureRead({ badRoot: true }), state)).rejects.toThrow('membership commitment mismatch')
	await expect(sampleClaimPositions(child, fixtureRead({ badNullifier: true }), state)).rejects.toThrow('nullifier commitment mismatch')
	await expect(sampleClaimPositions(child, fixtureRead({ cycle: true }), state)).rejects.toThrow('ancestry cycle')
})

test('ancestry reconstruction accepts 32 games including the sampled game and rejects 33', async () => {
	const game = (index: number) =>
		getAddress(
			`0x${BigInt(1000 + index)
				.toString(16)
				.padStart(40, '0')}`,
		)
	const pool = (index: number) =>
		getAddress(
			`0x${BigInt(2000 + index)
				.toString(16)
				.padStart(40, '0')}`,
		)
	const read: StateRead = async (target, _abi, name) => {
		const id = Number(BigInt(target))
		switch (name) {
			case 'questionLedger':
				return pool(id - 1000)
			case 'forkContinuation':
				return id !== 1000
			case 'parent':
				return pool(id - 2001)
			case 'escalationGame':
				return game(id - 2000)
			case 'questionForker':
				return forker
			case 'getQuestionOutcome':
				return 1n
			case 'zoltar':
				return zoltar
			case 'universeId':
				return 1n
			case 'getForkTime':
				return 0n
			case 'getForkThresholdAttoRep':
				return 1000n
			case 'settlementForkThresholdAttoRep':
				return 0n
			case 'getOutcomeState':
				return { balanceAttoRep: 0n, snapshotLeafCount: 0n, snapshotCarryRoot: zero, currentNullifierRoot: createSparseNullifier([]).getRoot(), localHeadNodeId: 0n }
			case 'getCarryLeafPageByOutcome':
				return [[], 0n]
			case 'getProofConsumedCarriedDepositIndexesByOutcome':
				return []
			default:
				throw new Error(`Unexpected ancestry read ${name}`)
		}
	}
	expect((await sampleClaimPositions(game(31), read, state)).status).toBe('available')
	await expect(sampleClaimPositions(game(32), read, state)).rejects.toThrow('32-generation limit')
})

test('authenticated claims need no ancestor preparation', async () => {
	const result = await sampleClaimPositions(child, fixtureRead(), state)
	expect(result.positions).toHaveLength(3)
	for (const position of result.positions) {
		expect(position['status']).toBe('claimable')
		expect(position['source_principal_atto_rep']).toBe(position['principal_atto_rep'])
		expect(position['retained_principal_atto_rep']).toBe(position['principal_atto_rep'])
		expect(position['reward_amount_atto_rep']).toBe(position['principal_atto_rep'])
		expect(position['payout_atto_rep']).toBeDefined()
	}
})
