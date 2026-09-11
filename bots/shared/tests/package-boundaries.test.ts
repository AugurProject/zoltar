import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Bot tsconfigs map @zoltar packages straight at workspace sources, so typecheck and local Bun accept any
// subpath. Container images resolve through the package exports maps instead, so every imported subpath must
// be one the package publishes.
const botDirectories = ['chaos', 'liquidator', 'open-oracle-arbitrager'].map(name => join(import.meta.dir, '..', '..', name))

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readManifest(path: string) {
	const manifest: unknown = JSON.parse(await readFile(path, 'utf8'))
	if (!isRecord(manifest)) throw new Error(`${path} must contain a package manifest object`)
	return manifest
}

async function zoltarPackageExports(botDirectory: string) {
	const manifest = await readManifest(join(botDirectory, 'package.json'))
	const exportsByPackage = new Map<string, Set<string>>()
	for (const field of ['dependencies', 'devDependencies']) {
		const dependencies = manifest[field]
		if (!isRecord(dependencies)) continue
		for (const [name, specifier] of Object.entries(dependencies)) {
			if (!name.startsWith('@zoltar/') || typeof specifier !== 'string' || !specifier.startsWith('file:')) continue
			const dependencyManifest = await readManifest(join(botDirectory, specifier.slice('file:'.length), 'package.json'))
			if (!isRecord(dependencyManifest['exports'])) throw new Error(`${name} package exports must be an object`)
			exportsByPackage.set(name, new Set(Object.keys(dependencyManifest['exports'])))
		}
	}
	return exportsByPackage
}

async function importedZoltarSubpaths(botDirectory: string) {
	const sourceGlob = new Bun.Glob('**/*.{ts,mts}')
	const imports = new Map<string, Set<string>>()
	for (const sourceDirectory of ['src', 'tests', 'scripts']) {
		for await (const file of sourceGlob.scan({ cwd: join(botDirectory, sourceDirectory), onlyFiles: true })) {
			const source = await readFile(join(botDirectory, sourceDirectory, file), 'utf8')
			for (const match of source.matchAll(/['"](@zoltar\/[^/'"]+)(\/[^'"]+)['"]/g)) {
				const [, packageName, subpath] = match
				if (packageName === undefined || subpath === undefined) throw new Error('Zoltar package import capture unexpectedly failed')
				const subpaths = imports.get(packageName) ?? new Set<string>()
				subpaths.add(`.${subpath}`)
				imports.set(packageName, subpaths)
			}
		}
	}
	return imports
}

describe('bot package boundaries', () => {
	for (const botDirectory of botDirectories) {
		test(`${botDirectory.split('/').at(-1) ?? botDirectory} imports only published @zoltar package subpaths`, async () => {
			const exportsByPackage = await zoltarPackageExports(botDirectory)
			const imports = await importedZoltarSubpaths(botDirectory)
			expect(imports.size).toBeGreaterThan(0)
			const violations: string[] = []
			for (const [packageName, subpaths] of imports) {
				const published = exportsByPackage.get(packageName)
				if (published === undefined) {
					violations.push(`${packageName} is imported but not declared as a file: dependency`)
					continue
				}
				for (const subpath of subpaths) if (!published.has(subpath)) violations.push(`${packageName}${subpath.slice(1)}`)
			}
			expect(violations.sort()).toEqual([])
		})
	}
})
