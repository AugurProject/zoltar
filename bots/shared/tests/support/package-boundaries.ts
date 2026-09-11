import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Bot tsconfigs map @zoltar packages straight at workspace sources, so typecheck and local Bun accept any subpath.
// Container images install production dependencies and resolve through the package exports maps instead, so every
// imported subpath must be one the package publishes, and src/ and scripts/ (some of which run inside the images)
// may only reach packages listed under dependencies.
type DependencyField = 'dependencies' | 'devDependencies'

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
	const exportsByPackage = new Map<string, { field: DependencyField; subpaths: Set<string> }>()
	for (const field of ['dependencies', 'devDependencies'] as const) {
		const dependencies = manifest[field]
		if (!isRecord(dependencies)) continue
		for (const [name, specifier] of Object.entries(dependencies)) {
			if (!name.startsWith('@zoltar/') || typeof specifier !== 'string' || !specifier.startsWith('file:')) continue
			if (exportsByPackage.has(name)) continue
			const dependencyManifest = await readManifest(join(botDirectory, specifier.slice('file:'.length), 'package.json'))
			if (!isRecord(dependencyManifest['exports'])) throw new Error(`${name} package exports must be an object`)
			exportsByPackage.set(name, { field, subpaths: new Set(Object.keys(dependencyManifest['exports'])) })
		}
	}
	return exportsByPackage
}

async function importedZoltarSubpaths(botDirectory: string, sourceDirectory: string) {
	const sourceGlob = new Bun.Glob('**/*.{ts,mts}')
	const imports = new Map<string, Set<string>>()
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
	return imports
}

// Lists every @zoltar import in the bot that its published package surface cannot serve.
export async function unpublishedZoltarImports(botDirectory: string) {
	const exportsByPackage = await zoltarPackageExports(botDirectory)
	const violations: string[] = []
	let importCount = 0
	for (const sourceDirectory of ['src', 'tests', 'scripts']) {
		const imports = await importedZoltarSubpaths(botDirectory, sourceDirectory)
		for (const [packageName, subpaths] of imports) {
			importCount += subpaths.size
			const published = exportsByPackage.get(packageName)
			if (published === undefined) {
				violations.push(`${sourceDirectory}: ${packageName} is imported but not declared as a file: dependency`)
				continue
			}
			if (sourceDirectory !== 'tests' && published.field !== 'dependencies') {
				violations.push(`${sourceDirectory}: ${packageName} is only a devDependency and is absent from production installs`)
				continue
			}
			for (const subpath of subpaths) if (!published.subpaths.has(subpath)) violations.push(`${sourceDirectory}: ${packageName}${subpath.slice(1)} is not a published subpath`)
		}
	}
	if (importCount === 0) throw new Error(`${botDirectory} imports no @zoltar packages; the boundary scan found nothing to check`)
	return violations.sort()
}
