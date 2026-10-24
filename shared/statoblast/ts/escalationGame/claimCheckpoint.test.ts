import { expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, zeroAddress, zeroHash, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { prepareClaimCheckpointBatch } from './claimCheckpoint.js'

const address = (index: number) => getAddress(`0x${index.toString(16).padStart(40, '0')}`)
const game = address(100)
const claim = { outcomeIndex: 1, amountAttoRep: 10n, cumulativeAmountAttoRep: 30n, leafIndex: 2n }
const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [claim.outcomeIndex, claim.amountAttoRep, claim.cumulativeAmountAttoRep, claim.leafIndex]))
const transform = (index: number) => ({ repBeforeAttoRep: 101n + BigInt(index), repRemainingAttoRep: 99n + BigInt(index), consumedBeforeAttoRep: BigInt(index) })
function push(previous: Hash, index: number) {
	const value = transform(index)
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [game, claimId, previous, value.repBeforeAttoRep, value.repRemainingAttoRep, value.consumedBeforeAttoRep]))
}
function fixture(count = 3, prefix = zeroHash) {
	const commitments = [prefix]
	for (let index = 0; index < count; index++) commitments.push(push(commitments.at(-1) ?? zeroHash, index))
	const reads: Address[] = []
	return {
		reads,
		commitments,
		context: {
			game,
			claim,
			progress: { nextSourceGame: zeroAddress, pendingSteps: BigInt(count), complete: false, ready: false },
			state: { pendingCommitment: commitments.at(-1) ?? zeroHash, segmentSourceGame: address(1), segmentPreviousCommitment: prefix, firstStep: 0n, steps: BigInt(count) },
			readTransform: async (source: Address) => {
				reads.push(source)
				const index = Number(BigInt(source)) - 1
				return { sourceGame: address(index + 2), transform: transform(index) }
			},
		},
	}
}

test('reconstructs one bounded segment from canonical transforms in forward hash order', async () => {
	const { context, reads, commitments } = fixture()
	const witnesses = await prepareClaimCheckpointBatch(context)
	expect(reads).toEqual([address(1), address(2), address(3)])
	expect(witnesses).toEqual({ baseCommitment: commitments[0] ?? zeroHash, transforms: [0, 1, 2].map(transform) })
})

test('stops at an ancestor checkpoint anchor without traversing older history', async () => {
	const { context, reads } = fixture(2, `0x${'ab'.repeat(32)}`)
	context.progress.pendingSteps = 800002n
	context.state.firstStep = 800000n
	expect((await prepareClaimCheckpointBatch(context)).transforms).toHaveLength(2)
	expect(reads).toHaveLength(2)
})

test('uses all eight transforms at a full segment boundary', async () => {
	const { context, reads } = fixture(8)
	expect((await prepareClaimCheckpointBatch(context)).transforms).toHaveLength(8)
	expect(reads).toHaveLength(8)
})

test('discovery and completed checkpoints never perform witness reads', async () => {
	const { context, reads } = fixture()
	context.progress.nextSourceGame = address(90)
	expect(await prepareClaimCheckpointBatch(context)).toEqual({ baseCommitment: zeroHash, transforms: [] })
	context.progress.nextSourceGame = zeroAddress
	context.progress.complete = true
	context.progress.pendingSteps = 0n
	context.state.pendingCommitment = zeroHash
	expect(await prepareClaimCheckpointBatch(context)).toEqual({ baseCommitment: zeroHash, transforms: [] })
	expect(reads).toEqual([])
})

test('rejects altered transforms, mismatched claim domains and stale heads', async () => {
	const { context } = fixture()
	await expect(prepareClaimCheckpointBatch({ ...context, claim: { ...claim, leafIndex: 3n } })).rejects.toThrow('commitment')
	await expect(prepareClaimCheckpointBatch({ ...context, game: address(101) })).rejects.toThrow('commitment')
	context.state.pendingCommitment = zeroHash
	await expect(prepareClaimCheckpointBatch(context)).rejects.toThrow('commitment')
})

test('rejects malformed progress, missing ancestors and cycles before submitting witnesses', async () => {
	const { context } = fixture()
	await expect(prepareClaimCheckpointBatch({ ...context, progress: { ...context.progress, pendingSteps: -1n } })).rejects.toThrow('progress')
	await expect(prepareClaimCheckpointBatch({ ...context, state: { ...context.state, segmentSourceGame: zeroAddress } })).rejects.toThrow('ancestor')
	await expect(prepareClaimCheckpointBatch({ ...context, readTransform: async () => ({ sourceGame: address(1), transform: transform(0) }) })).rejects.toThrow('cycle')
})

test('refuses a segment that moved between canonical progress and anchor reads', async () => {
	const { context } = fixture()
	await expect(prepareClaimCheckpointBatch({ ...context, state: { ...context.state, firstStep: 8n } })).rejects.toThrow('segment changed')
	await expect(prepareClaimCheckpointBatch({ ...context, state: { ...context.state, steps: 2n } })).rejects.toThrow('segment changed')
})

for (const pendingSteps of [1n, 7n, 8n, 9n, 15n, 16n, (1n << 128n) + 7n])
	test(`reads only the latest segment for ${pendingSteps.toString()} pending steps`, async () => {
		const segmentLength = Number(((pendingSteps - 1n) % 8n) + 1n)
		const { context, reads } = fixture(segmentLength)
		context.progress.pendingSteps = pendingSteps
		context.state.firstStep = pendingSteps - BigInt(segmentLength)
		expect((await prepareClaimCheckpointBatch(context)).transforms).toHaveLength(segmentLength)
		expect(reads).toHaveLength(segmentLength)
	})

test('a partial budget returns only the authenticated suffix and its preceding base', async () => {
	const { context, commitments, reads } = fixture(8)
	expect(await prepareClaimCheckpointBatch({ ...context, maxSteps: 2n })).toEqual({ baseCommitment: commitments[6] ?? zeroHash, transforms: [6, 7].map(transform) })
	expect(reads).toHaveLength(8)
})

test('invalid partial budgets cannot produce a submit-ready batch', async () => {
	const { context } = fixture()
	await expect(prepareClaimCheckpointBatch({ ...context, maxSteps: 0n })).rejects.toThrow('budget')
	await expect(prepareClaimCheckpointBatch({ ...context, maxSteps: 9n })).rejects.toThrow('budget')
})
