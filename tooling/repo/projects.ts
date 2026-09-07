export const projectTypes = ['library', 'contracts', 'ui-tooling', 'ui-app', 'service', 'bot', 'documentation'] as const
export type ProjectType = (typeof projectTypes)[number]

export type ProjectTaskName = 'setup' | 'build' | 'test' | 'lint' | 'typecheck' | 'knip' | 'dependency-update'

export type ProjectTask = {
	readonly command: readonly string[]
	readonly inputs: readonly string[]
	readonly outputs?: readonly string[]
	readonly requiredEnvironment?: readonly string[]
	readonly cacheInputs?: readonly string[]
}

export type Project = {
	readonly id: string
	readonly path: string
	readonly type: ProjectType
	readonly dependencies: readonly string[]
	readonly tasks: Readonly<Partial<Record<ProjectTaskName, ProjectTask>>>
	readonly generatedDirectories: readonly string[]
	readonly ci?: {
		readonly scope: string
		readonly componentName?: string
		readonly requiresContractArtifacts?: boolean
		readonly commands?: readonly (readonly string[])[]
	}
}

const packageInputs = (projectPath: string) => [`${projectPath}/package.json`, `${projectPath}/bun.lock`]
const packageTask = (projectPath: string, scriptName: string, outputs?: readonly string[]): ProjectTask => ({
	command: ['bun', 'run', scriptName],
	inputs: [...packageInputs(projectPath), `${projectPath}/src/**`, `${projectPath}/ts/**`],
	...(outputs === undefined ? {} : { outputs }),
	cacheInputs: packageInputs(projectPath),
})

const botAudit = ['bun', 'audit', '--ignore', 'GHSA-8xcm-r25x-g524', '--ignore', 'GHSA-4cwx-7wf7-3272', '--ignore', 'GHSA-m8rv-5g2x-5cg5', '--ignore', 'GHSA-jr45-8vmc-qm54', '--ignore', 'GHSA-v3r7-h72x-cjcm'] as const
const augurScanAudit = ['bun', 'audit', '--ignore', 'GHSA-52f5-9888-hmc6', '--ignore', 'GHSA-ph9p-34f9-6g65'] as const

/**
 * Canonical repository project graph. Package boundaries remain independent:
 * every non-root package keeps its own lockfile and no workspace is implied.
 */
export const projects: readonly Project[] = [
	{
		id: 'shared',
		path: 'shared',
		type: 'library',
		dependencies: [],
		tasks: { build: packageTask('shared', 'build', ['shared/js']) },
		generatedDirectories: ['shared/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'contracts',
		path: 'solidity',
		type: 'contracts',
		dependencies: ['shared'],
		tasks: {
			setup: packageTask('solidity', 'setup', ['solidity/artifacts', 'solidity/ts/types/contractArtifact.ts']),
			build: packageTask('solidity', 'compile-contracts', ['solidity/artifacts', 'solidity/ts/types/contractArtifact.ts']),
			test: packageTask('solidity', 'test'),
		},
		generatedDirectories: ['solidity/artifacts', 'solidity/js'],
		ci: { scope: 'infrastructure' },
	},
	{
		id: 'ui-core',
		path: 'ui/coreShared',
		type: 'ui-tooling',
		dependencies: ['shared', 'contracts'],
		tasks: { build: packageTask('ui/coreShared', 'tsc', ['ui/coreShared/js']), typecheck: packageTask('ui/coreShared', 'tsc') },
		generatedDirectories: ['ui/coreShared/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-zoltar',
		path: 'ui/zoltar',
		type: 'ui-app',
		dependencies: ['ui-core'],
		tasks: { build: packageTask('ui/zoltar', 'build', ['ui/zoltar/js']), typecheck: packageTask('ui/zoltar', 'build') },
		generatedDirectories: ['ui/zoltar/js', 'ui/zoltar/dist', 'ui/zoltar/vendor'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-statoblast',
		path: 'ui/statoblast',
		type: 'ui-app',
		dependencies: ['ui-core', 'ui-zoltar'],
		tasks: { build: packageTask('ui/statoblast', 'build', ['ui/statoblast/js']), typecheck: packageTask('ui/statoblast', 'build') },
		generatedDirectories: ['ui/statoblast/js', 'ui/statoblast/dist', 'ui/statoblast/vendor'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-trading',
		path: 'ui/trading',
		type: 'ui-app',
		dependencies: ['ui-core', 'ui-zoltar', 'ui-statoblast'],
		tasks: { build: packageTask('ui/trading', 'build', ['ui/trading/js']), test: packageTask('ui/trading', 'test'), typecheck: packageTask('ui/trading', 'build') },
		generatedDirectories: ['ui/trading/js', 'ui/trading/dist', 'ui/trading/vendor'],
		ci: { scope: 'core' },
	},
	{
		id: 'bot-shared',
		path: 'bots/shared',
		type: 'library',
		dependencies: ['shared'],
		tasks: { test: packageTask('bots/shared', 'test'), lint: packageTask('bots/shared', 'check'), typecheck: packageTask('bots/shared', 'typecheck') },
		generatedDirectories: [],
		ci: { scope: 'bot-shared', componentName: 'bot-shared', commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'chaos',
		path: 'bots/chaos',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: { test: packageTask('bots/chaos', 'test'), lint: packageTask('bots/chaos', 'check'), typecheck: packageTask('bots/chaos', 'typecheck') },
		generatedDirectories: [],
		ci: { scope: 'chaos', componentName: 'chaos', requiresContractArtifacts: true, commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'arbitrager',
		path: 'bots/open-oracle-arbitrager',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: { test: packageTask('bots/open-oracle-arbitrager', 'test'), lint: packageTask('bots/open-oracle-arbitrager', 'check'), typecheck: packageTask('bots/open-oracle-arbitrager', 'typecheck') },
		generatedDirectories: ['bots/open-oracle-arbitrager/src/contracts/artifacts.generated.ts'],
		ci: { scope: 'arbitrager', componentName: 'arbitrager', requiresContractArtifacts: true, commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'liquidator',
		path: 'bots/liquidator',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: { test: packageTask('bots/liquidator', 'test'), lint: packageTask('bots/liquidator', 'check'), typecheck: packageTask('bots/liquidator', 'typecheck') },
		generatedDirectories: [],
		ci: { scope: 'liquidator', componentName: 'liquidator', requiresContractArtifacts: true, commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'augur-scan',
		path: 'augurScan',
		type: 'service',
		dependencies: ['shared'],
		tasks: { test: packageTask('augurScan', 'test'), lint: packageTask('augurScan', 'check'), typecheck: packageTask('augurScan', 'typecheck') },
		generatedDirectories: ['augurScan/dist'],
		ci: { scope: 'augur-scan', componentName: 'augur-scan', commands: [['bun', 'run', 'typecheck'], ['bun', 'run', 'check'], ['bun', 'run', 'test'], augurScanAudit] },
	},
	{
		id: 'docs',
		path: 'docs',
		type: 'documentation',
		dependencies: ['contracts'],
		tasks: { build: { command: ['bun', 'run', 'docs:check'], inputs: ['docs/**', 'solidity/contracts/**'], outputs: ['docs/assets/js/**', 'docs/reference/contracts.html'] } },
		generatedDirectories: ['docs/assets/js', 'docs/reference/contracts.html'],
		ci: { scope: 'docs' },
	},
]

export function projectById(projectId: string, registry: readonly Project[] = projects): Project | undefined {
	return registry.find(project => project.id === projectId)
}

export function validateProjectRegistry(registry: readonly Project[] = projects): void {
	const ids = new Set<string>()
	const paths = new Set<string>()
	for (const project of registry) {
		if (project.id.trim() === '' || project.path.trim() === '') throw new Error('Project IDs and paths must be non-empty')
		if (ids.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`)
		if (paths.has(project.path)) throw new Error(`Duplicate project path: ${project.path}`)
		ids.add(project.id)
		paths.add(project.path)
	}
	for (const project of registry)
		for (const dependency of project.dependencies) {
			if (!ids.has(dependency)) throw new Error(`${project.id} depends on unknown project ${dependency}`)
			if (dependency === project.id) throw new Error(`${project.id} cannot depend on itself`)
		}
	topologicallySortedProjects(registry)
}

export function topologicallySortedProjects(registry: readonly Project[] = projects): Project[] {
	const byId = new Map(registry.map(project => [project.id, project]))
	const visiting = new Set<string>()
	const visited = new Set<string>()
	const ordered: Project[] = []
	const visit = (project: Project) => {
		if (visited.has(project.id)) return
		if (visiting.has(project.id)) throw new Error(`Project dependency cycle includes ${project.id}`)
		visiting.add(project.id)
		for (const dependencyId of project.dependencies) {
			const dependency = byId.get(dependencyId)
			if (dependency === undefined) throw new Error(`${project.id} depends on unknown project ${dependencyId}`)
			visit(dependency)
		}
		visiting.delete(project.id)
		visited.add(project.id)
		ordered.push(project)
	}
	for (const project of registry) visit(project)
	return ordered
}

export function ownerProject(filePath: string, registry: readonly Project[] = projects): Project | undefined {
	return [...registry].sort((left, right) => right.path.length - left.path.length).find(project => filePath === project.path || filePath.startsWith(`${project.path}/`))
}

export function affectedProjects(filePaths: readonly string[], registry: readonly Project[] = projects): Project[] {
	validateProjectRegistry(registry)
	const affected = new Set(filePaths.flatMap(filePath => ownerProject(filePath, registry)?.id ?? []))
	let changed = true
	while (changed) {
		changed = false
		for (const project of registry) {
			if (affected.has(project.id) || !project.dependencies.some(dependency => affected.has(dependency))) continue
			affected.add(project.id)
			changed = true
		}
	}
	return topologicallySortedProjects(registry).filter(project => affected.has(project.id))
}

export function componentProjects(registry: readonly Project[] = projects): Project[] {
	return registry.filter(project => project.ci?.componentName !== undefined)
}
