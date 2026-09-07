import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { generatedOutputsForTaskGroup, projects, taskProjects, uiArtifactOutputs, validateProjectRegistryFiles, type ProjectTaskName } from './projects.ts'

const repositoryRoot = path.resolve(import.meta.dir, '../..')

async function matchingFiles(patterns: readonly string[]) {
	const files = new Set<string>()
	for (const pattern of patterns) {
		const glob = new Bun.Glob(pattern)
		for await (const file of glob.scan({ cwd: repositoryRoot, dot: true, onlyFiles: true })) files.add(file)
	}
	return [...files].sort()
}

async function digestInputs(patterns: readonly string[]) {
	const hasher = new Bun.CryptoHasher('sha256')
	for (const file of await matchingFiles(patterns)) {
		hasher.update(file)
		hasher.update(await Bun.file(path.join(repositoryRoot, file)).arrayBuffer())
	}
	return hasher.digest('hex')
}

const taskCacheInputs = (taskNames: readonly ProjectTaskName[]) => projects.flatMap(project => taskNames.flatMap(taskName => project.tasks[taskName]?.cacheInputs ?? []))

export async function projectQuery() {
	validateProjectRegistryFiles(repositoryRoot)
	const generatedCachePaths = [...new Set([...generatedOutputsForTaskGroup('build', 'generated'), ...taskProjects('vendor').flatMap(project => project.tasks.vendor?.outputs ?? [])])]
	return {
		componentArtifactOutputs: generatedOutputsForTaskGroup('build', 'component-artifacts'),
		dependencyCacheKey: await digestInputs(taskCacheInputs(['setup'])),
		generatedCacheKey: await digestInputs(taskCacheInputs(['build', 'vendor'])),
		generatedCachePaths,
		setupProjectPaths: taskProjects('setup').map(project => project.path),
		uiArtifactOutputs: uiArtifactOutputs(),
	}
}

if (import.meta.main) {
	const result = await projectQuery()
	if (process.argv.includes('--github-output')) {
		const outputPath = process.env['GITHUB_OUTPUT']
		if (outputPath === undefined) throw new Error('GITHUB_OUTPUT is required with --github-output')
		for (const [name, value] of Object.entries({
			component_artifact_outputs: result.componentArtifactOutputs.join('\n'),
			dependency_cache_key: result.dependencyCacheKey,
			generated_cache_key: result.generatedCacheKey,
			generated_cache_paths: result.generatedCachePaths.join('\n'),
			setup_project_paths: result.setupProjectPaths.join('\n'),
			ui_artifact_outputs: result.uiArtifactOutputs.join('\n'),
		}))
			appendFileSync(outputPath, `${name}<<ZOLTAR_REGISTRY_VALUE\n${value}\nZOLTAR_REGISTRY_VALUE\n`)
	} else console.log(JSON.stringify(result, undefined, 2))
}
