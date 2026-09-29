import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { generatedOutputsForTaskGroup, projectDependencyClosure, projects, taskProjects, uiArtifactOutputs, validateProjectRegistryFiles, type ProjectTaskName } from './projects.ts'
import { repositoryRoot } from './root.mts'

async function matchingFiles(patterns: readonly string[], root: string) {
	const files = new Set<string>()
	for (const pattern of patterns) {
		const glob = new Bun.Glob(pattern)
		for await (const file of glob.scan({ cwd: root, dot: true, onlyFiles: true })) files.add(file)
	}
	return [...files].sort()
}

async function digestInputs(patterns: readonly string[], root = repositoryRoot) {
	const hasher = new Bun.CryptoHasher('sha256')
	for (const file of await matchingFiles(patterns, root)) {
		hasher.update(file)
		hasher.update('\0')
		hasher.update(await Bun.file(path.join(root, file)).arrayBuffer())
		hasher.update('\0')
	}
	return hasher.digest('hex')
}

const taskCacheInputs = (taskNames: readonly ProjectTaskName[]) => projects.flatMap(project => taskNames.flatMap(taskName => project.tasks[taskName]?.cacheInputs ?? []))

export async function generatedCacheKey(profile: 'full' | 'contracts', root = repositoryRoot) {
	const contractInputs = projectDependencyClosure(['contracts']).flatMap(project => project.tasks.build?.cacheInputs ?? project.tasks.build?.inputs ?? [])
	// Include the producers and registry as well as their declared source inputs.
	const producerInputs = ['package.json', 'bun.lock', 'solidity/tsconfig.json', 'tooling/repo/*.mts', 'tooling/repo/projects.ts', 'tooling/repo/sharedPackages.ts', 'tooling/contracts/ensure-contract-artifacts.mts', 'tooling/contracts/check-generated-artifacts.mts', 'tooling/ui/sharedBrowserArtifacts.ts']
	const inputs = profile === 'contracts' ? contractInputs : [...contractInputs, ...taskCacheInputs(['build', 'vendor'])]
	return digestInputs([...inputs, ...producerInputs], root)
}

export async function projectQuery() {
	validateProjectRegistryFiles(repositoryRoot)
	const generatedCachePaths = [...new Set(['shared/.freshness-hash', ...generatedOutputsForTaskGroup('build', 'generated'), ...taskProjects('vendor').flatMap(project => project.tasks.vendor?.outputs ?? [])])]
	const componentArtifactOutputs = ['shared/.freshness-hash', ...generatedOutputsForTaskGroup('build', 'component-artifacts')]
	return {
		componentArtifactOutputs,
		fullOnlyCachePaths: generatedCachePaths.filter(output => !componentArtifactOutputs.includes(output)),
		dependencyCacheKey: await digestInputs(taskCacheInputs(['setup'])),
		generatedCacheKey: await generatedCacheKey('full'),
		contractCacheKey: await generatedCacheKey('contracts'),
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
			contract_cache_key: result.contractCacheKey,
			full_only_cache_paths: result.fullOnlyCachePaths.join('\n'),
			generated_cache_paths: result.generatedCachePaths.join('\n'),
			setup_project_paths: result.setupProjectPaths.join('\n'),
			ui_artifact_outputs: result.uiArtifactOutputs.join('\n'),
		}))
			appendFileSync(outputPath, `${name}<<ZOLTAR_REGISTRY_VALUE\n${value}\nZOLTAR_REGISTRY_VALUE\n`)
	} else console.log(JSON.stringify(result, undefined, 2))
}
