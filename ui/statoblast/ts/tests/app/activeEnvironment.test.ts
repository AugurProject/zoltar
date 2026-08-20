import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { statoblastActiveEnvironmentDependencies } from '../../app/activeEnvironment.js'

test('Statoblast environment initialization always selects the Statoblast worker', async () => {
	expect(statoblastActiveEnvironmentDependencies).toEqual({ appId: 'statoblast' })

	for (const relativePath of ['../../app/App.tsx', '../../index.ts']) {
		const source = await readFile(join(import.meta.dir, relativePath), 'utf8')
		expect(source).toContain('initializeStatoblastActiveEnvironment')
		expect(source).not.toContain('initializeActiveEnvironment(')
	}
})
