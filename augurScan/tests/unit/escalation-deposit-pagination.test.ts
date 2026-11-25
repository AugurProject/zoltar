import { expect, test } from 'bun:test'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
import { createOperationsData } from '../../browser/operations-data.ts'
import { operationRecords } from '../../browser/api-validation.ts'

test('counts each local escalation deposit once when its paired event falls on another page', async () => {
	const blockHash = `0x${'11'.repeat(32)}`
	const tx = (index: number) => `0x${String(index).repeat(64)}`
	const asOf = { blockNumber: '100', blockHash, blockTimestamp: '1000', indexedHead: '100', invalidationId: '0', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'projection', phase: 'live', historical: false }
	const events = [
		{ block_hash: blockHash, tx_hash: tx(2), log_index: 4, event_name: 'ClaimDeposit' },
		{ block_hash: blockHash, tx_hash: tx(1), log_index: 3, event_name: 'DepositOnOutcome' },
		{ block_hash: blockHash, tx_hash: tx(1), log_index: 2, event_name: 'LocalDepositAppended' },
	]
	const data = createOperationsData(
		async path => {
			const older = new URL(path, 'http://localhost').searchParams.has('cursor')
			const items = older ? events.slice(2) : events.slice(0, 2)
			return {
				chainId: 1,
				asOf,
				data: {
					events: { items, hasMore: !older, ...(older ? {} : { nextCursor: 'older' }) },
					deposits: items.filter(row => row.event_name === 'LocalDepositAppended'),
					claims: items.filter(row => row.event_name === 'ClaimDeposit'),
				},
			}
		},
		() => '1',
		() => new URL('http://localhost/operations/escalation'),
	)
	const response = await data.loadOperationsDetail({ kind: 'escalation', identity: ['0x1111111111111111111111111111111111111111'] }, 3)
	expect(response.data['deposits']).toEqual(events.slice(2))
	expect(response.data['claims']).toEqual(events.slice(0, 1))
	const history = response.data['events']
	if (!isPlainRecord(history)) throw new Error('Escalation history missing')
	expect(operationRecords(history['items'])).toEqual(events)
})
