import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const botDirectory = join(import.meta.dir, '..')
const sharedPackage = join(botDirectory, '..', 'shared', 'package.json')

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function sharedExportSubpaths() {
	const manifest: unknown = JSON.parse(await readFile(sharedPackage, 'utf8'))
	if (!isRecord(manifest) || !isRecord(manifest['exports'])) throw new Error('Bot-shared package exports must be an object')
	return new Set(Object.keys(manifest['exports']))
}

async function importedSharedSubpaths() {
	const sourceGlob = new Bun.Glob('**/*.{ts,mts}')
	const imports = new Set<string>()
	for (const sourceDirectory of ['src', 'tests', 'scripts']) {
		for await (const file of sourceGlob.scan({ cwd: join(botDirectory, sourceDirectory), onlyFiles: true })) {
			const source = await readFile(join(botDirectory, sourceDirectory, file), 'utf8')
			for (const match of source.matchAll(/['"](@zoltar\/bot-shared\/[^'"]+)['"]/g)) {
				const specifier = match[1]
				if (specifier === undefined) throw new Error('Bot-shared import capture unexpectedly failed')
				imports.add(`.${specifier.slice('@zoltar/bot-shared'.length)}`)
			}
		}
	}
	return imports
}

describe('chaos package boundary', () => {
	test('imports only public bot-shared package subpaths', async () => {
		const exports = await sharedExportSubpaths()
		const imports = await importedSharedSubpaths()
		expect(imports.size).toBeGreaterThan(0)
		expect([...imports].filter(specifier => !exports.has(specifier)).sort()).toEqual([])
	})
})
