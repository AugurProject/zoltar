import { expect, test } from 'bun:test'
import { canonicalBlockLogs } from '../../src/database/records.ts'
import { getAddress, keccak256 } from '../../src/ethereum.ts'
import type { StoredLog } from '../../src/types.ts'

const hash = keccak256('block')
const log = (logIndex: number, transactionIndex = logIndex): StoredLog => ({
	blockHash: hash,
	blockNumber: 1n,
	transactionHash: keccak256(`transaction-${transactionIndex}`),
	transactionIndex,
	logIndex,
	address: getAddress('0x1111111111111111111111111111111111111111'),
	topics: [],
	data: '0x',
	decoded: { status: 'unknown', summary: '' },
})
const ordered = (logs: readonly StoredLog[]) => canonicalBlockLogs({ hash, number: 1n, logs })

test('orders discovered receipts without mutating inputs or discarding duplicate evidence', () => {
	const logs = [log(3), log(1), log(2), log(1)]
	expect(ordered(logs).map(item => item.logIndex)).toEqual([1, 1, 2, 3])
	expect(logs.map(item => item.logIndex)).toEqual([3, 1, 2, 1])
})

test('rejects invalid positions and contradictory identities before projection', () => {
	for (const logIndex of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => ordered([log(logIndex)])).toThrow('invalid canonical position')
	expect(() => ordered([{ ...log(1), blockNumber: 2n }])).toThrow('does not belong')
	expect(() => ordered([{ ...log(1), blockHash: keccak256('other') }])).toThrow('does not belong')
	expect(() => ordered([log(0, 1), log(1, 0)])).toThrow('transaction order')
	expect(() => ordered([log(0, 0), { ...log(1, 0), transactionHash: keccak256('other') }])).toThrow('different transactions')
	expect(() => ordered([log(0), { ...log(0), data: '0x01' }])).toThrow('Conflicting logs')
})
