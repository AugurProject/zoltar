import { expect, test } from 'bun:test'
import { richListRepTotal } from '../../browser/rich-list-rep.ts'

test('uses the server total when the sampled REP token rows are capped', () => {
	const item = {
		rep_balance: '101000000000000000001',
		rep_balances: Array.from({ length: 100 }, () => ({ balance: '1000000000000000000' })),
	}
	expect(richListRepTotal(item)).toBe('101.000000000000000001 REP')
})
