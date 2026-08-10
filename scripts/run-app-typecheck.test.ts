import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { applicationTypeScriptCommand } from './run-app-typecheck.mts'

test('passes the heap limit directly to Node instead of relying on bun x environment forwarding', () => {
	expect(applicationTypeScriptCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc')).toEqual(['C:\\Program Files\\nodejs\\node.exe', '--max-old-space-size=6144', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--noEmit'])
})

test('routes the application TypeScript command through the heap-aware launcher', async () => {
	const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> }
	expect(packageJson.scripts?.['tsc:app']).toBe('bun ./scripts/run-app-typecheck.mts')
})
