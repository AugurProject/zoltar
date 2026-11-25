import { expect, test } from 'bun:test'
import { parseRiskCursor, protocolCursorFor, protocolCursorForRequest, riskCursorFor } from '../../src/api/entity-details.ts'
import { encodeOpaqueCursor, parseCursor } from '../../src/cursor-codec.ts'

test('parseCursor preserves endpoint validation and wraps decoding or shape errors', () => {
	const parse = (parts: readonly unknown[]) => {
		if (parts.length !== 1 || typeof parts[0] !== 'number') throw new Error('shape')
		return parts[0]
	}
	const invalid = (cause: unknown) => new Error('cursor is invalid', { cause })
	expect(parseCursor(encodeOpaqueCursor([42]), parse, invalid)).toBe(42)
	for (const value of ['!', encodeOpaqueCursor({ value: 42 }), encodeOpaqueCursor(['42'])]) {
		expect(() => parseCursor(value, parse, invalid)).toThrow('cursor is invalid')
	}
})

test('operations cursors preserve their wire layout and decode named snapshot and position fields', () => {
	const hash = `0x${'1'.repeat(64)}`
	const tx = `0x${'2'.repeat(64)}`
	const pool = `0x${'a'.repeat(40)}`
	const snapshot = { blockNumber: '100', blockHash: hash, invalidationId: '4', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'projection' }
	const boundary = ['100', hash, '4', 'abi', 'app', 'projection']
	const protocol = encodeOpaqueCursor([1, 'forks-catalog', 'catalog', ...boundary, '80', tx, 7])
	const risk = encodeOpaqueCursor([1, 'pool', ...boundary, pool])
	const request = new URL('http://localhost/')
	request.searchParams.set('cursor', protocol)
	expect(protocolCursorFor(1, 'forks-catalog', 'catalog', snapshot, { block_number: '80', tx_hash: tx, log_index: 7 })).toBe(protocol)
	expect(protocolCursorForRequest(request, 1, 'forks-catalog', 'catalog')).toMatchObject({ snapshot, position: { block: '80', tx, log: 7 } })
	expect(riskCursorFor(1, snapshot, pool)).toBe(risk)
	expect(parseRiskCursor(risk, 1)).toMatchObject({ snapshot, poolAddress: pool })
	expect(() => parseRiskCursor(risk, 2)).toThrow('poolCursor does not match the requested collection')
	expect(() => parseRiskCursor(protocol, 1)).toThrow('poolCursor is invalid')
	request.searchParams.set('cursor', risk)
	expect(() => protocolCursorForRequest(request, 1, 'forks-catalog', 'catalog')).toThrow('cursor is invalid')
})
