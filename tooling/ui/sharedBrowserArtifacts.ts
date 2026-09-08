import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { appSharedPackages, sharedPackageClosure, sharedPackages } from '../repo/sharedPackages.ts'

function packageBrowserImports(entry: (typeof sharedPackages)[number]) {
	const manifest: unknown = JSON.parse(readFileSync(fileURLToPath(new URL(`../../${entry.path}/package.json`, import.meta.url)), 'utf8'))
	if (typeof manifest !== 'object' || manifest === null || !('exports' in manifest) || typeof manifest.exports !== 'object' || manifest.exports === null) throw new Error(`Missing exports for ${entry.name}`)
	return Object.fromEntries(
		Object.entries(manifest.exports).flatMap(([subpath, value]) => {
			if (subpath.startsWith('./testing/')) return []
			if (typeof value !== 'object' || value === null || !('default' in value) || typeof value.default !== 'string') throw new Error(`Missing browser export for ${entry.name}/${subpath}`)
			return [[`${entry.name}/${subpath.slice(2)}`, `../${entry.path}/${value.default.replace(/^\.\//, '')}`]]
		}),
	)
}

export function getSharedBrowserImports(app: keyof typeof appSharedPackages) {
	const imports: Record<string, string> = {}
	for (const entry of sharedPackageClosure(appSharedPackages[app])) Object.assign(imports, packageBrowserImports(entry))
	return imports
}

export const sharedBrowserArtifactRelativePaths = sharedPackages.flatMap(entry => Object.values(packageBrowserImports(entry)).map(value => value.slice(3)))
