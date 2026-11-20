import { expect, test } from 'bun:test'
import type { RichListRecord } from '../../browser/browser-types.ts'
import { dataTableCsv } from '../../browser/data-table.ts'
import { richListLargestRep } from '../../browser/rich-list-rep.ts'
import { richListCsvColumns, richListWalletBalances } from '../../browser/rich-list-table.ts'
import { tokenDecimals } from '../../browser/format.ts'
import { addressTokenBalances } from '../../browser/address-profile-page.ts'
import { richListContinuationAvailable } from '../../src/rich-list-limits.ts'

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
		rep_balances: [],
		weth_balances: [],
		native_balance_detail: null,
		pool_associations: [],
	}
	const item: RichListRecord = {
		...base,
		address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
		label: 'Deployer, "main"',
		largest_rep_token_address: '0x1234567890123456789012345678901234567890',
		largest_rep_balance: '1234500000000000000000',
		largest_rep_symbol: 'REP',
		native_balance: '1000000000000000000001',
		sampled_native_count: '1',
		transaction_count: '1234',
	}
	// The API reports unsampled balances as zero; the export leaves an unsampled native balance empty and states WETH coverage.
	const unlabeled: RichListRecord = { ...base, native_balance: '0', weth_balance: '5', sampled_native_count: '0', sampled_weth_token_count: '1', weth_token_count: '2' }
	expect(dataTableCsv(richListCsvColumns('11155111'), [item, unlabeled]).split('\r\n')).toEqual([
		'"Address","Label","Largest REP holding","Largest REP token symbol","Largest REP token address","SepoliaETH balance","WETH balance","WETH tokens sampled","Transactions"',
		'"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","Deployer, ""main""","1234.5","REP","0x1234567890123456789012345678901234567890","1000.000000000000000001","","0 of 0","1234"',
		'"0x1111111111111111111111111111111111111111","","","","","","0.000000000000000005","1 of 2","7"',
	])
})

test('the rich list table shows unsampled balances as pending or partial, like the cards', () => {
	const unsampled = { native_balance: '0', weth_balance: '0', sampled_native_count: '0', sampled_weth_token_count: '0', weth_token_count: '1' }
	expect(richListWalletBalances(unsampled, 'SepoliaETH')).toEqual({ native: 'SepoliaETH pending', weth: '0 WETH · partial' })
	expect(richListWalletBalances({ ...unsampled, native_balance: '1500000000000000000', sampled_native_count: '1', weth_balance: '2', sampled_weth_token_count: '1' }, 'SepoliaETH')).toEqual({
		native: '1.5 SepoliaETH',
		weth: '0.000000000000000002 WETH',
	})
})

test('missing token metadata keeps the 18 decimals the SQL ranking assumes', () => {
	expect(tokenDecimals(null)).toBe(18)
	expect(tokenDecimals(undefined)).toBe(18)
	expect(tokenDecimals(6)).toBe(6)
	expect(tokenDecimals(0)).toBe(0)
	expect(tokenDecimals(256)).toBe(18)
})

test('the address profile labels WETH and REP balances apart when token metadata is missing', () => {
	const token = { address: `0x${'2'.repeat(40)}`, balance: '1000000000000000000', symbol: null, decimals: null, blockNumber: '7' }
	expect(addressTokenBalances({ weth_balances: [token], rep_balances: [{ ...token, address: `0x${'3'.repeat(40)}` }] }).map(balance => balance.amount)).toEqual(['1 WETH', '1 REP'])
})

test('rich list pagination stops where the API offset ceiling ends', () => {
	expect(richListContinuationAvailable(100_000, 100_051)).toBe(true)
	expect(richListContinuationAvailable(100_050, 100_051)).toBe(false)
	expect(richListContinuationAvailable(50, 50)).toBe(false)
})
