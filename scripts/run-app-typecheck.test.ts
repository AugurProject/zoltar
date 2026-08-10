import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { applicationTypeScriptNodeOptions } from './run-app-typecheck.mts'

test('gives the application TypeScript compiler a cross-platform 6 GB heap', () => {
	expect(applicationTypeScriptNodeOptions(undefined)).toBe('--max-old-space-size=6144')
	expect(applicationTypeScriptNodeOptions('')).toBe('--max-old-space-size=6144')
	expect(applicationTypeScriptNodeOptions('--trace-warnings')).toBe('--trace-warnings --max-old-space-size=6144')
})

test('routes the application TypeScript command through the heap-aware launcher', async () => {
	const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> }
	expect(packageJson.scripts?.['tsc:app']).toBe('bun ./scripts/run-app-typecheck.mts')
})
