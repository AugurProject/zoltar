import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { initializeSchema } from '../../src/schema.ts'
import { sharePositions, pendingAuctionRefunds, escalationPositions, escalationPayouts } from '../../src/repositories/share-positions.ts'
import { escalationCatalogData } from '../../src/repositories/operations.ts'
import { auctionCollateral } from '../../src/repositories/auction-collateral.ts'
import { timelineCatalogRows } from '../../src/repositories/timeline.ts'
import { chainDecodeCoverage } from '../../src/abi-coverage-report.ts'
import { timelineTransitionSummary } from '../../browser/semantic-evidence.ts'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('canonical semantic state respects snapshots, migrations, claims and refund boundaries', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['logs', 'blocks', 'contracts', 'amm_markets', 'escalation_game_events', 'collateral_repair_auction_events', 'entity_state_snapshots', 'protocol_timeline_entries', 'transactions', 'actions', 'pools']) {
			await connection.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`)
		}
		const token = `0x${'1'.repeat(40)}`
		const owner = `0x${'2'.repeat(40)}`
		const zero = `0x${'0'.repeat(40)}`
		const hash = `0x${'3'.repeat(64)}`
		await connection`INSERT INTO blocks (chain_id, number, hash, canonical) VALUES (1, 1, ${hash}, true)`
		await connection`INSERT INTO contracts (chain_id, address, kind, canonical) VALUES (1, ${token}, 'shareToken', true)`
		const transfers = [
			['TransferBatch', { from: zero, to: owner, ids: ['0', '1', '2'], values: ['10', '20', '30'] }, true],
			['TransferSingle', { from: owner, to: zero, id: '1', value: '5' }, true],
			['TransferSingle', { from: zero, to: owner, id: '257', value: '15' }, true],
			['Migrate', { migrator: owner, fromId: '1', toId: '257', amountAttoShares: String(15n) }, true],
			['TransferSingle', { from: zero, to: owner, id: '1', value: '999' }, false],
		] as const
		for (const [index, [name, data, canonical]] of transfers.entries())
			await connection`INSERT INTO logs (chain_id, block_number, block_hash, tx_hash, log_index, emitter_address, event_name, arguments, canonical) VALUES (1, 1, ${hash}, ${hash}, ${index}, ${token}, ${name}, ${JSON.stringify(data)}::text::jsonb, ${canonical})`
		const positions = await sharePositions(connection, 1, '1', { address: owner })
		expect(positions.items).toHaveLength(2)
		expect(positions.items[0]).toMatchObject({ universe_id: '0', invalid_atto_shares: '10', yes_atto_shares: '15', no_atto_shares: '30', complete_sets_atto_shares: '10', migration_locked: true })
		expect(positions.items[1]).toMatchObject({ universe_id: '1', yes_atto_shares: '15', complete_sets_atto_shares: '0', migration_locked: false })
		expect((await sharePositions(connection, 1, '0', { address: owner })).items).toEqual([])
		expect(positions.items.map((item: Record<string, unknown>) => item['recovery_locked'])).toEqual([false, false])
		// Spending recovery rights beyond the credits received earlier locks the source balance, as ShareToken does.
		const recoveryHash = `0x${'6'.repeat(64)}`
		const recipient = `0x${'7'.repeat(40)}`
		const giver = `0x${'8'.repeat(40)}`
		await connection`INSERT INTO blocks (chain_id, number, hash, canonical) VALUES (1, 3, ${recoveryHash}, true)`
		for (const [index, [name, data]] of [
			['TransferBatch', { from: zero, to: recipient, ids: ['512', '513', '514'], values: ['21', '21', '21'] }],
			['TransferBatch', { from: zero, to: giver, ids: ['512', '513', '514'], values: ['5', '5', '5'] }],
			// The giver transfers rights to the recipient, which first spends those credits and then its own source rights.
			['SecurityPoolRecoveryRightsTransferred', { universeId: '2', from: giver, to: recipient, amountsAttoShares: ['5', '5', '5'] }],
			['SecurityPoolRecoveryRightsConsumed', { universeId: '2', holder: recipient, amountAttoShares: '5', cumulativeAttoShares: '5' }],
		].entries())
			await connection`INSERT INTO logs (chain_id, block_number, block_hash, tx_hash, log_index, emitter_address, event_name, arguments, canonical) VALUES (1, 3, ${recoveryHash}, ${recoveryHash}, ${index}, ${token}, ${name}, ${JSON.stringify(data)}::text::jsonb, true)`
		// Spending exactly the received credits leaves the recipient's own balance transferable; the giver spent its own.
		expect((await sharePositions(connection, 1, '3', { address: recipient })).items).toEqual([expect.objectContaining({ universe_id: '2', invalid_atto_shares: '21', migration_locked: false, recovery_locked: false })])
		expect((await sharePositions(connection, 1, '3', { address: giver })).items).toEqual([expect.objectContaining({ universe_id: '2', recovery_locked: true })])
		await connection`INSERT INTO logs (chain_id, block_number, block_hash, tx_hash, log_index, emitter_address, event_name, arguments, canonical) VALUES (1, 3, ${recoveryHash}, ${recoveryHash}, 10, ${token}, 'SecurityPoolRecoveryRightsConsumed', ${JSON.stringify({ universeId: '2', holder: recipient, amountAttoShares: '21', cumulativeAttoShares: '26' })}::text::jsonb, true)`
		expect((await sharePositions(connection, 1, '3', { address: recipient })).items).toEqual([expect.objectContaining({ universe_id: '2', yes_atto_shares: '21', recovery_locked: true })])
		// Before the recovery block nothing is locked.
		expect((await sharePositions(connection, 1, '2', { address: recipient })).items).toEqual([])
		const otherBidder = `0x${'4'.repeat(40)}`
		// BidSettled credits a refund and RefundWithdrawn pays the bidder's whole credit, as the auction contract does.
		const auctionEvents = [
			['BidSettled', { bidId: '1', bidder: owner, filledLots: '2', refundAttoEth: '12' }, 1],
			['RefundWithdrawn', { bidder: owner, recipient: otherBidder, amountAttoEth: '12' }, 1],
			['BidSettled', { bidId: '2', bidder: owner, filledLots: '0', refundAttoEth: '5' }, 1],
			['BidSettled', { bidId: '3', bidder: otherBidder, filledLots: '0', refundAttoEth: '99' }, 1],
			['RefundWithdrawn', { bidder: owner, recipient: owner, amountAttoEth: '5' }, 2],
		] as const
		for (const [index, [name, data, blockNumber]] of auctionEvents.entries())
			await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical) VALUES (1, ${blockNumber}, ${hash}, ${hash}, ${index}, ${token}, ${name}, ${JSON.stringify(data)}::text::jsonb, true)`
		// Without a sampled auction snapshot the refund carries no collateral metadata and the browser keeps raw collateral units.
		expect(await pendingAuctionRefunds(connection, 1, '1', owner)).toEqual([expect.objectContaining({ auction_address: token, pending_atto_eth: '5', collateral: null })])
		expect(await pendingAuctionRefunds(connection, 1, '2', owner)).toEqual([])
		await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical)
			VALUES (1, 3, ${hash}, ${hash}, 8, ${token}, 'RefundWithdrawn', ${JSON.stringify({ bidder: owner, amountAttoEth: '10' })}::text::jsonb, true)`
		expect(await pendingAuctionRefunds(connection, 1, '3', owner)).toEqual([])
		await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical)
			VALUES (1, 3, ${hash}, ${hash}, 9, ${token}, 'BidSettled', ${JSON.stringify({ bidder: owner, refundAttoEth: '4' })}::text::jsonb, true)`
		expect(await pendingAuctionRefunds(connection, 1, '3', owner)).toEqual([expect.objectContaining({ pending_atto_eth: '4' })])
		const usdc = { address: `0x${'5'.repeat(40)}`, symbol: 'USDC', decimals: 6 }
		expect(await auctionCollateral(connection, 1, '1', token)).toBeUndefined()
		// Temporary copies drop the observed_at default, so each read states when it was observed: the failed read is the later one.
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical, observed_at) VALUES (1, 'auction', ${token}, 1, ${hash}, 'success', ${JSON.stringify({ lotAttoEth: '1000000', collateral: usdc })}::text::jsonb, true, '2026-01-01T00:00:00Z')`
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical, observed_at) VALUES (1, 'auction', ${token}, 1, ${hash}, 'failed', NULL, true, '2026-01-01T00:01:00Z')`
		// A later failed read does not hide the immutable collateral token sampled earlier.
		expect(await pendingAuctionRefunds(connection, 1, '1', owner)).toEqual([expect.objectContaining({ auction_address: token, pending_atto_eth: '5', collateral: usdc })])
		expect(await auctionCollateral(connection, 1, '1', token)).toEqual(usdc)
		// Timeline auctions use their sampled collateral; security pool and feed entries use the capital ledger's snapshot.
		const ledger = `0x${'6'.repeat(40)}`
		const services = `0x${'7'.repeat(40)}`
		const priceFeed = `0x${'b'.repeat(40)}`
		const untaggedFeed = `0x${'c'.repeat(40)}`
		await connection`INSERT INTO contracts (chain_id, address, kind, canonical) VALUES (1, ${ledger}, 'securityPoolCapitalLedger', true)`
		const ledgerRead = { securityPool: `0x${'8'.repeat(40)}`, universeId: '0', priceFeed, fees: { services }, collateral: usdc }
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical, observed_at) VALUES (1, 'capital-ledger', ${ledger}, 1, ${hash}, 'success', ${JSON.stringify(ledgerRead)}::text::jsonb, true, '2026-01-01T00:00:00Z')`
		// Later token metadata must not leak into a timeline requested at block 1.
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical, observed_at) VALUES (1, 'capital-ledger', ${ledger}, 3, ${recoveryHash}, 'success', ${JSON.stringify({ ...ledgerRead, collateral: { ...usdc, symbol: 'LATER' } })}::text::jsonb, true, '2026-01-03T00:00:00Z')`
		for (const [index, [entityType, eventName, identity]] of [
			['auction', 'BidSettled', token],
			['pool', 'SystemStateSet', token],
			['security-pool-services', 'PremiumFunded', `${services}:0`],
			['price-feed', 'PriceReported', priceFeed],
			['price-feed', 'PriceReported', untaggedFeed],
		].entries())
			await connection`INSERT INTO protocol_timeline_entries (chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity, semantic_event_kind, summary_data, source_contract, source_event, canonical) VALUES (1, ${hash}, ${hash}, ${index}, 1, ${entityType}, ${identity}, ${eventName}, ${JSON.stringify(eventName === 'PriceReported' ? { price: (2n * 10n ** 30n).toString() } : {})}::text::jsonb, ${token}, ${eventName}, true)`
		const timeline = await timelineCatalogRows(connection, {
			chainId: 1,
			fromBlock: '0',
			toBlock: '1',
			canonical: 'canonical',
			asOfBlock: '1',
			cursor: { block: '2', log: 0, tx: hash, blockHash: hash, entityType: '', identity: '' },
			limit: 10,
		})
		expect(timeline.rows.map((row: Record<string, unknown>) => [row['entity_type'], row['collateral']])).toEqual([
			['price-feed', null],
			['price-feed', usdc],
			['security-pool-services', usdc],
			['pool', null],
			['auction', usdc],
		])
		const feed = timeline.rows.find((row: Record<string, unknown>) => row['entity_type'] === 'price-feed' && row['entity_identity'] === priceFeed)
		if (feed === undefined) throw new Error('Missing price feed timeline row')
		expect(timelineTransitionSummary(feed, 'ETH')).toBe('Canonical Price: 2 REP/USDC')
		const unsampledFeed = timeline.rows.find((row: Record<string, unknown>) => row['entity_type'] === 'price-feed' && row['entity_identity'] === untaggedFeed)
		if (unsampledFeed === undefined) throw new Error('Missing unsampled feed timeline row')
		expect(timelineTransitionSummary(unsampledFeed, 'ETH')).toBe('Canonical Price: 2,000,000,000,000,000,000,000,000,000,000 raw price units')
		// Outcome shares carry the collateral token a pool on their share token and universe samples.
		const pool = `0x${'9'.repeat(40)}`
		await connection`INSERT INTO pools (chain_id, block_number, pool_address, share_token_address, universe_id, canonical) VALUES (1, 1, ${pool}, ${token}, 0, true)`
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical, observed_at) VALUES (1, 'pool', ${pool}, 1, ${hash}, 'success', ${JSON.stringify({ collateral: usdc })}::text::jsonb, true, '2026-01-01T00:00:00Z')`
		expect((await sharePositions(connection, 1, '1', { address: owner })).items.map((item: Record<string, unknown>) => [item['universe_id'], item['collateral']])).toEqual([
			['0', usdc],
			['1', null],
		])
		await connection`DELETE FROM entity_state_snapshots WHERE entity_type = 'auction'`
		await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 1, ${hash}, ${hash}, 1, 'LocalDepositAppended', ${JSON.stringify({ depositor: owner, outcome: '1', parentDepositIndex: '4', amountAttoRep: '200' })}::text::jsonb, true)`
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical) VALUES (1, 'escalation', ${token}, 1, ${hash}, 'success', ${JSON.stringify({ outcomeBalancesAttoRep: ['2', '3', '4'], finalQuestionResolution: '1' })}::text::jsonb, true)`
		expect(await escalationCatalogData(connection, 1, '1')).toEqual([expect.objectContaining({ invalid_stake_atto_rep: '2', yes_stake_atto_rep: '3', no_stake_atto_rep: '4', concluded: false })])
		expect(await escalationPositions(connection, 1, '1', owner)).toEqual([expect.objectContaining({ principal_atto_rep: '200', consumed_block: null, final_resolution: '1' })])
		await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 2, ${hash}, ${hash}, 2, 'CarryDepositConsumed', ${JSON.stringify({ depositor: owner, outcome: '1', parentDepositIndex: '4', reason: '0' })}::text::jsonb, true)`
		expect((await escalationPositions(connection, 1, '2', owner))[0]).toMatchObject({ consumed_block: '2', consumption_reason: '0' })
		// Ordinary settlement for YES retires the losing INVALID and NO deposits without a per-deposit event.
		for (const [logIndex, outcome] of [
			[3, '0'],
			[4, '2'],
		] as const)
			await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 1, ${hash}, ${hash}, ${logIndex}, 'LocalDepositAppended', ${JSON.stringify({ depositor: owner, outcome, parentDepositIndex: String(logIndex), amountAttoRep: '100' })}::text::jsonb, true)`
		await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 3, ${hash}, ${hash}, 5, 'OrdinarySettlementInitialized', ${JSON.stringify({ outcome: '1', winningPrincipalAttoRep: '200', reservedAttoRep: '200' })}::text::jsonb, true)`
		await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 3, ${hash}, ${hash}, 6, 'ClaimDeposit', '{}'::jsonb, true)`
		expect((await escalationCatalogData(connection, 1, '3'))[0]).toMatchObject({ event_name: 'ClaimDeposit', concluded: true })
		expect((await escalationPositions(connection, 1, '2', owner)).map((row: Record<string, unknown>) => [row['outcome'], row['retired_block']])).toEqual([
			['2', null],
			['0', null],
			['1', null],
		])
		expect((await escalationPositions(connection, 1, '3', owner)).map((row: Record<string, unknown>) => [row['outcome'], row['consumed_block'], row['retired_block']])).toEqual([
			['2', null, '3'],
			['0', null, '3'],
			['1', '2', null],
		])
		const claimEvidence = { status: 'available', truncated: false, positions: [{ depositor: owner, kind: 'inherited', status: 'claimable', payout_atto_rep: '123', proof: { leafIndex: '2', nullifierSiblings: [] } }] }
		await connection`UPDATE entity_state_snapshots SET read_result = read_result || jsonb_build_object('claimEvidence', ${JSON.stringify(claimEvidence)}::text::jsonb) WHERE entity_type = 'escalation'`
		const payouts = await escalationPayouts(connection, 1, '1', owner)
		expect(payouts.items).toEqual([expect.objectContaining({ game_address: token, snapshot_block: '1', position: expect.objectContaining({ kind: 'inherited', payout_atto_rep: '123' }) })])
		expect((await escalationPayouts(connection, 1, '1', zero)).items).toEqual([])
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical) VALUES (1, 'escalation', ${token}, 2, ${hash}, 'failed', NULL, true)`
		expect((await escalationPayouts(connection, 1, '2', owner)).items).toEqual([])
		expect((await escalationPayouts(connection, 1, '2', owner)).unavailable_games).toBe('1')
		expect((await escalationPayouts(connection, 1, '1', owner)).items).toHaveLength(1)

		await connection`INSERT INTO transactions (chain_id, hash, block_hash, block_number, to_address, input, status, receipt, canonical) VALUES (1, ${hash}, ${hash}, 1, ${token}, '0x12345678', 'reverted', '{"callTraceStatus":"unavailable"}'::jsonb, true)`
		await connection`INSERT INTO actions (chain_id, tx_hash, block_hash, decode_status) VALUES (1, ${hash}, ${hash}, 'unknown')`
		expect(await chainDecodeCoverage(connection, 1, '1')).toMatchObject({ observed_calls: '1', undecoded_calls: '1', traced_transactions: '0' })
		expect(await chainDecodeCoverage(connection, 2, '1')).toMatchObject({ observed_calls: '0', undecoded_calls: '0' })
	} finally {
		connection.release()
		await sql.close()
	}
})
