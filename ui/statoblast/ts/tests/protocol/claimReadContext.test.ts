import { expect, test } from 'bun:test'
import { getAddress, keccak256, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { loadForkCarriedEscalationDepositsFromParentSnapshot } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import { createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const parent = getAddress('0x0000000000000000000000000000000000000001')
const game = getAddress('0x0000000000000000000000000000000000000002')
const child = getAddress('0x0000000000000000000000000000000000000003')
const hash = keccak256('0x01')
const replacement = keccak256('0x02')

function emptyCarryResponse(functionName: string) {
	if (functionName === 'escalationGame') return game
	if (functionName === 'forkContinuation') return false
	if (functionName === 'getOutcomeState') return { currentCarryRoot: zeroHash, currentLeafCount: 0n, currentNullifierRoot: zeroHash, localHeadNodeId: 0n, snapshotLeafCount: 0n, snapshotPeaks: Array.from({ length: 64 }, () => zeroHash) }
	if (functionName === 'getCarryLeafPageByOutcome') return [[], 0n]
	if (functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
	throw new Error(`Unexpected read: ${functionName}`)
}

const load = (client: Parameters<typeof loadForkCarriedEscalationDepositsFromParentSnapshot>[0]) => loadForkCarriedEscalationDepositsFromParentSnapshot(client, child, parent, 'yes', parent)

for (const mode of ['stable', 'reorg', 'continuous reorg', 'provider error', 'bad reconstruction after reorg'] as const)
	test(`claim reads bracket one memoized block snapshot (${mode})`, async () => {
		let anchors = 0
		let requests = 0
		let attempts = 0
		const keys = new Set<string>()
		const client = {
			getBlockNumber: async () => BigInt(++attempts),
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
				anchors++
				const changed = (mode === 'continuous reorg' && anchors % 2 === 0) || (['reorg', 'bad reconstruction after reorg'].includes(mode) && anchors === 2)
				return { number: blockNumber, hash: changed ? replacement : hash }
			},
			readContract: createReadContractStub(async parameters => {
				requests++
				expect(parameters.blockNumber).toBe(BigInt(attempts))
				const key = `${parameters.blockNumber}:${parameters.address}:${parameters.functionName}:${String(parameters.args)}`
				expect(keys.has(key)).toBe(false)
				keys.add(key)
				if (mode === 'provider error') throw new Error('RPC disconnected')
				if (mode === 'bad reconstruction after reorg' && attempts === 1 && parameters.address === child && parameters.functionName === 'getOutcomeState') return { snapshotLeafCount: 1n, snapshotPeaks: [] }
				return emptyCarryResponse(parameters.functionName)
			}),
		}
		const result = load(client)
		if (mode === 'continuous reorg' || mode === 'provider error') await expect(result).rejects.toThrow(mode === 'continuous reorg' ? 'changed repeatedly' : 'RPC disconnected')
		else await expect(result).resolves.toEqual([])
		const expectedAttempts = mode === 'stable' || mode === 'provider error' ? 1 : 2
		expect(requests).toBe(mode === 'provider error' ? 1 : expectedAttempts * 7)
		expect(attempts).toBe(expectedAttempts)
		expect(anchors).toBe(expectedAttempts * 2)
	})

for (const hash of [undefined, zeroHash, '0x01'] as const)
	test(`unverifiable anchors stop before contract reads (${hash})`, async () => {
		let reads = 0
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash }),
			readContract: createReadContractStub(async () => {
				reads++
				return true
			}),
		}
		await expect(load(client)).rejects.toThrow('anchor is unavailable')
		expect(reads).toBe(0)
	})

test('separate claim requests never reuse mutable cached results', async () => {
	let reads = 0
	const client = {
		getBlockNumber: async () => 1n,
		getBlock: async () => ({ number: 1n, hash }),
		readContract: createReadContractStub(async request => {
			reads++
			return emptyCarryResponse(request.functionName)
		}),
	}
	await load(client)
	await load(client)
	expect(reads).toBe(14)
})
