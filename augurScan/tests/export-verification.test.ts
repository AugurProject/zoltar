import { expect, test } from 'bun:test'
import { exportRequestScope, verifyExportPage } from '../src/export-verification.ts'

const hash = (digit: string): string => `0x${digit.repeat(64)}`
const logScope = exportRequestScope('logs', '1', 'all', '0', '10')

const boundaryHeaders = {
	'content-type': 'application/x-ndjson; charset=utf-8',
	'x-augurscan-snapshot-block': '10',
	'x-augurscan-snapshot-hash': hash('1'),
	'x-augurscan-snapshot-invalidation-id': '3',
	'x-augurscan-snapshot-total': '3',
	'x-augurscan-abi-source-hash': 'abi',
	'x-augurscan-application-source-hash': 'application',
	'x-augurscan-projection-source-hash': 'projection',
}

const headers = (overrides: Readonly<Record<string, string | undefined>> = {}): string =>
	Object.entries({ ...boundaryHeaders, ...overrides })
		.flatMap(([name, value]) => (value === undefined ? [] : [`${name}: ${value}`]))
		.join('\r\n')

const logRow = (block: number): Record<string, unknown> => ({
	chain_id: '1',
	block_number: String(block),
	block_hash: hash(String(block)),
	tx_hash: hash(String(block + 3)),
	transaction_index: 0,
	log_index: 0,
	canonical: block === 3,
})

const body = (...rows: readonly Record<string, unknown>[]): string => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`

const cursor = (lastBlock: number): string =>
	btoa(
		JSON.stringify([
			1,
			'logs',
			1,
			'all',
			'0',
			'10',
			'10',
			hash('1'),
			'3',
			'3',
			'abi',
			'application',
			'projection',
			[String(lastBlock), '0', '0', hash(String(lastBlock)), hash(String(lastBlock + 3))],
		]),
	)

test('proves exact multi-page NDJSON exports at one ordered cursor boundary', () => {
	const pageTwo = cursor(2)
	const first = verifyExportPage(
		headers({ 'x-augurscan-returned': '2', 'x-augurscan-truncated': 'true', 'x-augurscan-next-cursor': pageTwo }),
		body(logRow(1), logRow(2)),
		logScope,
	)
	expect(first).toMatchObject({ total: '3', returnedTotal: '2', truncated: true, nextCursor: pageTwo })
	const second = verifyExportPage(headers({ 'x-augurscan-returned': '1', 'x-augurscan-truncated': 'false' }), body(logRow(3)), logScope, first, pageTwo)
	expect(second).toMatchObject({ total: '3', returnedTotal: '3', truncated: false })
})

test('rejects incomplete, malformed, duplicate, skipped-boundary, or cross-snapshot export pages', () => {
	const pageTwo = cursor(2)
	const firstHeaders = headers({ 'x-augurscan-returned': '2', 'x-augurscan-truncated': 'true', 'x-augurscan-next-cursor': pageTwo })
	const firstBody = body(logRow(1), logRow(2))
	const first = verifyExportPage(firstHeaders, firstBody, logScope)
	expect(() =>
		verifyExportPage(
			headers({
				'content-type': 'application/x-ndjson-broken',
				'x-augurscan-returned': '2',
				'x-augurscan-truncated': 'true',
				'x-augurscan-next-cursor': pageTwo,
			}),
			firstBody,
			logScope,
		),
	).toThrow('content-type must be application/x-ndjson')
	expect(() => verifyExportPage(headers({ 'x-augurscan-returned': '2', 'x-augurscan-truncated': 'true' }), firstBody, logScope)).toThrow(
		'truncated response and next cursor do not agree',
	)
	expect(() => verifyExportPage(firstHeaders, `${JSON.stringify(logRow(1))}\nnot-json\n`, logScope)).toThrow('NDJSON body contains malformed JSON')
	expect(() => verifyExportPage(firstHeaders, body(logRow(1)), logScope)).toThrow('NDJSON line count does not match x-augurscan-returned')
	expect(() =>
		verifyExportPage(headers({ 'x-augurscan-returned': '0', 'x-augurscan-truncated': 'true', 'x-augurscan-next-cursor': cursor(0) }), '', logScope),
	).toThrow('next cursor does not identify the final export row')
	expect(() => verifyExportPage(firstHeaders, body(logRow(1), logRow(1)), logScope)).toThrow('export row identities are not strictly increasing')
	expect(() => verifyExportPage(firstHeaders, firstBody, logScope, first, pageTwo)).toThrow('export row identities are not strictly increasing')
	expect(() =>
		verifyExportPage(headers({ 'x-augurscan-returned': '2', 'x-augurscan-truncated': 'true', 'x-augurscan-next-cursor': cursor(3) }), firstBody, logScope),
	).toThrow('next cursor does not identify the final export row')
	expect(() =>
		verifyExportPage(
			headers({
				'x-augurscan-returned': '1',
				'x-augurscan-truncated': 'false',
				'x-augurscan-snapshot-hash': hash('2'),
			}),
			body(logRow(3)),
			logScope,
			first,
			pageTwo,
		),
	).toThrow('export snapshot headers changed between pages')
	expect(() => verifyExportPage(headers({ 'x-augurscan-returned': '0', 'x-augurscan-truncated': 'false' }), '', logScope, first, pageTwo)).toThrow(
		'final page count does not match snapshot total',
	)
})

test('validates timeline and reorganization identity order and request scope', () => {
	expect(() => exportRequestScope('reorgs', '1', 'canonical', '0', '10')).toThrow('reorg exports require canonical scope all')
	const timelineScope = exportRequestScope('timeline', '1', 'canonical', '0', '10')
	const timelineRows = [
		{ chain_id: '1', block_number: '1', block_hash: hash('1'), tx_hash: hash('4'), log_index: 0, entity_type: 'report', entity_identity: 'a', canonical: true },
		{ chain_id: '1', block_number: '2', block_hash: hash('2'), tx_hash: hash('5'), log_index: 0, entity_type: 'report', entity_identity: 'b', canonical: true },
	]
	expect(() =>
		verifyExportPage(
			headers({ 'x-augurscan-snapshot-total': '2', 'x-augurscan-returned': '2', 'x-augurscan-truncated': 'false' }),
			body(...timelineRows),
			timelineScope,
		),
	).not.toThrow()
	const reorgScope = exportRequestScope('reorgs', '1', 'all', '0', '10')
	const reorgRows = [
		{ chain_id: '1', id: '1', reason: 'chain-reorg', previous_block: '2', ancestor_block: '1' },
		{ chain_id: '1', id: '2', reason: 'start-boundary-advanced', previous_block: null, ancestor_block: null },
	]
	expect(() =>
		verifyExportPage(
			headers({ 'x-augurscan-snapshot-total': '2', 'x-augurscan-returned': '2', 'x-augurscan-truncated': 'false' }),
			body(...reorgRows),
			reorgScope,
		),
	).not.toThrow()
	expect(() =>
		verifyExportPage(
			headers({
				'x-augurscan-snapshot-invalidation-id': '1',
				'x-augurscan-snapshot-total': '1',
				'x-augurscan-returned': '1',
				'x-augurscan-truncated': 'false',
			}),
			body(reorgRows[1] ?? {}),
			reorgScope,
		),
	).toThrow('reorganization row is outside the snapshot invalidation boundary')
})
