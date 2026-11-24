import type { SQL } from 'bun'
import { latestLedgerAttempt, latestLedgers } from './capital.ts'

// Fees are accounted per security pool universe. Configuration and balances come from the tagged `capital-ledger`
// read (`fees`); totals are sums of the events the settlement book, the security pool, its services and the capital
// ledger emit. The book, security pool, services and ledger lookups seek the timeline's entity index with an exact
// identity; earnings claims, which are keyed by ledger and owner, are grouped by ledger in one pass.

/**
 * `LEFT JOIN LATERAL` giving a ledger's settlement book, book id and services contract from its latest read that
 * carries them. They are fixed for a universe, so an earlier successful fee read still identifies them when the
 * latest one failed. Without any such read the join yields nulls and nothing is attributed by guess.
 */
const feeIdentity = (sql: SQL, chainId: number, snapshotBlock: string) => sql`
	LEFT JOIN LATERAL (
		SELECT state.read_result->'fees'->>'settlementBook' AS settlement_book, state.read_result->'fees'->>'bookId' AS book_id,
			state.read_result->'fees'->>'services' AS services
		FROM entity_state_snapshots state
		JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
		WHERE state.chain_id = ${chainId} AND state.entity_type = 'capital-ledger' AND state.entity_identity = ledger.ledger_address
			AND state.canonical AND state.read_status = 'success' AND state.block_number <= ${snapshotBlock} AND state.read_result ? 'fees'
		ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
	) identity ON true`

/**
 * One row per capital ledger with its latest fee read and the event totals up to the snapshot block:
 * annual fees accrued by the universe's settlement book, purchase fees and the resolution premium funded
 * from them, earnings claimed by owners, and unassigned fees burned.
 */
export const feeEconomicsRows = async (sql: SQL, chainId: number, snapshotBlock: string) =>
	await sql`
		WITH ${latestLedgers(sql, chainId, snapshotBlock)},
			-- Owner entries are keyed by ledger and owner, so claims are summed once per ledger in a single pass.
			claims AS (
				SELECT split_part(entry.entity_identity, ':', 1) AS ledger_address,
					sum((entry.summary_data->>'ethAmount')::numeric)::text AS eth, sum((entry.summary_data->>'repAmount')::numeric)::text AS rep, count(*)::integer AS events
				FROM protocol_timeline_entries entry
				WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock} AND entry.entity_type = 'vault'
					AND entry.semantic_event_kind = 'EarningsClaimed'
					AND entry.summary_data->>'ethAmount' ~ '^[0-9]+$' AND entry.summary_data->>'repAmount' ~ '^[0-9]+$'
				GROUP BY 1
			)
		SELECT ledger.ledger_address, ledger.read_result->>'securityPool' AS "securityPool", ledger.read_result->>'universeId' AS universe_id,
			-- A failed ledger read after the latest successful one is a failed fee read: its balances are not reported as current.
			CASE WHEN attempt.read_status = 'success' THEN ledger.read_result->'fees' END AS fees,
			CASE WHEN attempt.read_status = 'success' THEN ledger.read_result->>'feeReadError' ELSE COALESCE(attempt.read_failure_reason, 'Capital ledger read failed') END AS fee_read_error,
			ledger.read_result->'collateral' AS collateral,
			ledger.block_number::text AS block_number, ledger.block_hash, ledger.block_timestamp,
			attempt.read_status AS latest_read_status, attempt.block_number::text AS latest_read_block_number, attempt.read_failure_reason AS latest_read_failure_reason,
			-- Without a known book or services contract these totals have no source and are left out.
			CASE WHEN identity.settlement_book IS NULL THEN NULL ELSE accrued.total END AS accrued_atto_eth,
			CASE WHEN identity.settlement_book IS NULL THEN NULL ELSE accrued.events END AS accrual_count,
			purchases.fees AS purchase_fees_atto_eth, purchases.cash AS purchase_cash_atto_eth, purchases.events AS purchase_count,
			CASE WHEN identity.services IS NULL THEN NULL ELSE premiums.total END AS premium_funded_atto_eth,
			COALESCE(claimed.eth, '0') AS claimed_atto_eth, COALESCE(claimed.rep, '0') AS claimed_atto_rep, COALESCE(claimed.events, 0) AS claim_count,
			burned.eth AS burned_atto_eth, burned.rep AS burned_atto_rep, burned.events AS burn_count
		FROM ledgers ledger
		${latestLedgerAttempt(sql, chainId, snapshotBlock, 'ledger.ledger_address')}
		${feeIdentity(sql, chainId, snapshotBlock)}
		CROSS JOIN LATERAL (
			SELECT COALESCE(sum((entry.summary_data->>'cashAttoEth')::numeric), 0)::text AS total, count(*)::integer AS events
			FROM protocol_timeline_entries entry
			WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock} AND entry.entity_type = 'settlement-book'
				AND entry.entity_identity = identity.settlement_book || ':' || identity.book_id
				AND entry.semantic_event_kind = 'AggregateFeesAccrued' AND entry.summary_data->>'cashAttoEth' ~ '^[0-9]+$'
		) accrued
		CROSS JOIN LATERAL (
			SELECT COALESCE(sum((entry.summary_data->>'purchaseFeeAttoEth')::numeric), 0)::text AS fees,
				COALESCE(sum((entry.summary_data->>'cashAttoEth')::numeric), 0)::text AS cash, count(*)::integer AS events
			FROM protocol_timeline_entries entry
			WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock} AND entry.entity_type = 'security-pool'
				AND entry.entity_identity = ledger.read_result->>'securityPool' AND entry.semantic_event_kind = 'CompleteSetsFunded'
				AND entry.summary_data->>'universeId' = ledger.read_result->>'universeId'
				AND entry.summary_data->>'purchaseFeeAttoEth' ~ '^[0-9]+$' AND entry.summary_data->>'cashAttoEth' ~ '^[0-9]+$'
		) purchases
		CROSS JOIN LATERAL (
			SELECT COALESCE(sum((entry.summary_data->>'amountAttoEth')::numeric), 0)::text AS total
			FROM protocol_timeline_entries entry
			WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock} AND entry.entity_type = 'security-pool-services'
				AND entry.entity_identity = identity.services || ':' || (ledger.read_result->>'universeId')
				AND entry.semantic_event_kind = 'PremiumFunded' AND entry.summary_data->>'amountAttoEth' ~ '^[0-9]+$'
		) premiums
		LEFT JOIN claims claimed ON claimed.ledger_address = ledger.ledger_address
		CROSS JOIN LATERAL (
			SELECT COALESCE(sum((entry.summary_data->>'ethAmount')::numeric), 0)::text AS eth,
				COALESCE(sum((entry.summary_data->>'repAmount')::numeric), 0)::text AS rep, count(*)::integer AS events
			FROM protocol_timeline_entries entry
			WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock} AND entry.entity_type = 'security-pool'
				AND entry.entity_identity = ledger.ledger_address AND entry.semantic_event_kind = 'UnassignedFeesBurned'
				AND entry.summary_data->>'ethAmount' ~ '^[0-9]+$' AND entry.summary_data->>'repAmount' ~ '^[0-9]+$'
		) burned
		ORDER BY ledger.ledger_address LIMIT 250
	`

/**
 * The current linear fee stream of each question in each universe's book: the latest `FeeStreamReplaced`
 * per book and question, newest first. A rate of zero means the question's stream has ended or was never funded.
 */
export const questionFeeStreamRows = async (sql: SQL, chainId: number, snapshotBlock: string, limit: number) =>
	await sql`
		WITH ${latestLedgers(sql, chainId, snapshotBlock)}
		SELECT stream.*, question.title AS question_title FROM (
			SELECT DISTINCT ON (ledger.ledger_address, entry.summary_data->>'questionId')
				ledger.ledger_address, ledger.read_result->>'universeId' AS universe_id, ledger.read_result->'collateral' AS collateral,
				entry.summary_data->>'questionId' AS question_id, entry.summary_data->>'rateAttoEthPerSecond' AS rate_claim_units_per_second,
				entry.summary_data->>'end' AS end_timestamp, entry.block_number, entry.block_hash, entry.tx_hash, entry.log_index
			FROM ledgers ledger
			${feeIdentity(sql, chainId, snapshotBlock)}
			JOIN protocol_timeline_entries entry ON entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock}
				AND entry.entity_type = 'settlement-book'
				AND entry.entity_identity = identity.settlement_book || ':' || identity.book_id
				AND entry.semantic_event_kind = 'FeeStreamReplaced'
			ORDER BY ledger.ledger_address, entry.summary_data->>'questionId', entry.block_number DESC, entry.log_index DESC
		) stream
		LEFT JOIN questions question ON question.chain_id = ${chainId} AND question.canonical AND question.block_number <= ${snapshotBlock}
			AND stream.question_id ~ '^[0-9]+$' AND question.question_id = stream.question_id::numeric
		ORDER BY stream.block_number DESC, stream.log_index DESC, stream.ledger_address, stream.question_id LIMIT ${limit}
	`
