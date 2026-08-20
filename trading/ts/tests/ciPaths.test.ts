import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('Trading CI discovers SDK and relocated UI tests without the removed monolithic path', async () => {
	const source = await readFile(join(import.meta.dir, '..', '..', 'ci', 'run.mts'), 'utf8')

	expect(source).toContain("['bun', 'test', '--isolate', './ts/tests', '../ui/trading/ts/tests']")
	expect(source).not.toContain("'./ui/ts/tests'")
	expect(source).toContain("{ command: ['bun', 'run', 'trading:ui:build'], cwd: repositoryRoot }")
	expect(source).not.toContain("['bun', 'run', 'ui:build']")
})
