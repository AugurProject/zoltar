import { expect, test } from 'bun:test'
import type { RichListRecord } from '../../browser/browser-types.ts'
import { dataTableCsv } from '../../browser/data-table.ts'
import { richListLargestRep } from '../../browser/rich-list-rep.ts'
import { richListCsvColumns } from '../../browser/rich-list-table.ts'

test('shows the largest individual REP holding when token rows are capped', () => {
	const item = {
		largest_rep_token_address: '0x1234567890123456789012345678901234567890',
		largest_rep_balance: '101000000000000000001',
		largest_rep_decimals: 18,
		largest_rep_symbol: 'REP',
		rep_balances: Array.from({ length: 100 }, () => ({ balance: '1000000000000000000' })),
	}
	expect(richListLargestRep(item)).toBe('101.000000000000000001 REP · 0x123456…567890')
})

test('the rich list CSV keeps raw addresses, labels, and plain amounts apart from their display form', () => {
	const base: RichListRecord = {
		chain_id: '11155111',
		explorer_base_url: 'https://sepolia.etherscan.io',
		address: '0x1111111111111111111111111111111111111111',
		label: null,
		kind: null,
		largest_rep_token_address: null,
		largest_rep_balance: null,
		largest_rep_decimals: 18,
		largest_rep_symbol: null,
		transaction_count: 7,
		interaction_count: '0',
		pool_count: '0',
		vault_count: '0',
		rep_balances: [],
		weth_balances: [],
		native_balance_detail: null,
		pool_associations: [],
		vault_positions: [],
	}
	const item: RichListRecord = {
		...base,
		address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
		label: 'Deployer, "main"',
		largest_rep_token_address: '0x1234567890123456789012345678901234567890',
		largest_rep_balance: '1234500000000000000000',
		largest_rep_symbol: 'REP',
		native_balance: '1000000000000000000001',
		transaction_count: '1234',
	}
	const unlabeled: RichListRecord = { ...base, weth_balance: '5' }
	expect(dataTableCsv(richListCsvColumns('11155111'), [item, unlabeled]).split('\r\n')).toEqual([
		'"Address","Label","Largest REP holding","Largest REP token symbol","Largest REP token address","SepoliaETH balance","WETH balance","Transactions"',
		'"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","Deployer, ""main""","1234.5","REP","0x1234567890123456789012345678901234567890","1000.000000000000000001","","1234"',
		'"0x1111111111111111111111111111111111111111","","","","","","0.000000000000000005","7"',
	])
})
