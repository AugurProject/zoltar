import { expect, test } from 'bun:test'
import { applyModel, newModel, WAD, MAX_UINT } from './auditCapitalLedgerModel'

test('#1630 an observed takeover remains executable after the price expires', () => {
	const m = newModel(1n, 0n, 1000n * WAD, 11000000n * WAD)
	applyModel(m, { c: 'price', price: WAD, until: 100n })
	applyModel(m, { c: 'deposit', o: 1, amount: 100n * WAD })
	applyModel(m, { c: 'deposit', o: 0, amount: 20n * WAD })
	applyModel(m, { c: 'commit', o: 0, value: 10n * WAD })
	applyModel(m, { c: 'demand', value: 10n * WAD })
	m.now = 2n
	applyModel(m, { c: 'price', price: 2n * WAD, until: 10n })
	m.now = 4000n
	const result = applyModel(m, { c: 'takeover', o: 1, id: 1n, k: 10n * WAD, minimumTakeoverReward: 0n, maxOwn: MAX_UINT, bounds: undefined })
	expect(result).toBeDefined()
	expect(result?.takeoverReward).toBeGreaterThan(0n)
})
test('#1630 stale price cannot bypass the adverse observation requirement', () => {
	const m = newModel(4000n, 0n, 1000n * WAD, 11000000n * WAD)
	expect(() => applyModel(m, { c: 'takeover', o: 1, id: 1n, k: WAD, minimumTakeoverReward: 0n, maxOwn: MAX_UINT, bounds: undefined })).toThrow('Adverse observation missing')
})
