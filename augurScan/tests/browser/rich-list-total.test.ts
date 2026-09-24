import { expect, test } from 'bun:test'
import { richListLargestRep } from '../../browser/rich-list-rep.ts'

test('shows the largest individual REP holding when token rows are capped', () => {
	const item = {
		largest_rep_token_address: '0x1234567890123456789012345678901234567890',
		largest_rep_balance: '101000000000000000001',
		largest_rep_decimals: 18,
		largest_rep_symbol: 'REP',
		rep_balances: Array.from({ length: 100 }, () => ({ balance: '1000000000000000000' })),
	}
	expect(richListLargestRep(item)).toBe('101.000000000000000001 REP · 0x1234…7890')
})
