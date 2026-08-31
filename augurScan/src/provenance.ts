import { createHash } from 'node:crypto'
import path from 'node:path'

export type SourceProvenance = {
	readonly applicationSourceHash: string
	readonly projectionSourceHash: string
}

const hashFiles = async (projectRoot: string, files: readonly string[]): Promise<string> => {
	const hash = createHash('sha256')
	for (const relativePath of [...files].sort()) {
		hash.update(relativePath)
		hash.update('\0')
		hash.update(new Uint8Array(await Bun.file(path.join(projectRoot, relativePath)).arrayBuffer()))
		hash.update('\0')
	}
	return `sha256:${hash.digest('hex')}`
}

const relativeModuleSpecifiers = (source: string): string[] => {
	const specifiers = new Set<string>()
	for (const pattern of [/\b(?:import|export)\s+(?:type\s+)?(?:[\w$*{},\s]+\s+from\s+)?['"](\.[^'"]+)['"]/g, /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g])
		for (const match of source.matchAll(pattern)) {
			const specifier = match[1]
			if (specifier !== undefined) specifiers.add(specifier)
		}
	return [...specifiers]
}

const runtimeDependencyPath = async (importer: string, specifier: string): Promise<string | undefined> => {
	const unresolved = path.resolve(path.dirname(importer), specifier)
	const extension = path.extname(unresolved)
	const candidates = [
		unresolved,
		...(extension === '.js'
			? [`${unresolved.slice(0, -'.js'.length)}.ts`]
			: extension === '.mjs'
				? [`${unresolved.slice(0, -'.mjs'.length)}.mts`]
				: extension === '.cjs'
					? [`${unresolved.slice(0, -'.cjs'.length)}.cts`]
					: extension === ''
						? [`${unresolved}.ts`, `${unresolved}.mts`, `${unresolved}.cts`, `${unresolved}.json`, path.join(unresolved, 'index.ts')]
						: []),
	]
	for (const candidate of candidates) if (await Bun.file(candidate).exists()) return candidate
	return undefined
}

const runtimeSourceFiles = async (projectRoot: string, sourceFiles: readonly string[]): Promise<string[]> => {
	const files = new Map(sourceFiles.map((relativePath) => [path.resolve(projectRoot, relativePath), relativePath]))
	const pending = [...files.keys()]
	while (pending.length > 0) {
		const current = pending.pop()
		if (current === undefined) break
		const source = await Bun.file(current).text()
		for (const specifier of relativeModuleSpecifiers(source)) {
			const dependency = await runtimeDependencyPath(current, specifier)
			if (dependency === undefined || files.has(dependency)) continue
			files.set(dependency, path.relative(projectRoot, dependency).replaceAll(path.sep, '/'))
			pending.push(dependency)
		}
	}
	return [...files.values()]
}

export const sourceProvenance = async (projectRoot = path.resolve(import.meta.dir, '..')): Promise<SourceProvenance> => {
	const sourceFiles = Array.fromAsync(new Bun.Glob('src/**/*.ts').scan({ cwd: projectRoot, onlyFiles: true }))
	const applicationFiles = [...(await runtimeSourceFiles(projectRoot, await sourceFiles)), 'package.json', 'bun.lock']
	return {
		applicationSourceHash: await hashFiles(projectRoot, applicationFiles),
		projectionSourceHash: await hashFiles(projectRoot, ['src/operations.ts', 'src/projections.ts']),
	}
}
