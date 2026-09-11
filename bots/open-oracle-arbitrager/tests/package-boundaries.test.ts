import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { unpublishedZoltarImports } from '../../shared/tests/support/package-boundaries.ts'

test('imports only published @zoltar package subpaths that production installs provide', async () => {
	expect(await unpublishedZoltarImports(join(import.meta.dir, '..'))).toEqual([])
})
