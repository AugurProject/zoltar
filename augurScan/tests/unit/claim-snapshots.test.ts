import { expect, test } from 'bun:test'
import { sampleClaimPositions } from '../../src/claim-snapshots.ts'
import { allocatedWinningPayout } from '../../src/claim-payout.ts'

test('separates retained principal from reward intervals and applies fork haircut after reward rounding', () => {
	expect(allocatedWinningPayout({ principal: 81n, rewardAmount: 33n, rewardCumulative: 75n, binding: 100n, winningBalance: 160n, forkThreshold: 500n, nonDecisionThreshold: 1000n })).toEqual({ payout: 47n, burn: 8n })
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

import { bagCarryPeaks, buildCarryMerkleMountainRangeProof, createSparseNullifier, hashCarryLeaf } from '../../../shared/core/ts/evm/carryProof.ts'
import { type Hex, getAddress } from '../../src/ethereum.ts'
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
	(options: { consumed?: bigint[]; directlyClaimed?: boolean; badRoot?: boolean; badNullifier?: boolean; pending?: boolean; cycle?: boolean } = {}): StateRead =>
	async (target, _abi, name, args = []) => {
		const outcome = Number(args[0] ?? 0)
		switch (name) {
			case 'securityPool':
				return target === root ? rootPool : childPool
			case 'forkContinuation':
				return target === child
			case 'parent':
				return options.cycle ? childPool : rootPool
			case 'escalationGame':
				return options.cycle ? child : root
			case 'securityPoolForker':
				return forker
			case 'getQuestionOutcome':
				return options.pending ? 3n : 1n
			case 'zoltar':
				return zoltar
			case 'universeId':
				return 1n
			case 'getForkTime':
				return 0n
			case 'getForkThresholdAttoRep':
				return 500n
			case 'getOutcomeState':
				return {
					balanceAttoRep: 150n,
					snapshotLeafCount: target === child && outcome === 1 ? 3n : 0n,
					snapshotPeaks: target === child && outcome === 1 && !options.badRoot ? peaks : Array.from({ length: 64 }, () => zero),
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
			case 'isEscalationDepositClaimedDirectly':
				return options.directlyClaimed === true && args[2] === 1n
			case 'getInheritedClaimAllocation':
				return [50n, 33n, 33n, (Number(args[3]) + 1) * 33 + '']
			default:
				throw new Error(`Unexpected ${name}`)
		}
	}

test('reconstructs inherited membership and independent unspent proofs with tagged allocations', async () => {
	const result = await sampleClaimPositions(child, fixtureRead(), state)
	expect(result.status).toBe('available')
	expect(result.positions).toHaveLength(3)
	expect(result.positions[2]).toMatchObject({ kind: 'inherited', status: 'claimable', retained_principal_atto_rep: '33', auction_haircut_atto_rep: '17', payout_atto_rep: '23', burn_atto_rep: '8', proof: { leafIndex: '2', merkleMountainRangePeakIndex: '0', merkleMountainRangeSiblings: [peaks[1]] } })
	expect(result.positions[2]?.['membership_root']).toBe(buildCarryMerkleMountainRangeProof(hashes, 2).root)
	expect(result.positions.every(position => position['nullifier_root'] === createSparseNullifier([]).getRoot())).toBe(true)
})

test('excludes consumed leaves, suppresses direct parent claims, and retains pending statuses', async () => {
	const consumed = await sampleClaimPositions(child, fixtureRead({ consumed: [0n], directlyClaimed: true }), state)
	expect(consumed.positions).toHaveLength(2)
	expect(consumed.positions[0]).toMatchObject({ status: 'claimed-in-parent', payout_atto_rep: undefined })
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
			case 'securityPool':
				return pool(id - 1000)
			case 'forkContinuation':
				return id !== 1000
			case 'parent':
				return pool(id - 2001)
			case 'escalationGame':
				return game(id - 2000)
			case 'securityPoolForker':
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
			case 'getOutcomeState':
				return { balanceAttoRep: 0n, snapshotLeafCount: 0n, snapshotPeaks: Array.from({ length: 64 }, () => zero), currentNullifierRoot: createSparseNullifier([]).getRoot(), localHeadNodeId: 0n }
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
