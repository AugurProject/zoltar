import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { handleApi } from '../../src/api.ts'
import { storeLogProjections } from '../../src/database-projections.ts'
import { getAddress, type Hex } from '../../src/ethereum.ts'
import { feeEconomicsRows, questionFeeStreamRows } from '../../src/repositories/fee-economics.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { StoredLog } from '../../src/types.ts'

const url = process.env['POSTGRES_TEST_URL']
const chainId = 1
const zeroHash = `0x${'0'.repeat(64)}`
const blockHash = (number: number): Hex => `0x${number.toString(16).padStart(64, '0')}`
const address = (digit: string) => getAddress(`0x${digit.repeat(40)}`)
const lower = (value: string) => value.toLowerCase()
const ledger = address('1')
const childLedger = address('2')
const portfolio = address('3')
const book = address('4')
const services = address('5')
const owner = address('a')
const usdc = { address: lower(address('9')), symbol: 'USDC', decimals: 6 }

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

const fees = (bookId: string) => ({ annualFeeBps: '200', purchaseFeeBps: '30', settlementBook: lower(book), bookId, services: lower(services), vestingOutstandingAttoEth: '700', deferredAttoEth: '3' })

test.skipIf(url === undefined)('fee economics sum each universe own book, purchases, claims and burns', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['blocks', 'contracts', 'protocol_timeline_entries', 'entity_state_snapshots', 'questions', 'networks']) await connection.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`)
		for (const number of [1, 2, 3]) await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, canonical, timestamp) VALUES (${chainId}, ${number}, ${blockHash(number)}, ${zeroHash}, true, ${new Date(Date.UTC(2026, 0, number))})`
		await connection`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash) VALUES (${chainId}, 'test', 'Test', '', 0, 3, ${blockHash(3)})`
		for (const contract of [ledger, childLedger]) await connection`INSERT INTO contracts (chain_id, address, label, kind, provenance, canonical) VALUES (${chainId}, ${lower(contract)}, 'ledger', 'securityPoolCapitalLedger', 'test', true)`
		await connection`INSERT INTO questions (chain_id, block_hash, tx_hash, log_index, block_number, question_id, created_timestamp, title, description, start_time, end_time, num_ticks, display_value_min, display_value_max, answer_unit, outcome_options, canonical)
			VALUES (${chainId}, ${blockHash(1)}, ${blockHash(1_001)}, 90, 1, 42, now(), 'Will it rain?', '', 0, 0, 0, 0, 0, '', '[]'::jsonb, true)`
		const snapshot = async (identity: string, blockNumber: number, readResult: Record<string, unknown>) =>
			await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp, source_method, read_status, read_result, canonical)
				VALUES (${chainId}, 'capital-ledger', ${identity}, ${blockNumber}, ${blockHash(blockNumber)}, now(), 'augurscan.capital-ledger-state.v1', 'success', ${JSON.stringify(readResult)}::text::jsonb, true)`
		// Both universes share one portfolio, one settlement book contract and one services contract; each owns a numbered book.
		await snapshot(lower(ledger), 1, { portfolio: lower(portfolio), universeId: '0', collateral: usdc, fees: fees('1') })
		await snapshot(lower(ledger), 3, { portfolio: lower(portfolio), universeId: '0', collateral: usdc, fees: fees('1') })
		await snapshot(lower(childLedger), 3, { portfolio: lower(portfolio), universeId: '7', collateral: usdc, feeReadError: 'execution reverted' })

		const events: readonly StoredLog[] = [
			event(1, 0, portfolio, 'CompleteSetsFunded', { universeId: '0', questionId: '42', recipient: owner, cashAttoEth: '1000', shares: '1000', purchaseFeeAttoEth: '30' }),
			event(1, 1, services, 'PremiumFunded', { universeId: '0', questionId: '42', amountAttoEth: '4', units: '4' }),
			event(1, 2, book, 'FeeStreamReplaced', { bookId: '1', questionId: '42', rateAttoEthPerSecond: '2', end: '1800000000' }),
			event(2, 0, book, 'AggregateFeesAccrued', { bookId: '1', portfolioTimestamp: '100', cashAttoEth: '11' }),
			event(2, 1, book, 'AggregateFeesAccrued', { bookId: '1', portfolioTimestamp: '200', cashAttoEth: '9' }),
			event(2, 2, ledger, 'EarningsClaimed', { owner, ethAmount: '15', repAmount: '2' }),
			event(2, 3, ledger, 'UnassignedFeesBurned', { ethAmount: '1', repAmount: '0' }),
			// The child universe's own purchase, book and ledger events must not be added to the origin universe.
			event(2, 4, portfolio, 'CompleteSetsFunded', { universeId: '7', questionId: '42', recipient: owner, cashAttoEth: '500', shares: '500', purchaseFeeAttoEth: '99' }),
			event(2, 5, book, 'AggregateFeesAccrued', { bookId: '2', portfolioTimestamp: '200', cashAttoEth: '77' }),
			event(2, 6, childLedger, 'EarningsClaimed', { owner, ethAmount: '55', repAmount: '5' }),
			event(2, 7, services, 'PremiumFunded', { universeId: '7', questionId: '42', amountAttoEth: '8', units: '8' }),
			// A later replacement is the question's current stream; another question has ended its stream.
			event(3, 0, book, 'FeeStreamReplaced', { bookId: '1', questionId: '42', rateAttoEthPerSecond: '3', end: '1900000000' }),
			event(3, 1, book, 'FeeStreamReplaced', { bookId: '1', questionId: '43', rateAttoEthPerSecond: '0', end: '0' }),
			event(3, 2, book, 'AggregateFeesAccrued', { bookId: '1', portfolioTimestamp: '300', cashAttoEth: '5' }),
		]
		for (const item of events) await storeLogProjections(connection, chainId, item)

		const rows = await feeEconomicsRows(connection, chainId, '3')
		expect(rows).toHaveLength(2)
		expect(rows[0]).toMatchObject({
			ledger_address: lower(ledger),
			portfolio: lower(portfolio),
			universe_id: '0',
			fees: fees('1'),
			fee_read_error: null,
			collateral: usdc,
			accrued_atto_eth: '25',
			accrual_count: 3,
			purchase_fees_atto_eth: '30',
			purchase_cash_atto_eth: '1000',
			purchase_count: 1,
			premium_funded_atto_eth: '4',
			claimed_atto_eth: '15',
			claimed_atto_rep: '2',
			claim_count: 1,
			burned_atto_eth: '1',
			burned_atto_rep: '0',
			burn_count: 1,
		})
		// No read has ever carried the child's book or services contract, so its accrual and premium have no source and are
		// left out, not reported as zero; ledger and portfolio events still count.
		expect(rows[1]).toMatchObject({ ledger_address: lower(childLedger), universe_id: '7', fees: null, fee_read_error: 'execution reverted', accrued_atto_eth: null, accrual_count: null, premium_funded_atto_eth: null, purchase_fees_atto_eth: '99', claimed_atto_eth: '55', claimed_atto_rep: '5', burn_count: 0 })
		// At block 2 the third accrual has not happened.
		expect((await feeEconomicsRows(connection, chainId, '2'))[0]).toMatchObject({ accrued_atto_eth: '20', accrual_count: 2 })
		expect(await feeEconomicsRows(connection, chainId, '0')).toEqual([])

		const streams = await questionFeeStreamRows(connection, chainId, '3', 10)
		expect(streams.map((row: Record<string, unknown>) => [row['question_id'], row['rate_atto_eth_per_second'], row['end_timestamp'], row['question_title'], row['universe_id']])).toEqual([
			['43', '0', '0', null, '0'],
			['42', '3', '1900000000', 'Will it rain?', '0'],
		])
		expect((await questionFeeStreamRows(connection, chainId, '2', 10)).map((row: Record<string, unknown>) => [row['question_id'], row['rate_atto_eth_per_second']])).toEqual([['42', '2']])

		const api = async (path: string) => {
			const response = await handleApi(new Request(`http://localhost${path}`), connection)
			if (response === undefined) throw new Error(`${path} did not return a response`)
			return response
		}
		const body = (await (await api(`/api/v1/state/fees?chainId=${chainId}&limit=1`)).json()) as { data: { universes: Record<string, unknown>[]; questionStreams: { items: Record<string, unknown>[]; truncated: boolean } } }
		// The purchase fee funds the resolution premium first; the rest funds the underwriters' vesting stream.
		expect(body.data.universes[0]).toMatchObject({ universe_id: '0', purchase_fees_atto_eth: '30', premium_funded_atto_eth: '4', earnings_funded_atto_eth: '26', accrued_atto_eth: '25' })
		expect(body.data.universes[1]).toMatchObject({ universe_id: '7', fee_read_error: 'execution reverted' })
		expect(body.data.universes[1]).not.toHaveProperty('fees')
		// The owners' share of the purchase fee is not derived from an unknown premium.
		expect(body.data.universes[1]).not.toHaveProperty('earnings_funded_atto_eth')
		expect(body.data.universes[1]?.['premium_funded_atto_eth']).toBeNull()
		expect(body.data.questionStreams).toMatchObject({ truncated: true, items: [{ question_id: '43', rate_atto_eth_per_year: '0' }] })
		const full = (await (await api(`/api/v1/state/fees?chainId=${chainId}`)).json()) as typeof body
		// 3 base units per second over a 365-day year.
		expect(full.data.questionStreams.items[1]).toMatchObject({ question_id: '42', rate_atto_eth_per_year: '94608000', block_number: '3' })
		expect(((await (await api(`/api/v1/state/fees?chainId=${chainId}&atBlock=2`)).json()) as typeof body).data.universes[0]).toMatchObject({ accrued_atto_eth: '20' })
		// The origin's latest fee read fails. Its book and services contract are known from the earlier read, so its totals stand.
		await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, canonical, timestamp) VALUES (${chainId}, 4, ${blockHash(4)}, ${zeroHash}, true, now())`
		await snapshot(lower(ledger), 4, { portfolio: lower(portfolio), universeId: '0', collateral: usdc, feeReadError: 'fee streams unavailable' })
		expect((await feeEconomicsRows(connection, chainId, '4'))[0]).toMatchObject({ fees: null, fee_read_error: 'fee streams unavailable', accrued_atto_eth: '25', premium_funded_atto_eth: '4', purchase_fees_atto_eth: '30' })
		expect(await questionFeeStreamRows(connection, chainId, '4', 10)).toHaveLength(2)
		// A question created after the snapshot block lends no title to an earlier snapshot.
		expect((await questionFeeStreamRows(connection, chainId, '3', 10))[1]).toMatchObject({ question_title: 'Will it rain?' })
		await connection`UPDATE questions SET block_number = 3 WHERE chain_id = ${chainId}`
		expect((await questionFeeStreamRows(connection, chainId, '2', 10))[0]).toMatchObject({ question_id: '42', question_title: null })

		type RiskFees = { feeEconomics: Record<string, unknown>[]; questionFeeStreams: Record<string, unknown>[] }
		const overview = (await (await api(`/api/v1/operations?chainId=${chainId}`)).json()) as { data: { feeEconomics: Record<string, unknown>[]; risk: RiskFees } }
		expect(overview.data.feeEconomics[0]).toMatchObject({ universe_id: '0', accrued_atto_eth: '25', earnings_funded_atto_eth: '26' })
		// The Risk section reads both collections from the `risk` object of the overview and of the risk catalog.
		const riskCatalog = (await (await api(`/api/v1/state/risk?chainId=${chainId}`)).json()) as { data: RiskFees }
		for (const risk of [overview.data.risk, riskCatalog.data]) {
			expect(risk.feeEconomics[0]).toMatchObject({ universe_id: '0', accrued_atto_eth: '25' })
			expect(risk.questionFeeStreams.map(stream => [stream['question_id'], stream['rate_atto_eth_per_year']])).toEqual([
				['43', '0'],
				['42', '94608000'],
			])
		}
		expect((await api('/api/v1/state/fees')).status).toBe(400)
	} finally {
		connection.release()
		await sql.close()
	}
})
