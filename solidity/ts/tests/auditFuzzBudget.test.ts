import { afterEach, expect, test } from 'bun:test'
import { auditFuzzSeeds, positiveFuzzInteger } from './auditFuzzBudget'

const names = ['AUDIT_FUZZ_SEEDS', 'AUDIT_FUZZ_SEED_START', 'AUDIT_FUZZ_STEPS'] as const
const original = Object.fromEntries(names.map(name => [name, process.env[name]]))
afterEach(() => {
	for (const name of names) {
		const value = original[name]
		if (value === undefined) delete process.env[name]
		else process.env[name] = value
	}
})

test('#1513: empty and invalid required corpora fail instead of passing without scenarios', () => {
	for (const value of ['0', '-1', 'NaN', '1.5', '9007199254740992', '']) {
		process.env['AUDIT_FUZZ_STEPS'] = value
		expect(() => positiveFuzzInteger('AUDIT_FUZZ_STEPS', 70)).toThrow('positive safe integer')
		process.env['AUDIT_FUZZ_SEEDS'] = value
		expect(() => auditFuzzSeeds([1, 8])).toThrow('positive safe integer')
	}
})

test('#1513: extending the corpus preserves pinned regressions and exact replay is explicit', () => {
	process.env['AUDIT_FUZZ_SEEDS'] = '3'
	process.env['AUDIT_FUZZ_SEED_START'] = '37'
	expect(auditFuzzSeeds([1, 8, 37])).toEqual([1, 8, 37, 38, 39])
	process.env['AUDIT_FUZZ_SEEDS'] = '1'
	expect(auditFuzzSeeds([1, 8, 37])).toEqual([37])
})
