import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { componentProjects, projects, taskProjects, validateProjectRegistryFiles } from './projects.ts'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const ignoredDirectories = new Set(['.git', '.t3', 'artifacts', 'coverage', 'dist', 'js', 'node_modules', 'vendor'])

async function findPackageManifests(directory = repositoryRoot): Promise<string[]> {
	const manifests: string[] = []
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) manifests.push(...(await findPackageManifests(entryPath)))
		else if (entry.isFile() && entry.name === 'package.json') manifests.push(path.relative(repositoryRoot, entryPath).replaceAll('\\', '/'))
	}
	return manifests
}

test('every independently checked package has a component CI route', async () => {
	const routedDirectories = new Set(componentProjects().map(project => project.path))
	const missing: string[] = []
	for (const manifestPath of await findPackageManifests()) {
		if (manifestPath === 'package.json') continue
		const manifest: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, manifestPath), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) throw new Error(`${manifestPath} must contain an object`)
		const scripts = Reflect.get(manifest, 'scripts')
		if (typeof scripts !== 'object' || scripts === null || !Object.hasOwn(scripts, 'check')) continue
		const packageDirectory = path.posix.dirname(manifestPath)
		if (!routedDirectories.has(packageDirectory)) missing.push(packageDirectory)
	}
	expect(missing, 'packages with a check script but no component CI route').toEqual([])
})

test('registry owns every independent package and its setup exactly once', async () => {
	const manifestDirectories = (await findPackageManifests()).map(manifest => (manifest === 'package.json' ? '.' : path.posix.dirname(manifest))).sort()
	const registeredPackageDirectories = projects
		.filter(project => project.path === '.' || manifestDirectories.includes(project.path))
		.map(project => project.path)
		.sort()
	expect(registeredPackageDirectories).toEqual(manifestDirectories)
	expect(
		taskProjects('setup')
			.map(project => project.path)
			.sort(),
	).toEqual(manifestDirectories)
})

test('registry paths, local dependencies, cache inputs, and generated outputs are valid', () => {
	expect(() => validateProjectRegistryFiles(repositoryRoot)).not.toThrow()
})

test('local installation and CI use the package-manager Bun version', async () => {
	const rootManifest: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
	if (typeof rootManifest !== 'object' || rootManifest === null) throw new Error('package.json must contain an object')
	const packageManager = Reflect.get(rootManifest, 'packageManager')
	if (typeof packageManager !== 'string') throw new Error('package.json must declare packageManager')
	const bunVersion = packageManager.match(/^bun@(?<version>\d+\.\d+\.\d+)$/)?.groups?.version
	if (bunVersion === undefined) throw new Error(`Unsupported packageManager declaration: ${packageManager}`)

	const installSource = await fs.readFile(path.join(repositoryRoot, 'tooling/repo/install-frozen.mts'), 'utf8')
	const ciSource = await fs.readFile(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8')
	expect(installSource).toContain(`const repositoryBunVersion = '${bunVersion}'`)
	expect(ciSource).toContain(`BUN_VERSION: ${bunVersion}`)
})
