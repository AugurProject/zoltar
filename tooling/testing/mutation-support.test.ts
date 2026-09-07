import { describe, expect, test } from 'bun:test'
import { applyExactMutation, classifyMutantResult } from './mutation-support.mts'

describe('mutation smoke support', () => {
	test('replaces exactly one intended source fragment', () => {
		expect(applyExactMutation('before target after', { from: 'target', name: 'fixture', to: 'mutant' })).toBe('before mutant after')
	})

	test('rejects stale and ambiguous mutation definitions', () => {
		expect(() => applyExactMutation('unchanged', { from: 'missing', name: 'stale', to: 'mutant' })).toThrow('did not match')
		expect(() => applyExactMutation('target target', { from: 'target', name: 'ambiguous', to: 'mutant' })).toThrow('more than once')
	})

	test('counts only assertion failures as killed mutants', () => {
		expect(classifyMutantResult(0, '<testsuite><testcase /></testsuite>')).toBe('survived')
		expect(classifyMutantResult(1, '<testsuite><testcase><failure /></testcase></testsuite>')).toBe('killed')
		expect(() => classifyMutantResult(1, '<testsuite><testcase /></testsuite>')).toThrow('without a recorded test assertion failure')
		expect(() => classifyMutantResult(1, '')).toThrow('without a recorded test assertion failure')
	})
})
