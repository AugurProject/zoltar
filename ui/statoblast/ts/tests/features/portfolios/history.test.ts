import { expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getCanonicalPortfolioObservationKeys, loadTrackedPortfolioOperationStatus } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/history.js'
import { mergeTrackedPortfolioOperations, parseTrackedPortfolioOperations, portfolioOperationKey, type TrackedPortfolioOperation } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/preferences.js'

const vault = getAddress('0x0000000000000000000000000000000000000011')
const replacementVault = getAddress('0x0000000000000000000000000000000000000022')
const coordinator = getAddress('0x0000000000000000000000000000000000000033')
const originalHash: Hex = `0x${'11'.repeat(32)}`
const replacementHash: Hex = `0x${'22'.repeat(32)}`
const currentHash: Hex = `0x${'33'.repeat(32)}`
const observation = { blockNumber: '12', blockHash: originalHash, vault, operator: vault, receiverVault: vault, targetVault: vault, queuedAt: '10', validForSeconds: '300' }
const entry: TrackedPortfolioOperation = { coordinator, pool: coordinator, operationId: '7', operation: '3', fromBlock: '12', universeId: '0', questionId: '4', observation }
const snapshot = { vault, blockNumber: 20n, blockHash: currentHash, timestamp: 500n }
const eventAbi = parseAbi(['event ExecutedStagedOperation(uint256 indexed operationId,uint8 operation,bool success,string errorMessage)'])
const topics = encodeEventTopics({ abi: eventAbi, eventName: 'ExecutedStagedOperation', args: { operationId: 7n } })
if (!topics.every((topic): topic is Hex => typeof topic === 'string')) throw new Error('Expected concrete execution topics')
const executed = { address: coordinator, topics, data: encodeAbiParameters([{ type: 'uint8' }, { type: 'bool' }, { type: 'string' }], [3n, true, '']) }

test('revalidates previously successful history and rejects replacement-chain operation ID and type reuse', async () => {
	let canonicalHash = originalHash
	const getLogs = mock(async () => [executed])
	const client = { getLogs, getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 12n ? canonicalHash : currentHash }) }
	expect(await loadTrackedPortfolioOperationStatus(client, entry, snapshot)).toEqual({ status: 'succeeded', errorMessage: '' })
	canonicalHash = replacementHash
	// A new chain can reuse coordinator / id / type for another vault and emit the identical event.
	expect(await loadTrackedPortfolioOperationStatus(client, entry, snapshot)).toEqual({ status: 'unknown' })
	expect(getLogs).toHaveBeenCalledTimes(1)
	const wrongVaultObservation = { ...entry, observation: { ...observation, blockHash: replacementHash, operator: replacementVault, receiverVault: replacementVault, targetVault: replacementVault } }
	expect(await loadTrackedPortfolioOperationStatus(client, wrongVaultObservation, snapshot)).toEqual({ status: 'unknown' })
})

test('rejects a reorg during log retrieval and a changed snapshot header', async () => {
	let canonicalHash = originalHash
	const client = {
		getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 12n ? canonicalHash : currentHash }),
		getLogs: async () => {
			canonicalHash = replacementHash
			return [executed]
		},
	}
	expect(await loadTrackedPortfolioOperationStatus(client, entry, snapshot)).toEqual({ status: 'unknown' })
	const changedSnapshotClient = { getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 12n ? originalHash : replacementHash }), getLogs: async () => [executed] }
	expect(await loadTrackedPortfolioOperationStatus(changedSnapshotClient, entry, snapshot)).toEqual({ status: 'unknown' })
})

test('never accepts unanchored persisted history and preserves complete observations through storage', async () => {
	const { observation: _observation, ...unanchored } = entry
	const getLogs = mock(async () => [executed])
	const client = { getBlock: async () => ({ hash: originalHash }), getLogs }
	expect(await loadTrackedPortfolioOperationStatus(client, unanchored, snapshot)).toEqual({ status: 'unknown' })
	expect(getLogs).not.toHaveBeenCalled()
	expect(parseTrackedPortfolioOperations(JSON.stringify([entry]))).toEqual([entry])
	const [invalid] = parseTrackedPortfolioOperations(JSON.stringify([{ ...entry, observation: { ...observation, blockHash: 'broken' } }]))
	expect(invalid?.observation).toBeUndefined()
})

test('rediscovery retains invalidated records as unknown instead of substituting new queued identity', async () => {
	const client = { getBlock: async () => ({ hash: replacementHash }) }
	const canonical = await getCanonicalPortfolioObservationKeys(client, [entry])
	expect(canonical.size).toBe(0)
	const rediscovered = { ...entry, observation: { ...observation, blockHash: replacementHash, queuedAt: '15' } }
	const records = mergeTrackedPortfolioOperations([entry], [rediscovered], canonical)
	expect(records).toHaveLength(2)
	expect(records[0]).toEqual(entry)
	expect(portfolioOperationKey(entry)).not.toBe(portfolioOperationKey(rediscovered))
	expect(mergeTrackedPortfolioOperations([rediscovered], [{ ...rediscovered, observation: { ...rediscovered.observation, blockHash: currentHash, blockNumber: '20' } }], new Set([portfolioOperationKey(rediscovered)]))).toEqual([rediscovered])
})

test('restricts terminal evidence queries to the indexed operation execution event', async () => {
	const getLogs = mock(async () => [executed])
	const client = { getLogs, getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 12n ? originalHash : currentHash }) }
	expect(await loadTrackedPortfolioOperationStatus(client, entry, snapshot)).toEqual({ status: 'succeeded', errorMessage: '' })
	expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({ address: coordinator, fromBlock: 12n, toBlock: 20n, event: expect.objectContaining({ name: 'ExecutedStagedOperation' }), args: { operationId: 7n } }))
})

test('derives live pending and expired states from the pinned snapshot without historical RPC', async () => {
	const live = { ...entry, observation: { ...observation, blockNumber: '20', blockHash: currentHash } }
	const active = { operationId: 7n, operationType: 3n, operator: vault, receiverVault: vault, targetVault: vault, queuedAt: 10n, validForSeconds: 300n }
	const position = { settlementTime: 60n, queuedOperations: [active] }
	const getBlock = mock(async () => ({ hash: currentHash }))
	const getLogs = mock(async () => [])
	const client = { getBlock, getLogs }
	expect(await loadTrackedPortfolioOperationStatus(client, live, { ...snapshot, timestamp: 100n }, position)).toEqual({ status: 'pending' })
	expect(await loadTrackedPortfolioOperationStatus(client, live, snapshot, position)).toEqual({ status: 'expired' })
	expect(await loadTrackedPortfolioOperationStatus(client, { ...live, observation: { ...live.observation, operator: replacementVault } }, snapshot, position)).toEqual({ status: 'unknown' })
	expect(getBlock).not.toHaveBeenCalled()
	expect(getLogs).not.toHaveBeenCalled()
})
