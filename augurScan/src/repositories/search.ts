import type { SQL } from 'bun'
import { blockTransactionLimit, boundBlockTransactions } from './block-transaction-limit.ts'
import { literalContainsPattern } from './like-pattern.ts'

const addressPattern = /^0x[0-9a-f]{40}$/i
const hashPattern = /^0x[0-9a-f]{64}$/i

type SearchItem = { type: string; label: string; href: string; detail?: string }

export const searchNetworkIds = async (sql: SQL): Promise<number[]> => {
	const rows = await sql`SELECT chain_id FROM networks ORDER BY chain_id`
	return rows.map((row: Record<string, unknown>) => Number(row['chain_id']))
}

export const searchItems = async (sql: SQL, chainId: number, query: string, limit: number): Promise<SearchItem[]> => {
	const lower = query.toLowerCase()
	const items: SearchItem[] = []
	if (addressPattern.test(lower)) {
		items.push({ type: 'address', label: lower, href: `/address/${lower}?chainId=${chainId}` })
		const pools = await sql`SELECT p.pool_address, q.title FROM pools p LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical WHERE p.chain_id = ${chainId} AND p.pool_address = ${lower} AND p.canonical LIMIT 1`
		for (const pool of pools) items.unshift({ type: 'pool', label: String(pool['title'] ?? pool['pool_address']), href: `/pool/${lower}?chainId=${chainId}`, detail: lower })
	}
	if (hashPattern.test(lower)) {
		const transactions = await sql`SELECT hash FROM transactions WHERE chain_id = ${chainId} AND hash = ${lower} AND canonical LIMIT 1`
		for (const transaction of transactions) items.push({ type: 'transaction', label: String(transaction['hash']), href: `/tx/${lower}?chainId=${chainId}` })
		const blocks = await sql`SELECT number::text, hash FROM blocks WHERE chain_id = ${chainId} AND hash = ${lower} AND canonical LIMIT 1`
		for (const block of blocks) items.push({ type: 'block', label: `Block #${block['number']}`, href: `/block/${block['number']}?chainId=${chainId}`, detail: lower })
	}
	if (/^\d{1,19}$/.test(query) && BigInt(query) <= 9_223_372_036_854_775_807n) {
		const blocks = await sql`SELECT number::text, hash FROM blocks WHERE chain_id = ${chainId} AND number = ${query}::bigint AND canonical LIMIT 1`
		for (const block of blocks) items.push({ type: 'block', label: `Block #${block['number']}`, href: `/block/${block['number']}?chainId=${chainId}`, detail: String(block['hash']) })
	}
	if (/^\d{1,78}$/.test(query)) {
		const questions = await sql`SELECT question_id::text, title FROM questions WHERE chain_id = ${chainId} AND question_id = ${query}::numeric AND canonical LIMIT 1`
		for (const question of questions) items.push({ type: 'question', label: String(question['title']), href: `/question/${question['question_id']}?chainId=${chainId}`, detail: `Question #${query}` })
		const reports = await sql`SELECT DISTINCT open_oracle_address, report_id::text FROM open_oracle_report_events WHERE chain_id = ${chainId} AND report_id = ${query}::numeric AND canonical LIMIT ${limit}`
		for (const report of reports) items.push({ type: 'report', label: `Report #${report['report_id']}`, href: `/report/${report['open_oracle_address']}/${report['report_id']}?chainId=${chainId}`, detail: String(report['open_oracle_address']) })
	}
	if (query.length >= 2 && !hashPattern.test(query)) {
		const pattern = literalContainsPattern(query)
		const questions = await sql`SELECT question_id::text, title FROM questions WHERE chain_id = ${chainId} AND title ILIKE ${pattern} AND canonical ORDER BY created_timestamp DESC LIMIT ${limit}`
		for (const question of questions) items.push({ type: 'question', label: String(question['title']), href: `/question/${question['question_id']}?chainId=${chainId}` })
	}
	return items.slice(0, limit)
}

export const transactionEvidence = async (sql: SQL, chainId: number, hash: string) => {
	const transactions =
		await sql`SELECT t.*, b.timestamp AS block_timestamp, n.explorer_base_url, a.function_name, a.summary AS action_summary, a.display_arguments AS action_display_arguments FROM transactions t JOIN blocks b ON b.chain_id = t.chain_id AND b.hash = t.block_hash JOIN networks n ON n.chain_id = t.chain_id LEFT JOIN actions a ON a.chain_id = t.chain_id AND a.block_hash = t.block_hash AND a.tx_hash = t.hash WHERE t.chain_id = ${chainId} AND t.hash = ${hash} AND t.canonical ORDER BY t.block_number DESC LIMIT 1`
	const transaction = transactions[0]
	if (transaction === undefined) return undefined
	const logs = await sql`SELECT log_index, event_name, summary, emitter_address, decode_status, block_hash, tx_hash FROM logs WHERE chain_id = ${chainId} AND tx_hash = ${hash} AND block_hash = ${transaction['block_hash']} AND canonical ORDER BY log_index`
	return { transaction, logs }
}

export const blockEvidence = async (sql: SQL, chainId: number, number: string) => {
	const blocks = await sql`SELECT b.*, n.explorer_base_url FROM blocks b JOIN networks n USING (chain_id) WHERE b.chain_id = ${chainId} AND b.number = ${number}::bigint AND b.canonical LIMIT 1`
	const block = blocks[0]
	if (block === undefined) return undefined
	const transactions =
		await sql`SELECT t.hash, t.transaction_index, t.from_address, t.to_address, t.value::text, t.status, a.function_name, a.summary AS action_summary FROM transactions t LEFT JOIN actions a ON a.chain_id = t.chain_id AND a.block_hash = t.block_hash AND a.tx_hash = t.hash WHERE t.chain_id = ${chainId} AND t.block_hash = ${block['hash']} AND t.canonical ORDER BY t.transaction_index LIMIT ${blockTransactionLimit + 1}`
	return { block, ...boundBlockTransactions(transactions) }
}
