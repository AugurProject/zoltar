import type { SQL } from 'bun'

type PageBoundary = { readonly block: string; readonly log: number; readonly tx: string; readonly limit: number }

export const latestEntitySnapshot = async (sql: SQL, chainId: number, entityType: string, entityIdentity: string) => {
	const rows = await sql`
		SELECT snapshot.* FROM entity_state_snapshots snapshot
		JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash AND block.canonical
		WHERE snapshot.chain_id = ${chainId} AND snapshot.entity_type = ${entityType}
			AND snapshot.entity_identity = ${entityIdentity} AND snapshot.canonical
		ORDER BY snapshot.block_number DESC, snapshot.observed_at DESC LIMIT 1
	`
	return rows[0]
}

export const reportDetailData = async (
	sql: SQL,
	query: {
		readonly chainId: number
		readonly openOracleAddress: string
		readonly reportId: string
		readonly rounds: PageBoundary
		readonly decisions: PageBoundary
	},
) => {
	const { chainId, openOracleAddress, reportId, rounds, decisions } = query
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM open_oracle_report_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.open_oracle_address = ${openOracleAddress}
			AND event.report_id = ${reportId} AND event.canonical
			AND (event.block_number, event.log_index, event.tx_hash) < (${rounds.block}::bigint, ${rounds.log}::integer, ${rounds.tx})
		ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${rounds.limit}
	`
	const currentRows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM open_oracle_report_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.open_oracle_address = ${openOracleAddress}
			AND event.report_id = ${reportId} AND event.canonical
		ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1
	`
	const coordinatorDecisions = await sql`
		WITH coordinators AS (
			SELECT DISTINCT request.emitter_address
			FROM open_oracle_report_events report
			JOIN logs request ON request.chain_id = report.chain_id AND request.block_hash = report.block_hash
				AND request.tx_hash = report.tx_hash AND request.canonical
			WHERE report.chain_id = ${chainId} AND report.open_oracle_address = ${openOracleAddress}
				AND report.report_id = ${reportId} AND report.canonical AND report.event_name = 'ReportSubmitted'
				AND request.event_name = 'PriceRequested' AND request.arguments->>'reportId' = ${reportId}
		)
		SELECT log.block_number::text, log.block_hash, log.tx_hash, log.log_index, log.emitter_address,
			log.event_name, log.arguments, log.summary, block.timestamp AS block_timestamp
		FROM logs log JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash
		JOIN coordinators coordinator ON coordinator.emitter_address = log.emitter_address
		WHERE log.chain_id = ${chainId} AND log.canonical AND log.arguments->>'reportId' = ${reportId}
			AND log.event_name IN ('PriceRequested', 'PriceReportRejected', 'PriceReported', 'PendingReportRecovered', 'CoordinatorStateCheckpoint')
			AND (log.block_number, log.log_index, log.tx_hash) < (${decisions.block}::bigint, ${decisions.log}::integer, ${decisions.tx})
		ORDER BY log.block_number DESC, log.log_index DESC, log.tx_hash DESC LIMIT ${decisions.limit}
	`
	return { rows, current: currentRows[0], coordinatorDecisions }
}

export const eventEntityRows = async (sql: SQL, query: { readonly chainId: number; readonly address: string; readonly domain: 'auction' | 'escalation'; readonly page: PageBoundary }) => {
	const { chainId, address, domain, page } = query
	return domain === 'auction'
		? await sql`SELECT event.*, block.timestamp AS block_timestamp FROM truth_auction_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash WHERE event.chain_id = ${chainId} AND event.auction_address = ${address} AND event.canonical AND (event.block_number, event.log_index, event.tx_hash) < (${page.block}::bigint, ${page.log}::integer, ${page.tx}) ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.limit}`
		: await sql`SELECT event.*, block.timestamp AS block_timestamp FROM escalation_game_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash WHERE event.chain_id = ${chainId} AND event.game_address = ${address} AND event.canonical AND (event.block_number, event.log_index, event.tx_hash) < (${page.block}::bigint, ${page.log}::integer, ${page.tx}) ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.limit}`
}

export const auctionDetailData = async (sql: SQL, chainId: number, address: string) => {
	const [bids, finalizations] = await Promise.all([
		sql`SELECT event_data->>'tick' AS tick, sum((event_data->>'bidAmountAttoEth')::numeric)::text AS amount_atto_eth
			FROM truth_auction_events WHERE chain_id = ${chainId} AND auction_address = ${address}
				AND canonical AND event_name = 'BidSubmitted'
			GROUP BY event_data->>'tick' ORDER BY (event_data->>'tick')::numeric DESC LIMIT 1001`,
		sql`SELECT * FROM truth_auction_events WHERE chain_id = ${chainId} AND auction_address = ${address}
			AND canonical AND event_name = 'AuctionFinalized' ORDER BY block_number DESC, log_index DESC LIMIT 1`,
	])
	return { bids, finalization: finalizations[0] }
}

export const forkDetailData = async (sql: SQL, query: { readonly chainId: number; readonly identity: string; readonly page: PageBoundary }) => {
	const { chainId, identity, page } = query
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM fork_migration_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.canonical
			AND (event.universe_identity = ${identity} OR event.event_data->>'universeId' = ${identity}
				OR event.event_data->>'childUniverseId' = ${identity}
				OR EXISTS (SELECT 1 FROM pools pool WHERE pool.chain_id = event.chain_id AND pool.canonical
					AND pool.universe_id::text = ${identity}
					AND (event.universe_identity = pool.pool_address OR event.event_data->>'parent' = pool.pool_address
						OR event.event_data->>'parentPool' = pool.pool_address OR event.event_data->>'securityPool' = pool.pool_address)))
			AND (event.block_number, event.log_index, event.tx_hash) < (${page.block}::bigint, ${page.log}::integer, ${page.tx})
		ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.limit}
	`
	const branches = await sql`
		SELECT event_data->>'childUniverseId' AS child_universe_id,
			max(event_data->>'outcomeIndex') AS outcome_index,
			COALESCE(sum((event_data->>'amountAttoRep')::numeric) FILTER (WHERE event_name = 'MigrationRepSplit'), 0)::text AS migrated_atto_rep,
			count(DISTINCT event_data->>'migrator') FILTER (WHERE event_data ? 'migrator')::integer AS migrator_count,
			count(*) FILTER (WHERE event_name = 'MigrationRepSplit')::integer AS migration_count
		FROM fork_migration_events WHERE chain_id = ${chainId} AND canonical
			AND (universe_identity = ${identity} OR event_data->>'universeId' = ${identity})
			AND event_data ? 'childUniverseId'
		GROUP BY event_data->>'childUniverseId' ORDER BY event_data->>'childUniverseId'
	`
	const summaryRows = await sql`
		SELECT
			COALESCE(sum((event.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE event.event_name = 'MigrationRepSplit' AND event.event_data ? 'amountAttoRep'), 0)::text AS migrated_atto_rep,
			COALESCE(sum((event.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE event.event_name = 'RepBurned' AND event.event_data ? 'amountAttoRep'), 0)::text AS burned_atto_rep,
			count(DISTINCT event.event_data->>'migrator') FILTER (WHERE event.event_data ? 'migrator')::integer AS migrator_count,
			count(DISTINCT event.event_data->>'childUniverseId') FILTER (WHERE event.event_data ? 'childUniverseId')::integer AS child_count,
			count(*) FILTER (WHERE event.event_name IN ('SecurityPoolForkSnapshot', 'ChildPoolLinked', 'PoolHeldRepSweptToChild', 'VaultMigrationCheckpoint'))::integer AS pool_migration_events,
			count(*) FILTER (WHERE event.event_name = 'EscalationMigrationEntitlementInitialized')::integer AS obligations_initialized,
			count(*) FILTER (WHERE event.event_name = 'EscalationMigrationEntitlementMaterialized')::integer AS obligations_materialized
		FROM fork_migration_events event
		WHERE event.chain_id = ${chainId} AND event.canonical AND (
			event.universe_identity = ${identity} OR event.event_data->>'universeId' = ${identity}
			OR EXISTS (SELECT 1 FROM pools pool WHERE pool.chain_id = event.chain_id AND pool.canonical
				AND pool.universe_id::text = ${identity}
				AND (event.universe_identity = pool.pool_address OR event.event_data->>'parent' = pool.pool_address
					OR event.event_data->>'parentPool' = pool.pool_address OR event.event_data->>'securityPool' = pool.pool_address))
		)
	`
	return { rows, branches, summary: summaryRows[0] }
}
