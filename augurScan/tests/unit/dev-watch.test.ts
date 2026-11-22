import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { browserBundleSourceDirectories } from '../../scripts/browser-watch.ts'

const projectRoot = path.resolve(import.meta.dir, '../..')
const relativeImportPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g

const resolveImport = (importer: string, specifier: string): string => {
	const candidate = path.resolve(path.dirname(importer), specifier)
	for (const resolved of [candidate, candidate.replace(/\.js$/, '.ts'), `${candidate}.ts`, path.join(candidate, 'index.ts')]) if (resolved.endsWith('.ts') && existsSync(resolved)) return resolved
	throw new Error(`Cannot resolve ${specifier} from ${path.relative(projectRoot, importer)}`)
}

const localBrowserBundleFiles = (entrypoint: string): readonly string[] => {
	const visited = new Set<string>()
	const pending = [entrypoint]
	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		if (visited.has(file)) continue
		visited.add(file)
		for (const match of readFileSync(file, 'utf8').matchAll(relativeImportPattern)) {
			const specifier = match[1]
			if (specifier !== undefined) pending.push(resolveImport(file, specifier))
		}
	}
	return [...visited].map(file => path.relative(projectRoot, file))
}

test('the development watcher covers every local module in the browser bundle', () => {
	const files = localBrowserBundleFiles(path.join(projectRoot, 'browser/live-app.ts'))
	expect(files).toContain('src/collateral.ts')
	const unwatched = files.filter(file => !browserBundleSourceDirectories.some(directory => file.startsWith(`${directory}/`)))
	expect(unwatched).toEqual([])
})
