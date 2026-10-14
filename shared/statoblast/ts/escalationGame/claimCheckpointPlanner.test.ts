import { expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { isFinalClaimCheckpointBatch, planClaimCheckpointPreparation, shouldInspectClaimCheckpointParent, type ClaimCheckpointProgress } from './claimCheckpoint.js'

const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, '0')}`)
const claim = { outcomeIndex: 1, amountAttoRep: 10n, cumulativeAmountAttoRep: 30n, leafIndex: 2n }
const pending = (pendingSteps = 0n): ClaimCheckpointProgress => ({ nextSourceGame: address(1), pendingSteps, complete: false, ready: false })
function fixture() {
	const reads: string[] = []
	const nodes = new Map<number, { parentGame: Address; historyFrozen: boolean; progress: ClaimCheckpointProgress }>()
	for (let game = 1; game <= 12; game++) nodes.set(game, { parentGame: game === 1 ? zeroAddress : address(game - 1), historyFrozen: true, progress: { ...pending(), nextSourceGame: game <= 2 ? zeroAddress : address(game - 2) } })
	nodes.set(13, { parentGame: address(11), historyFrozen: false, progress: { ...pending(), nextSourceGame: address(10) } })
	return {
		nodes,
		reads,
		readNode: async (game: Address) => {
			reads.push(game)
			const node = nodes.get(Number(BigInt(game)))
			if (node === undefined) throw new Error('Missing canonical game')
			return node
		},
	}
}

test('a single cold claim prepares the terminal and never builds every parent', async () => {
	const context = fixture()
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [{ game: address(12), claim }] })
	expect(jobs).toEqual([{ targetGame: address(12), game: address(12), claim, reason: 'required' }])
})

test('three shallow branches retain direct preparation when atomic settlement makes caching more expensive', async () => {
	const context = fixture()
	context.nodes.set(9, { parentGame: address(8), historyFrozen: true, progress: { ...pending(), nextSourceGame: address(7), ready: true } })
	for (const game of [10, 11, 12]) context.nodes.set(game, { parentGame: address(9), historyFrozen: false, progress: { ...pending(), nextSourceGame: address(8) } })
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [10, 11, 12].map(game => ({ game: address(game), claim })) })
	expect(jobs.map(job => job.reason)).toEqual(['required', 'required', 'required'])
})

test('deep authenticated branches seed a ready-but-incomplete parent when adoption and settlement still save transactions', async () => {
	const context = fixture()
	for (let game = 1; game <= 17; game++) context.nodes.set(game, { parentGame: game === 1 ? zeroAddress : address(game - 1), historyFrozen: true, progress: { ...pending(), nextSourceGame: game <= 2 ? zeroAddress : address(game - 2), ready: game === 17 } })
	for (const game of [18, 19, 20]) context.nodes.set(game, { parentGame: address(17), historyFrozen: false, progress: { ...pending(), nextSourceGame: address(16) } })
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [18, 19, 20].map(game => ({ game: address(game), claim })) })
	expect(jobs).toEqual([{ targetGame: address(18), game: address(17), claim, reason: 'shared-ancestor' }])
})

test('different authenticated tuples never count as shared ancestor demand', async () => {
	const context = fixture()
	const jobs = await planClaimCheckpointPreparation({
		...context,
		claims: [
			{ game: address(12), claim },
			{ game: address(13), claim: { ...claim, leafIndex: 3n } },
		],
	})
	expect(jobs.map(job => job.game)).toEqual([address(12), address(13)])
})

test('an almost complete parent is finished before an expensive terminal checkpoint', async () => {
	const context = fixture()
	context.nodes.set(12, { parentGame: address(11), historyFrozen: false, progress: { ...pending(32n), nextSourceGame: zeroAddress } })
	context.nodes.set(11, { parentGame: address(10), historyFrozen: false, progress: { ...pending(2n), nextSourceGame: zeroAddress, ready: true } })
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [{ game: address(12), claim }] })
	expect(jobs).toEqual([{ targetGame: address(12), game: address(11), claim, reason: 'finishing-parent' }])
})

test('a parent preparation tie keeps direct atomic settlement and avoids ancestor reads', async () => {
	const context = fixture()
	context.nodes.set(12, { parentGame: address(11), historyFrozen: false, progress: { ...pending(24n), nextSourceGame: zeroAddress } })
	context.nodes.set(11, { parentGame: address(10), historyFrozen: false, progress: { ...pending(2n), nextSourceGame: zeroAddress, ready: true } })
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [{ game: address(12), claim }] })
	expect(jobs).toEqual([{ targetGame: address(12), game: address(12), claim, reason: 'required' }])
	expect(context.reads).toHaveLength(1)
})

test('mutable ancestor history is never offered as a reusable preparation', async () => {
	const context = fixture()
	context.nodes.set(10, { parentGame: address(9), historyFrozen: false, progress: pending() })
	const jobs = await planClaimCheckpointPreparation({
		...context,
		claims: [
			{ game: address(12), claim },
			{ game: address(13), claim },
		],
	})
	expect(jobs.every(job => job.reason === 'required')).toBeTrue()
})

test('ready terminal claims need no paid preparation or ancestor discovery', async () => {
	const context = fixture()
	context.nodes.set(13, { parentGame: address(11), historyFrozen: false, progress: { ...pending(), nextSourceGame: address(9), ready: true } })
	const jobs = await planClaimCheckpointPreparation({
		...context,
		claims: [
			{ game: address(12), claim },
			{ game: address(13), claim },
		],
		maxAncestorReads: 2,
	})
	expect(context.reads).toHaveLength(2)
	expect(jobs.map(job => job.game)).toEqual([address(12)])
})

test('canonical ancestry cycles are rejected instead of scheduling arbitrary work', async () => {
	const context = fixture()
	context.nodes.set(11, { parentGame: address(12), historyFrozen: true, progress: pending() })
	await expect(
		planClaimCheckpointPreparation({
			...context,
			claims: [
				{ game: address(12), claim },
				{ game: address(13), claim },
			],
		}),
	).rejects.toThrow('cycle')
})

test('a distant shared ancestor is not priced as one-call immediate parent adoption', async () => {
	const context = fixture()
	context.nodes.set(13, { parentGame: address(10), historyFrozen: true, progress: { ...pending(), nextSourceGame: address(9) } })
	const jobs = await planClaimCheckpointPreparation({
		...context,
		claims: [
			{ game: address(12), claim },
			{ game: address(13), claim },
		],
	})
	expect(jobs.every(job => job.reason === 'required')).toBeTrue()
})

test('a cold shallow branching parent is skipped when two children cannot repay its preparation calls', async () => {
	const context = fixture()
	context.nodes.set(9, { parentGame: address(8), historyFrozen: true, progress: { ...pending(), nextSourceGame: address(7), ready: true } })
	for (const game of [10, 11]) context.nodes.set(game, { parentGame: address(9), historyFrozen: false, progress: { ...pending(), nextSourceGame: address(8) } })
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [10, 11].map(game => ({ game: address(game), claim })) })
	expect(jobs.map(job => job.reason)).toEqual(['required', 'required'])
})

test('shared demand cannot exceed the global ancestor discovery budget or hide terminal work', async () => {
	const context = fixture()
	const jobs = await planClaimCheckpointPreparation({
		...context,
		claims: [
			{ game: address(12), claim },
			{ game: address(13), claim },
		],
		maxAncestorReads: 2,
	})
	expect(context.reads).toHaveLength(4)
	expect(jobs.map(job => job.game)).toEqual([address(12), address(13)])
})

test('separate withdrawal makes finishing a parent cheaper with 24 terminal application steps', async () => {
	const context = fixture()
	context.nodes.set(12, { parentGame: address(11), historyFrozen: false, progress: { ...pending(24n), nextSourceGame: zeroAddress } })
	context.nodes.set(11, { parentGame: address(10), historyFrozen: false, progress: { ...pending(1n), nextSourceGame: zeroAddress, ready: true } })
	const jobs = await planClaimCheckpointPreparation({ ...context, claims: [{ game: address(12), claim, settlement: 'separate' }] })
	expect(jobs).toEqual([{ targetGame: address(12), game: address(11), claim, reason: 'finishing-parent' }])
})

test.each(['atomic', 'separate', 'unknown'] as const)('parent finishing policy counts the %s settlement path across batch boundaries', async settlement => {
	for (const pendingSteps of [8n, 16n, 17n, 24n, 25n, 32n]) {
		const context = fixture()
		const progress = { ...pending(pendingSteps), nextSourceGame: zeroAddress }
		context.nodes.set(12, { parentGame: address(11), historyFrozen: false, progress })
		context.nodes.set(11, { parentGame: address(10), historyFrozen: false, progress: { ...pending(1n), nextSourceGame: zeroAddress } })
		const finishParent = settlement === 'separate' ? pendingSteps > 16n : pendingSteps > 24n
		expect(shouldInspectClaimCheckpointParent(progress, settlement)).toBe(finishParent)
		const jobs = await planClaimCheckpointPreparation({ ...context, claims: [{ game: address(12), claim, settlement }] })
		expect(jobs[0]?.reason).toBe(finishParent ? 'finishing-parent' : 'required')
	}
})

test('final batch eligibility requires finished discovery and a bounded exact nonempty witness', () => {
	for (const pendingSteps of [-1n, 0n, 1n, 8n, 9n, 16n]) {
		const progress = { nextSourceGame: zeroAddress, pendingSteps }
		expect(isFinalClaimCheckpointBatch(progress)).toBe(pendingSteps > 0n && pendingSteps <= 8n)
		expect(isFinalClaimCheckpointBatch(progress, Number(pendingSteps) + 1)).toBeFalse()
		expect(isFinalClaimCheckpointBatch({ ...progress, nextSourceGame: address(1) })).toBeFalse()
	}
	expect(isFinalClaimCheckpointBatch({ nextSourceGame: zeroAddress, pendingSteps: 1n }, 1.5)).toBeFalse()
})

test('mixed settlement capability is priced per authenticated branch and ties stay direct', async () => {
	for (const separateBranches of [0, 1, 2, 3]) {
		const context = fixture()
		context.nodes.set(9, { parentGame: address(8), historyFrozen: true, progress: { ...pending(), nextSourceGame: address(7), ready: true } })
		for (const game of [10, 11, 12]) context.nodes.set(game, { parentGame: address(9), historyFrozen: false, progress: { ...pending(), nextSourceGame: address(8) } })
		const jobs = await planClaimCheckpointPreparation({ ...context, claims: [10, 11, 12].map((game, index) => ({ game: address(game), claim, settlement: index < separateBranches ? 'separate' : 'unknown' })) })
		expect(jobs.map(job => job.reason)).toEqual(separateBranches === 3 ? ['shared-ancestor'] : ['required', 'required', 'required'])
	}
})
