import { refreshHistoryAggregates } from '../../src/database/history-aggregates.ts'
import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { handleApi } from '../../src/api.ts'
import { capitalRiskOverview } from '../../src/api/capital.ts'
import { storeLogProjections } from '../../src/database-projections.ts'
import { ScannerDatabase } from '../../src/database.ts'
import { getAddress, type Hex } from '../../src/ethereum.ts'
import { auctionCollateral } from '../../src/repositories/auction-collateral.ts'
import { capitalLedgerRows, capitalOwnerEventRows, capitalPositionHistoryRows, capitalPositionRows, liquidationRows } from '../../src/repositories/capital.ts'
import { richListRows } from '../../src/repositories/security-pool.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { StoredLog } from '../../src/types.ts'

const url = process.env['POSTGRES_TEST_URL']
const chainId = 1
const zeroHash = `0x${'0'.repeat(64)}`
const blockHash = (number: number): Hex => `0x${number.toString(16).padStart(64, '0')}`
const address = (digit: string) => getAddress(`0x${digit.repeat(40)}`)
const ledger = address('1')
const otherLedger = address('2')
const feed = address('3')
const securityPool = address('4')
const alice = address('a')
const bob = address('b')
const carol = address('c')
const dave = address('d')
const lower = (value: string) => value.toLowerCase()

const event = (blockNumber: number, logIndex: number, emitter: StoredLog['address'], name: string, argumentsValue: Record<string, unknown>): StoredLog => ({
	transactionHash: blockHash(blockNumber + 1_000),
	blockHash: blockHash(blockNumber),
	blockNumber: BigInt(blockNumber),
	transactionIndex: 0,
	logIndex,
	address: emitter,
	topics: [],
	data: '0x',
	decoded: { status: 'decoded', name, summary: name, arguments: argumentsValue },
})

const ownerState = (owner: string, fields: Record<string, unknown>) => ({
	ledger: lower(ledger),
	owner: lower(owner),
	securityPool: lower(securityPool),
	universeId: '0',
	priceValid: true,
	frozen: false,
	importing: false,
	collateral: { address: lower(address('9')), symbol: 'USDC', decimals: 6 },
	...fields,
})

test.skipIf(url === undefined)('capital positions rank by health, attribute liquidations to owners and select their own snapshot targets', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	// Target selection runs on the reserved connection, which holds the temporary tables.
	const database = new ScannerDatabase(url)
	try {
		for (const table of [
			'blocks',
			'contracts',
			'pools',
			'pool_state_events',
			'escalation_game_events',
			'collateral_repair_auction_events',
			'protocol_timeline_entries',
			'entity_state_snapshots',
			'address_activity',
			'address_catalog',
			'address_balance_assets',
			'address_activity_summaries',
			'protocol_entity_identities',
			'protocol_entity_totals',
			'networks',
			'address_balance_snapshots',
			'token_metadata',
			'universe_events',
			'questions',
			'logs',
		])
			await connection.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`)
		for (const number of [1, 2, 3]) await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, canonical, timestamp) VALUES (${chainId}, ${number}, ${blockHash(number)}, ${zeroHash}, true, ${new Date(Date.UTC(2026, 0, number))})`
		for (const [contract, kind] of [
			[ledger, 'securityPoolCapitalLedger'],
			[otherLedger, 'securityPoolCapitalLedger'],
			[feed, 'sharedPoolPriceFeed'],
		] as const)
			await connection`INSERT INTO contracts (chain_id, address, label, kind, provenance, canonical) VALUES (${chainId}, ${lower(contract)}, ${kind}, ${kind}, 'test', true)`

		const events: readonly StoredLog[] = [
			event(1, 0, ledger, 'PrincipalDeposited', { payer: alice, owner: alice, amountAttoRep: '500' }),
			event(1, 1, ledger, 'CommitmentAuthorized', { owner: alice, positionId: '1', rep: '500', commitment: '100', targetHealthFactorBps: '12000' }),
			event(1, 2, ledger, 'PrincipalDeposited', { payer: bob, owner: bob, amountAttoRep: '900' }),
			event(1, 3, ledger, 'RepairAuctionBidMaterialized', { bidId: '4', bidder: carol, positionId: '3', principal: '70', commitment: '10' }),
			// Bob takes over part of Alice's position. The split creates position 2, which no event ties to an owner.
			event(2, 0, ledger, 'CommitmentTakenOver', { sourceId: '1', receiverId: '2', commitment: '40', takeoverRewardAttoRep: '25' }),
			event(2, 1, ledger, 'CommitmentCured', { positionId: '1', removedCommitment: '10' }),
			event(2, 2, feed, 'ReportOperationAttempted', { reportId: '7', sponsor: bob, operationIndex: '0', success: true }),
			// Position 5 of the other ledger is unresolved and must not be attributed across ledgers.
			event(3, 0, otherLedger, 'CommitmentCured', { positionId: '5', removedCommitment: '1' }),
			event(3, 1, ledger, 'EarningsClaimed', { owner: alice, ethAmount: '3', repAmount: '0' }),
		]
		for (const item of events) await storeLogProjections(connection, chainId, item)

		// Before any read: both ledgers and every owner an event names are targets. No position id is known to exist yet.
		const initialTargets = await database.stateSnapshotTargets(chainId, 3n, 25, undefined, connection)
		expect(initialTargets.map(target => [target.entityType, target.entityIdentity, target.ownerAddress, target.positionId])).toEqual([
			['capital-ledger', lower(ledger), undefined, undefined],
			['capital-ledger', lower(otherLedger), undefined, undefined],
			['capital-owner', `${lower(ledger)}:${lower(alice)}`, alice, undefined],
			['capital-owner', `${lower(ledger)}:${lower(bob)}`, bob, undefined],
			['capital-owner', `${lower(ledger)}:${lower(carol)}`, carol, undefined],
		])
		expect(initialTargets[0]?.address).toBe(ledger)
		expect(initialTargets[2]?.address).toBe(ledger)

		const snapshot = async (entityType: string, identity: string, blockNumber: number, readResult: Record<string, unknown> | null, status = 'success') =>
			await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp, source_method, read_status, read_result, read_failure_reason, canonical)
				VALUES (${chainId}, ${entityType}, ${identity}, ${blockNumber}, ${blockHash(blockNumber)}, ${new Date(Date.UTC(2026, 0, blockNumber))}, ${`augurscan.${entityType}-state.v1`}, ${status}, ${readResult === null ? null : JSON.stringify(readResult)}::text::jsonb, ${readResult === null ? 'execution reverted' : null}, true)`
		const identity = (owner: string) => `${lower(ledger)}:${lower(owner)}`
		await snapshot('capital-ledger', lower(ledger), 2, { securityPool: lower(securityPool), universeId: '0', priceFeed: lower(feed), lastPositionId: '3', commitmentAttoEth: '150', pledgedAttoRep: '1470', collateral: { address: lower(address('9')), symbol: 'USDC', decimals: 6 } })
		await snapshot('capital-owner', identity(alice), 1, ownerState(alice, { positionId: '1', principalAttoRep: '500', commitmentAttoEth: '100', pledgedAttoRep: '500', healthFactorBps: '20000', belowLiquidationPrice: false, takeoverPreconditionsMet: false }))
		await snapshot('capital-owner', identity(alice), 3, ownerState(alice, { positionId: '1', principalAttoRep: '475', commitmentAttoEth: '50', pledgedAttoRep: '475', healthFactorBps: '9500', belowLiquidationPrice: true, takeoverPreconditionsMet: true }))
		await snapshot('capital-owner', identity(bob), 3, ownerState(bob, { positionId: '2', principalAttoRep: '925', commitmentAttoEth: '40', pledgedAttoRep: '925', healthFactorBps: '11000', belowLiquidationPrice: false, takeoverPreconditionsMet: false }))
		await snapshot('capital-owner', identity(carol), 2, ownerState(carol, { positionId: '0', principalAttoRep: '70', commitmentAttoEth: '0', pledgedAttoRep: '0' }))
		await snapshot('capital-owner', identity(dave), 3, null, 'failed')
		// A fork imported two positions into the other ledger without any event; its read reports the last id.
		await snapshot('capital-ledger', lower(otherLedger), 3, { securityPool: lower(securityPool), universeId: '9', lastPositionId: '2' })
		const positionRead = async (ledgerAddress: string, id: string, owner: string) => await snapshot('capital-position', `${lower(ledgerAddress)}:${id}`, 3, { ledger: lower(ledgerAddress), positionId: id, owner: lower(owner) })
		// The take-over's source and the receiver that the split created, and the first imported position.
		await positionRead(ledger, '1', alice)
		await positionRead(ledger, '2', bob)
		// Dave holds position 3 without any event naming him; his own read has failed so far.
		await positionRead(ledger, '3', dave)
		await positionRead(otherLedger, '1', dave)

		// Every id up to a ledger's last id is read once: the resolved ones are never targets again, and the owner an
		// imported position revealed becomes a target although no event names it.
		const laterTargets = await database.stateSnapshotTargets(chainId, 3n, 25, undefined, connection)
		expect(laterTargets.map(target => [target.entityType, target.entityIdentity, target.ownerAddress, target.positionId])).toEqual([
			['capital-owner', `${lower(otherLedger)}:${lower(dave)}`, dave, undefined],
			['capital-position', `${lower(otherLedger)}:2`, undefined, 2n],
			['capital-ledger', lower(ledger), undefined, undefined],
			['capital-owner', identity(carol), carol, undefined],
		])
		expect(laterTargets[1]?.address).toBe(otherLedger)

		const ranked = await capitalPositionRows(connection, { chainId, snapshotBlock: '3', limit: 10, offset: 0 })
		expect(ranked.map((row: Record<string, unknown>) => [row['owner_address'], row['block_number'], row['total']])).toEqual([
			[lower(alice), '3', 5],
			[lower(bob), '3', 5],
			[lower(carol), '2', 5],
			[lower(dave), '3', 5],
			[lower(dave), null, 5],
		])
		const classified = (await capitalRiskOverview(connection, chainId, '3')).capitalPositions
		expect(classified.map((position: Record<string, unknown>) => [position['protocol_state'], position['scanner_severity'], position['universe_id']])).toEqual([
			['takeover-preconditions-met', 'critical', '0'],
			['healthy', 'warning', '0'],
			['uncommitted', 'healthy', '0'],
			['unavailable', 'unavailable', undefined],
			['unavailable', 'unavailable', undefined],
		])
		// At block 1 only Alice had been read, with her earlier health.
		const earlier = await capitalPositionRows(connection, { chainId, snapshotBlock: '1', limit: 10, offset: 0 })
		expect(earlier.map((row: Record<string, unknown>) => [row['owner_address'], row['block_number']])).toEqual([
			[lower(alice), '1'],
			[lower(bob), null],
			[lower(carol), null],
		])
		expect((await capitalPositionRows(connection, { chainId, snapshotBlock: '3', owner: lower(bob), limit: 10, offset: 0 })).map((row: Record<string, unknown>) => row['owner_address'])).toEqual([lower(bob)])
		expect((await capitalPositionRows(connection, { chainId, snapshotBlock: '3', limit: 2, offset: 2 })).map((row: Record<string, unknown>) => row['owner_address'])).toEqual([lower(carol), lower(dave)])

		const ledgers = await capitalLedgerRows(connection, chainId, '3')
		expect(ledgers.map((row: Record<string, unknown>) => [row['ledger_address'], row['owner_count'], row['block_number']])).toEqual([
			[lower(ledger), 4, '2'],
			[lower(otherLedger), 1, '3'],
		])

		const page = { block: '3', log: 2_147_483_647, tx: `0x${'f'.repeat(64)}`, limit: 100 }
		const feedRows = await liquidationRows(connection, { chainId, snapshotBlock: '3', page })
		expect(feedRows.map((row: Record<string, unknown>) => [row['event_name'], row['ledger_address'], row['universe_id'], row['source_owner'], row['receiver_owner']])).toEqual([
			['CommitmentCured', lower(otherLedger), '9', null, null],
			['ReportOperationAttempted', lower(ledger), '0', null, null],
			['CommitmentCured', lower(ledger), '0', lower(alice), null],
			['CommitmentTakenOver', lower(ledger), '0', lower(alice), lower(bob)],
		])
		expect(feedRows[3]).toMatchObject({ securityPool: lower(securityPool), collateral: { symbol: 'USDC', decimals: 6 }, event_data: { commitment: '40', takeoverRewardAttoRep: '25' } })
		// Bob received the take-over and sponsored the report operation; the cure of Alice's position is not his.
		expect((await liquidationRows(connection, { chainId, snapshotBlock: '3', owner: lower(bob), page })).map((row: Record<string, unknown>) => row['event_name'])).toEqual(['ReportOperationAttempted', 'CommitmentTakenOver'])
		expect((await liquidationRows(connection, { chainId, snapshotBlock: '3', ledger: lower(otherLedger), page })).map((row: Record<string, unknown>) => row['event_name'])).toEqual(['CommitmentCured'])
		expect((await liquidationRows(connection, { chainId, snapshotBlock: '3', page: { ...page, limit: 2 } })).map((row: Record<string, unknown>) => row['log_index'])).toEqual([0, 2])
		expect((await liquidationRows(connection, { chainId, snapshotBlock: '1', page })).length).toBe(0)

		const aliceEvents = await capitalOwnerEventRows(connection, { chainId, ledger: lower(ledger), owner: lower(alice), snapshotBlock: '3', page })
		expect(aliceEvents.map((row: Record<string, unknown>) => row['event_name'])).toEqual(['EarningsClaimed', 'CommitmentCured', 'CommitmentTakenOver', 'CommitmentAuthorized', 'PrincipalDeposited'])
		const bobEvents = await capitalOwnerEventRows(connection, { chainId, ledger: lower(ledger), owner: lower(bob), snapshotBlock: '3', page })
		expect(bobEvents.map((row: Record<string, unknown>) => row['event_name'])).toEqual(['ReportOperationAttempted', 'CommitmentTakenOver', 'PrincipalDeposited'])
		expect((await capitalOwnerEventRows(connection, { chainId, ledger: lower(ledger), owner: lower(carol), snapshotBlock: '3', page })).map((row: Record<string, unknown>) => row['event_name'])).toEqual(['RepairAuctionBidMaterialized'])

		const history = await capitalPositionHistoryRows(connection, { chainId, ledger: lower(ledger), owner: lower(alice), snapshotBlock: '3', limit: 10 })
		expect(history.map((row: Record<string, unknown>) => [row['block_number'], (row['read_result'] as Record<string, unknown>)['healthFactorBps']])).toEqual([
			['3', '9500'],
			['1', '20000'],
		])

		const overview = await capitalRiskOverview(connection, chainId, '3')
		expect(overview.capitalPositionTotal).toBe(5)
		expect(overview.capitalPositions[0]).toMatchObject({ owner_address: lower(alice), protocol_state: 'takeover-preconditions-met' })
		expect(overview.capitalLedgers[0]).toMatchObject({ ledger_address: lower(ledger), securityPool: lower(securityPool), universe_id: '0' })
		expect(overview.recentLiquidations).toHaveLength(4)

		// The rich list and the address profile read the same latest position per ledger.
		await connection`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash) VALUES (${chainId}, 'test', 'Test', '', 0, 3, ${blockHash(3)})`
		await connection`INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, role, pool_address, canonical) VALUES (${chainId}, ${blockHash(1)}, 1, ${blockHash(1_001)}, ${lower(alice)}, 'sender', ${`0x${'0'.repeat(40)}`}, true)`
		// Alice's refund is in the auction's 6-decimal collateral token. Its latest read failed after an earlier successful one sampled the token.
		const auction = lower(address('8'))
		const auctionCollateralToken = { address: lower(address('9')), symbol: 'USDC', decimals: 6 }
		await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical)
			VALUES (${chainId}, 2, ${blockHash(2)}, ${blockHash(1_002)}, 9, ${auction}, 'BidSettled', ${JSON.stringify({ bidId: '1', bidder: lower(alice), filledLots: '0', refundAttoEth: '1500000' })}::text::jsonb, true)`
		await snapshot('auction', auction, 2, { lotAttoEth: '1000000', collateral: auctionCollateralToken })
		await snapshot('auction', auction, 3, null, 'failed')
		// Another auction's newer successful read has no collateral key, so the earlier read still names its token.
		const keylessAuction = lower(address('7'))
		const keylessAuctionToken = { address: lower(address('6')), symbol: 'DAI', decimals: 18 }
		await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical)
			VALUES (${chainId}, 2, ${blockHash(2)}, ${blockHash(1_002)}, 8, ${keylessAuction}, 'BidSettled', ${JSON.stringify({ bidId: '2', bidder: lower(alice), filledLots: '0', refundAttoEth: '7' })}::text::jsonb, true)`
		await snapshot('auction', keylessAuction, 1, { lotAttoEth: '1', collateral: keylessAuctionToken })
		await snapshot('auction', keylessAuction, 3, { lotAttoEth: '1' })
		expect(await auctionCollateral(connection, chainId, '3', keylessAuction)).toEqual(keylessAuctionToken)
		// Bob withdrew his refund credit to Alice: the payment belongs to Alice's auction interactions too.
		const refundData = { bidder: lower(bob), recipient: lower(alice), amountAttoEth: '1000000' }
		await connection`INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, arguments, decode_status, event_name, summary, canonical)
			VALUES (${chainId}, ${blockHash(1_003)}, ${blockHash(3)}, 3, 0, 7, ${auction}, '[]'::jsonb, '0x', ${JSON.stringify(refundData)}::text::jsonb, 'decoded', 'RefundWithdrawn', 'RefundWithdrawn', true)`
		await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical)
			VALUES (${chainId}, 3, ${blockHash(3)}, ${blockHash(1_003)}, 7, ${auction}, 'RefundWithdrawn', ${JSON.stringify(refundData)}::text::jsonb, true)`
		for (const number of [1, 2, 3]) await refreshHistoryAggregates(connection, chainId, blockHash(number), String(number))
		const rich = await richListRows(connection, { chainId, address: lower(alice), snapshotBlock: '3', limit: 10, offset: 0, sort: 'transactions' })
		expect(rich[0]?.['auction_claims']).toEqual([
			expect.objectContaining({ type: 'RefundWithdrawn', entity: auction, blockNumber: '3', collateral: auctionCollateralToken }),
			expect.objectContaining({ type: 'BidSettled', entity: auction, collateral: auctionCollateralToken }),
			expect.objectContaining({ type: 'BidSettled', entity: keylessAuction, collateral: keylessAuctionToken }),
		])
		expect(rich[0]).toMatchObject({ auction_claims_truncated: false, escalation_claims_truncated: false })
		await connection`INSERT INTO escalation_game_events (chain_id, block_number, block_hash, tx_hash, log_index, game_address, event_name, event_data, canonical)
			SELECT ${chainId}, 3, ${blockHash(3)}, ${blockHash(1_003)}, i, ${ledger}, 'CarryDepositConsumed', ${JSON.stringify({ depositor: lower(alice) })}::text::jsonb, true FROM generate_series(10, 109) i`
		const readClaims = async () => (await richListRows(connection, { chainId, address: lower(alice), snapshotBlock: '3', limit: 1, offset: 0, sort: 'transactions' }))[0]
		expect(await readClaims()).toMatchObject({ escalation_claims_truncated: false })
		await connection`INSERT INTO escalation_game_events (chain_id, block_number, block_hash, tx_hash, log_index, game_address, event_name, event_data, canonical)
			VALUES (${chainId}, 3, ${blockHash(3)}, ${blockHash(1_003)}, 110, ${ledger}, 'CarryDepositConsumed', ${JSON.stringify({ depositor: lower(alice) })}::text::jsonb, true)`
		await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical)
			SELECT ${chainId}, 3, ${blockHash(3)}, ${blockHash(1_003)}, i, ${auction}, 'BidSettled', ${JSON.stringify({ bidder: lower(alice) })}::text::jsonb, true FROM generate_series(20, 120) i`
		const cappedClaims = await readClaims()
		expect(cappedClaims).toMatchObject({ escalation_claims_truncated: true, auction_claims_truncated: true })
		expect(cappedClaims?.['escalation_claims']).toHaveLength(100)
		expect(cappedClaims?.['auction_claims']).toHaveLength(100)
		expect(rich[0]?.['capital_positions']).toEqual([
			{
				ledgerAddress: lower(ledger),
				securityPool: lower(securityPool),
				universeId: '0',
				readStatus: 'success',
				principalAttoRep: '475',
				commitmentAttoEth: '50',
				healthFactorBps: '9500',
				unclaimedFeesAttoEth: null,
				unclaimedFeesAttoRep: null,
				collateral: { address: lower(address('9')), symbol: 'USDC', decimals: 6 },
				blockNumber: '3',
			},
		])
		// The HTTP layer: snapshot-bound pagination of the ranked catalog, the detail composition and its event cursor.
		const api = async (path: string) => {
			const response = await handleApi(new Request(`http://localhost${path}`), connection)
			if (response === undefined) throw new Error(`${path} did not return a response`)
			return response
		}
		type CatalogBody = { asOf: { blockNumber: string }; data: { ledgers: unknown[]; positions: { items: Record<string, unknown>[]; total: number; hasMore: boolean; nextCursor?: string } } }
		const firstCatalog = (await (await api(`/api/v1/state/capital?chainId=${chainId}&limit=3`)).json()) as CatalogBody
		expect(firstCatalog.asOf.blockNumber).toBe('3')
		expect(firstCatalog.data.ledgers).toHaveLength(2)
		expect(firstCatalog.data.positions).toMatchObject({ total: 5, hasMore: true })
		expect(firstCatalog.data.positions.items.map(item => [item['owner_address'], item['protocol_state']])).toEqual([
			[lower(alice), 'takeover-preconditions-met'],
			[lower(bob), 'healthy'],
			[lower(carol), 'uncommitted'],
		])
		const cursor = encodeURIComponent(firstCatalog.data.positions.nextCursor ?? '')
		const secondResponse = await api(`/api/v1/state/capital?chainId=${chainId}&limit=3&cursor=${cursor}`)
		const secondCatalog = (await secondResponse.json()) as CatalogBody
		expect(secondResponse.status).toBe(200)
		expect(secondCatalog.data.positions).toMatchObject({ total: 5, hasMore: false })
		expect(secondCatalog.data.positions.items.map(item => [item['ledger_address'], item['owner_address']])).toEqual([
			[lower(ledger), lower(dave)],
			[lower(otherLedger), lower(dave)],
		])
		// A cursor continues only the filter it was issued for.
		expect((await api(`/api/v1/state/capital?chainId=${chainId}&limit=3&owner=${lower(bob)}&cursor=${cursor}`)).status).toBe(400)
		expect(((await (await api(`/api/v1/state/capital?chainId=${chainId}&owner=${lower(bob)}`)).json()) as CatalogBody).data.positions.items.map(item => item['owner_address'])).toEqual([lower(bob)])
		expect(((await (await api(`/api/v1/state/capital?chainId=${chainId}&ledger=${lower(otherLedger)}`)).json()) as CatalogBody).data).toMatchObject({ ledgers: [{ ledger_address: lower(otherLedger) }], positions: { total: 1, items: [expect.objectContaining({ owner_address: lower(dave), read_status: 'unsampled' })] } })

		type DetailBody = { data: Record<string, unknown> & { history: { snapshots: Record<string, unknown>[]; truncated: boolean }; events: { items: Record<string, unknown>[]; hasMore: boolean; nextCursor?: string } } }
		const detailPath = `/api/v1/state/capital/${chainId}/${lower(ledger)}/${lower(alice)}`
		const detail = (await (await api(`${detailPath}?limit=2`)).json()) as DetailBody
		expect(detail.data).toMatchObject({ ledger_address: lower(ledger), owner_address: lower(alice), protocol_state: 'takeover-preconditions-met', scanner_severity: 'critical', universe_id: '0', ledger: { ledger_address: lower(ledger), owner_count: 4 } })
		// The detail view renders the read through its risk panel; a second `snapshot` copy would duplicate it.
		expect(detail.data).not.toHaveProperty('snapshot')
		expect(detail.data.history).toMatchObject({ truncated: false })
		expect(detail.data.history.snapshots.map(row => row['block_number'])).toEqual(['3', '1'])
		expect(detail.data.events.items.map(row => row['event_name'])).toEqual(['EarningsClaimed', 'CommitmentCured'])
		expect(detail.data.events.hasMore).toBe(true)
		const older = (await (await api(`${detailPath}?limit=2&cursor=${encodeURIComponent(detail.data.events.nextCursor ?? '')}`)).json()) as DetailBody
		expect(older.data.events.items.map(row => row['event_name'])).toEqual(['CommitmentTakenOver', 'CommitmentAuthorized'])
		// The detail cursor belongs to its position.
		expect((await api(`/api/v1/state/capital/${chainId}/${lower(ledger)}/${lower(bob)}?cursor=${encodeURIComponent(detail.data.events.nextCursor ?? '')}`)).status).toBe(400)
		// A historical snapshot shows the position as it was read then.
		expect(((await (await api(`${detailPath}?atBlock=1`)).json()) as DetailBody).data).toMatchObject({ protocol_state: 'healthy', block_number: '1' })
		expect((await api(`/api/v1/state/capital/${chainId}/${lower(ledger)}/${lower(address('e'))}`)).status).toBe(404)

		// The auction detail names the collateral token from the latest successful read, although the latest snapshot failed.
		expect(await (await api(`/api/v1/state/auctions/${chainId}/${auction}`)).json()).toMatchObject({ data: { snapshot: { read_status: 'failed', block_number: '3' }, collateral: auctionCollateralToken } })

		const richEarlier = await richListRows(connection, { chainId, address: lower(alice), snapshotBlock: '1', limit: 10, offset: 0, sort: 'transactions' })
		expect((richEarlier[0]?.['capital_positions'] as readonly Record<string, unknown>[])[0]).toMatchObject({ healthFactorBps: '20000', blockNumber: '1' })
		for (let index = 1; index <= 100; index++) {
			const additionalLedger = `0x${index.toString(16).padStart(40, '0')}`
			await connection`INSERT INTO contracts (chain_id, address, label, kind, provenance, canonical) VALUES (${chainId}, ${additionalLedger}, 'Ledger', 'securityPoolCapitalLedger', 'test', true)`
			await snapshot('capital-owner', `${additionalLedger}:${lower(alice)}`, 3, {})
		}
		const capped = await richListRows(connection, { chainId, address: lower(alice), snapshotBlock: '3', limit: 1, offset: 0, sort: 'transactions' })
		expect(capped[0]?.['capital_position_count']).toBe(101)
		expect(capped[0]?.['capital_positions']).toHaveLength(100)
	} finally {
		await database.close()
		connection.release()
		await sql.close()
	}
})
