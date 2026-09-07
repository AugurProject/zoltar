import { describe, expect, test } from 'bun:test'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyExactMutation, classifyMutantResult, getMutationJunitTestNames, MUTATION_SMOKE_CASES } from './mutation-support.mts'

const repositoryRoot = join(import.meta.dir, '..', '..')

describe('mutation smoke support', () => {
	test('replaces exactly one intended source fragment', () => {
		expect(applyExactMutation('before target after', { from: 'target', name: 'fixture', to: 'mutant' })).toBe('before mutant after')
	})

	test('rejects stale and ambiguous mutation definitions', () => {
		expect(() => applyExactMutation('unchanged', { from: 'missing', name: 'stale', to: 'mutant' })).toThrow('did not match')
		expect(() => applyExactMutation('target target', { from: 'target', name: 'ambiguous', to: 'mutant' })).toThrow('more than once')
	})

	test('keeps every mutation source and focused test path current', async () => {
		for (const mutation of MUTATION_SMOKE_CASES) {
			const testPath = mutation.testCommand.find(argument => argument.endsWith('.test.ts'))
			expect(testPath).toBeDefined()
			if (testPath === undefined) throw new Error(`Mutation ${mutation.name} must name its focused test`)
			await Promise.all([access(join(repositoryRoot, mutation.filePath)), access(join(repositoryRoot, testPath))])
			const source = await readFile(join(repositoryRoot, mutation.filePath), 'utf8')
			expect(applyExactMutation(source, mutation)).not.toBe(source)
		}
	})

	test('counts only assertion failures as killed mutants', () => {
		expect(classifyMutantResult(0, '<testsuite><testcase /></testsuite>')).toBe('survived')
		expect(classifyMutantResult(1, '<testsuite><testcase><failure /></testcase></testsuite>')).toBe('killed')
		expect(() => classifyMutantResult(1, '<testsuite><testcase /></testsuite>')).toThrow('without a recorded test assertion failure')
		expect(() => classifyMutantResult(1, '')).toThrow('Malformed JUnit')
		expect(() => classifyMutantResult(1, '<testsuite><testcase name="other"><failure /></testcase></testsuite>', { expectedTestNames: ['expected'], mutatedModuleLoaded: true })).toThrow('expected test identities')
		expect(() => classifyMutantResult(1, '<testsuite><testcase name="expected"><failure /></testcase></testsuite>', { expectedTestNames: ['expected'], mutatedModuleLoaded: false })).toThrow('mutated module')
		expect(() => classifyMutantResult(1, '<testsuite><testcase name="expected"><error /></testcase></testsuite>', { expectedTestNames: ['expected'], mutatedModuleLoaded: true })).toThrow('infrastructure')
		expect(() => classifyMutantResult(1, '<testsuite><testcase><failure /></testcase></testsuite><testcase')).toThrow('Malformed JUnit')
		expect(() => classifyMutantResult(1, '<testsuites><testsuite><testcase><failure /></testcase></testsuites></testsuite>')).toThrow('mismatched')
	})

	test('accepts greater-than characters in mutation testcase names', () => {
		const junit = '<testsuite><testcase name="compares 2 > 1"><failure /></testcase></testsuite>'
		expect(getMutationJunitTestNames(junit)).toEqual(['compares 2 > 1'])
		expect(classifyMutantResult(1, junit, { expectedTestNames: ['compares 2 > 1'], mutatedModuleLoaded: true })).toBe('killed')
	})

	test('reads mutation error counts only from structured suite attributes', () => {
		expect(classifyMutantResult(1, '<testsuite errors="0"><testcase><![CDATA[errors="1"]]><failure /></testcase><!-- errors="1" --></testsuite>')).toBe('killed')
		expect(() => classifyMutantResult(1, "<testsuite errors='01'><testcase><failure /></testcase></testsuite>")).toThrow('infrastructure')
	})
})
