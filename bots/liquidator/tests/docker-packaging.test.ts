import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const dockerfile = join(import.meta.dir, '..', 'Dockerfile')

test('installs production dependencies where shared bot sources can resolve them', async () => {
	const source = await readFile(dockerfile, 'utf8')
	expect(source).toContain('cd bots/shared \\\n\t&& bun install --frozen-lockfile --production')
})
