import { expect } from 'bun:test'
import { SQL } from 'bun'
import { handleApi } from '../../src/api.ts'
import { storeLogProjections } from '../../src/database-projections.ts'
import { getAddress, type Hex } from '../../src/ethereum.ts'
import { capitalLedgerRows } from '../../src/repositories/capital.ts'
import { feeEconomicsRows } from '../../src/repositories/fee-economics.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { StoredLog } from '../../src/types.ts'
import { postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

const chainId = 1
const zeroHash = `0x${'0'.repeat(64)}`
const blockHash = (number: number): Hex => `0x${number.toString(16).padStart(64, '0')}`
const address = (digit: string) => getAddress(`0x${digit.repeat(40)}`)
const lower = (value: string) => value.toLowerCase()
const ledger = address('1')
const securityPool = address('4')
const alice = address('a')
const bob = address('b')
const carol = address('c')

const event = (blockNumber: number, logIndex: number, name: string, argumentsValue: Record<string, unknown>): StoredLog => ({
	transactionHash: blockHash(blockNumber + 1_000),
	blockHash: blockHash(blockNumber),
	blockNumber: BigInt(blockNumber),
	transactionIndex: 0,
	logIndex,
	address: ledger,
	topics: [],
	data: '0x',
	decoded: { status: 'decoded', name, summary: name, arguments: argumentsValue },
})

postgresTest('capital views respect the historical boundary, surface failed ledger samples and keep unsampled owners', async () => {
	const sql = new SQL(requirePostgresUrl())
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['blocks', 'contracts', 'networks', 'protocol_timeline_entries', 'entity_state_snapshots', 'pool_state_events', 'escalation_game_events', 'collateral_repair_auction_events', 'questions'])
			await connection.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`)
		for (const number of [1, 2, 3, 4, 5, 6]) await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, canonical, timestamp) VALUES (${chainId}, ${number}, ${blockHash(number)}, ${zeroHash}, true, ${new Date(Date.UTC(2026, 0, number))})`
		await connection`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp) VALUES (${chainId}, 'test', 'Test', '', 0, 6, ${blockHash(6)}, ${new Date(Date.UTC(2026, 0, 6))})`
		// The ledger was discovered at block 3.
		await connection`INSERT INTO contracts (chain_id, address, label, kind, provenance, discovery_block, canonical) VALUES (${chainId}, ${lower(ledger)}, 'ledger', 'securityPoolCapitalLedger', 'test', 3, true)`
		for (const item of [event(4, 0, 'PrincipalDeposited', { payer: alice, owner: alice, amountAttoRep: '500' }), event(5, 0, 'CommitmentAuthorized', { owner: alice, positionId: '1', rep: '500', commitment: '100', targetHealthFactorBps: '12000' })]) await storeLogProjections(connection, chainId, item)
		const snapshot = async (entityType: string, identity: string, blockNumber: number, readResult: Record<string, unknown> | undefined) =>
			await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp, source_method, read_status, read_result, read_failure_reason, canonical)
				VALUES (${chainId}, ${entityType}, ${identity}, ${blockNumber}, ${blockHash(blockNumber)}, ${new Date(Date.UTC(2026, 0, blockNumber))}, ${`augurscan.${entityType}-state.v1`},
					${readResult === undefined ? 'failed' : 'success'}, ${readResult === undefined ? null : JSON.stringify(readResult)}::text::jsonb, ${readResult === undefined ? 'execution reverted' : null}, true)`
		await snapshot('capital-ledger', lower(ledger), 4, { securityPool: lower(securityPool), universeId: '0', commitmentAttoEth: '100', fees: { annualFeeBps: '200' } })
		await snapshot('capital-ledger', lower(ledger), 5, undefined)
		// Bob's position is revealed only by a read at block 6.
		await snapshot('capital-position', `${lower(ledger)}:2`, 6, { ledger: lower(ledger), positionId: '2', owner: lower(bob) })

		const ledgersAt = async (block: string) => (await capitalLedgerRows(connection, chainId, block)).map((row: Record<string, unknown>) => [row['ledger_address'], row['owner_count'], row['block_number'], row['latest_read_status'], row['latest_read_block_number']])
		// Before its discovery the ledger did not exist.
		expect(await ledgersAt('2')).toEqual([])
		expect(await ledgersAt('3')).toEqual([[lower(ledger), 0, null, null, null]])
		expect(await ledgersAt('4')).toEqual([[lower(ledger), 1, '4', 'success', '4']])
		// The failed sample at block 5 stays visible beside the earlier successful values.
		expect(await ledgersAt('5')).toEqual([[lower(ledger), 1, '4', 'failed', '5']])
		// The position read at block 6 adds Bob only from that block.
		expect(await ledgersAt('6')).toEqual([[lower(ledger), 2, '4', 'failed', '5']])

		const feesAt = async (block: string) => (await feeEconomicsRows(connection, chainId, block))[0]
		expect(await feesAt('4')).toMatchObject({ fees: { annualFeeBps: '200' }, fee_read_error: null, latest_read_status: 'success' })
		expect(await feesAt('5')).toMatchObject({ fees: null, fee_read_error: 'execution reverted', latest_read_status: 'failed', latest_read_block_number: '5' })

		const api = async (path: string) => {
			const response = await handleApi(new Request(`http://localhost${path}`), connection)
			if (response === undefined) throw new Error(`${path} did not return a response`)
			return response
		}
		// Alice has no balance sample yet, but her indexed events remain visible.
		const detailResponse = await api(`/api/v1/state/capital/${chainId}/${lower(ledger)}/${lower(alice)}`)
		expect(detailResponse.status).toBe(200)
		expect(await detailResponse.json()).toMatchObject({
			data: {
				ledger_address: lower(ledger),
				owner_address: lower(alice),
				read_status: 'unsampled',
				protocol_state: 'unavailable',
				events: { items: [{ event_name: 'CommitmentAuthorized' }, { event_name: 'PrincipalDeposited' }] },
			},
		})
		expect((await api(`/api/v1/state/capital/${chainId}/${lower(ledger)}/${lower(alice)}?atBlock=3`)).status).toBe(404)
		expect((await api(`/api/v1/state/capital/${chainId}/${lower(ledger)}/${lower(carol)}`)).status).toBe(404)
		// The catalog at block 3 lists neither future ledgers' owners nor their positions.
		expect(await (await api(`/api/v1/state/capital?chainId=${chainId}&atBlock=3`)).json()).toMatchObject({ data: { ledgers: [{ ledger_address: lower(ledger), owner_count: 0 }], positions: { total: 0 } } })
	} finally {
		connection.release()
		await sql.close()
	}
})
