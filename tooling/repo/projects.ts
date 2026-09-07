export const projectTypes = ['library', 'contracts', 'ui-domain', 'ui-app', 'service', 'bot', 'documentation'] as const
export type ProjectType = (typeof projectTypes)[number]

export const projectTaskNames = ['setup', 'build', 'test', 'lint', 'typecheck', 'knip', 'dependency-update'] as const
export type ProjectTaskName = (typeof projectTaskNames)[number]

export type ProjectTask = {
	readonly command: readonly string[]
	readonly cwd: string
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
	cwd: projectPath,
	inputs: [...packageInputs(projectPath), `${projectPath}/src/**`, `${projectPath}/ts/**`],
	...(outputs === undefined ? {} : { outputs }),
	cacheInputs: packageInputs(projectPath),
})

const packageInstallTask = (projectPath: string): ProjectTask => ({
	command: ['bun', './tooling/repo/install-frozen.mts', projectPath],
	cwd: '.',
	inputs: packageInputs(projectPath),
	cacheInputs: packageInputs(projectPath),
})

const sharedDependencyTask = (projectPath: string): ProjectTask => ({
	command: ['bun', `${'../'.repeat(projectPath.split('/').length)}tooling/repo/ensure-shared-package-fresh.mts`, '--refresh'],
	cwd: projectPath,
	inputs: [...packageInputs(projectPath), 'shared/package.json', 'shared/ts/**'],
	cacheInputs: [...packageInputs(projectPath), 'shared/package.json'],
})

const rootTask = (command: readonly string[], inputs: readonly string[]): ProjectTask => ({ command, cwd: '.', inputs })

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
		tasks: { setup: packageInstallTask('shared'), build: packageTask('shared', 'build', ['shared/js']) },
		generatedDirectories: ['shared/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'contracts',
		path: 'solidity',
		type: 'contracts',
		dependencies: ['shared'],
		tasks: {
			setup: packageInstallTask('solidity'),
			build: packageTask('solidity', 'compile-contracts', ['solidity/artifacts', 'solidity/ts/types/contractArtifact.ts']),
			test: packageTask('solidity', 'test'),
			'dependency-update': sharedDependencyTask('solidity'),
		},
		generatedDirectories: ['solidity/artifacts', 'solidity/js'],
		ci: { scope: 'infrastructure' },
	},
	{
		id: 'ui-core',
		path: 'ui/coreShared',
		type: 'library',
		dependencies: ['shared', 'contracts'],
		tasks: { setup: packageInstallTask('ui/coreShared'), build: packageTask('ui/coreShared', 'tsc', ['ui/coreShared/js']), typecheck: packageTask('ui/coreShared', 'tsc'), 'dependency-update': sharedDependencyTask('ui/coreShared') },
		generatedDirectories: ['ui/coreShared/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-zoltar-domain',
		path: 'ui/zoltarDomain',
		type: 'ui-domain',
		dependencies: ['shared', 'contracts', 'ui-core'],
		tasks: { setup: packageInstallTask('ui/zoltarDomain'), build: packageTask('ui/zoltarDomain', 'build', ['ui/zoltarDomain/js']), typecheck: packageTask('ui/zoltarDomain', 'typecheck'), 'dependency-update': sharedDependencyTask('ui/zoltarDomain') },
		generatedDirectories: ['ui/zoltarDomain/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-statoblast-domain',
		path: 'ui/statoblastDomain',
		type: 'ui-domain',
		dependencies: ['shared', 'contracts', 'ui-core', 'ui-zoltar-domain'],
		tasks: { setup: packageInstallTask('ui/statoblastDomain'), build: packageTask('ui/statoblastDomain', 'build', ['ui/statoblastDomain/js']), typecheck: packageTask('ui/statoblastDomain', 'typecheck'), 'dependency-update': sharedDependencyTask('ui/statoblastDomain') },
		generatedDirectories: ['ui/statoblastDomain/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-trading-domain',
		path: 'ui/tradingDomain',
		type: 'ui-domain',
		dependencies: ['shared'],
		tasks: { setup: packageInstallTask('ui/tradingDomain'), build: packageTask('ui/tradingDomain', 'build', ['ui/tradingDomain/js']), typecheck: packageTask('ui/tradingDomain', 'typecheck'), 'dependency-update': sharedDependencyTask('ui/tradingDomain') },
		generatedDirectories: ['ui/tradingDomain/js'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-zoltar',
		path: 'ui/zoltar',
		type: 'ui-app',
		dependencies: ['ui-core', 'ui-zoltar-domain'],
		tasks: { setup: packageInstallTask('ui/zoltar'), build: packageTask('ui/zoltar', 'build', ['ui/zoltar/js']), typecheck: packageTask('ui/zoltar', 'build'), 'dependency-update': sharedDependencyTask('ui/zoltar') },
		generatedDirectories: ['ui/zoltar/js', 'ui/zoltar/dist', 'ui/zoltar/vendor'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-statoblast',
		path: 'ui/statoblast',
		type: 'ui-app',
		dependencies: ['ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain'],
		tasks: { setup: packageInstallTask('ui/statoblast'), build: packageTask('ui/statoblast', 'build', ['ui/statoblast/js']), typecheck: packageTask('ui/statoblast', 'build'), 'dependency-update': sharedDependencyTask('ui/statoblast') },
		generatedDirectories: ['ui/statoblast/js', 'ui/statoblast/dist', 'ui/statoblast/vendor'],
		ci: { scope: 'core' },
	},
	{
		id: 'ui-trading',
		path: 'ui/trading',
		type: 'ui-app',
		dependencies: ['ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain'],
		tasks: {
			setup: packageInstallTask('ui/trading'),
			build: packageTask('ui/trading', 'build', ['ui/trading/js']),
			test: packageTask('ui/trading', 'test'),
			typecheck: packageTask('ui/trading', 'build'),
			knip: rootTask(['bun', 'x', 'knip', '--production', '--workspace', 'ui/trading', '--include', 'files'], ['knip.json', 'ui/trading/**']),
			'dependency-update': sharedDependencyTask('ui/trading'),
		},
		generatedDirectories: ['ui/trading/js', 'ui/trading/dist', 'ui/trading/vendor'],
		ci: { scope: 'core' },
	},
	{
		id: 'bot-shared',
		path: 'bots/shared',
		type: 'library',
		dependencies: ['shared'],
		tasks: { setup: packageInstallTask('bots/shared'), test: packageTask('bots/shared', 'test'), lint: packageTask('bots/shared', 'check'), typecheck: packageTask('bots/shared', 'typecheck'), 'dependency-update': sharedDependencyTask('bots/shared') },
		generatedDirectories: [],
		ci: { scope: 'bot-shared', componentName: 'bot-shared', commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'chaos',
		path: 'bots/chaos',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: { setup: packageInstallTask('bots/chaos'), test: packageTask('bots/chaos', 'test'), lint: packageTask('bots/chaos', 'check'), typecheck: packageTask('bots/chaos', 'typecheck'), 'dependency-update': sharedDependencyTask('bots/chaos') },
		generatedDirectories: [],
		ci: { scope: 'chaos', componentName: 'chaos', requiresContractArtifacts: true, commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'arbitrager',
		path: 'bots/open-oracle-arbitrager',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: {
			setup: packageInstallTask('bots/open-oracle-arbitrager'),
			test: packageTask('bots/open-oracle-arbitrager', 'test'),
			lint: packageTask('bots/open-oracle-arbitrager', 'check'),
			typecheck: packageTask('bots/open-oracle-arbitrager', 'typecheck'),
			'dependency-update': sharedDependencyTask('bots/open-oracle-arbitrager'),
		},
		generatedDirectories: ['bots/open-oracle-arbitrager/src/contracts/artifacts.generated.ts'],
		ci: { scope: 'arbitrager', componentName: 'arbitrager', requiresContractArtifacts: true, commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'liquidator',
		path: 'bots/liquidator',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: { setup: packageInstallTask('bots/liquidator'), test: packageTask('bots/liquidator', 'test'), lint: packageTask('bots/liquidator', 'check'), typecheck: packageTask('bots/liquidator', 'typecheck'), 'dependency-update': sharedDependencyTask('bots/liquidator') },
		generatedDirectories: [],
		ci: { scope: 'liquidator', componentName: 'liquidator', requiresContractArtifacts: true, commands: [['bun', 'run', 'check'], botAudit] },
	},
	{
		id: 'augur-scan',
		path: 'augurScan',
		type: 'service',
		dependencies: ['shared'],
		tasks: { setup: packageInstallTask('augurScan'), build: packageTask('augurScan', 'build', ['augurScan/dist']), test: packageTask('augurScan', 'test'), lint: packageTask('augurScan', 'check'), typecheck: packageTask('augurScan', 'typecheck'), 'dependency-update': sharedDependencyTask('augurScan') },
		generatedDirectories: ['augurScan/dist'],
		ci: { scope: 'augur-scan', componentName: 'augur-scan', commands: [['bun', 'run', 'typecheck'], ['bun', 'run', 'check'], ['bun', 'run', 'test'], augurScanAudit] },
	},
	{
		id: 'docs',
		path: 'docs',
		type: 'documentation',
		dependencies: ['contracts'],
		tasks: { build: { command: ['bun', 'run', 'docs:check'], cwd: '.', inputs: ['docs/**', 'solidity/contracts/**'], outputs: ['docs/assets/js/**', 'docs/reference/contracts.html'] } },
		generatedDirectories: ['docs/assets/js', 'docs/reference/contracts.html'],
		ci: { scope: 'docs' },
	},
]

export const repositoryTaskProjects: Readonly<Record<ProjectTaskName, readonly string[]>> = {
	setup: ['shared', 'contracts', 'ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain', 'ui-zoltar', 'ui-statoblast', 'ui-trading'],
	build: ['ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain', 'ui-zoltar', 'ui-statoblast', 'ui-trading'],
	test: ['contracts', 'ui-trading', 'bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'],
	lint: ['bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'],
	typecheck: ['ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain', 'ui-zoltar', 'ui-statoblast', 'ui-trading', 'bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'],
	knip: ['ui-trading'],
	'dependency-update': ['contracts', 'ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain', 'ui-zoltar', 'ui-statoblast', 'ui-trading'],
}

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
		for (const taskName of projectTaskNames) {
			const task = project.tasks[taskName]
			if (task === undefined) continue
			if (task.command.length === 0) throw new Error(`${project.id} ${taskName} command must not be empty`)
			if (task.cwd === '' || task.cwd.startsWith('/') || task.cwd.split('/').includes('..')) throw new Error(`${project.id} ${taskName} has invalid cwd ${task.cwd}`)
		}
	}
	for (const project of registry)
		for (const dependency of project.dependencies) {
			if (!ids.has(dependency)) throw new Error(`${project.id} depends on unknown project ${dependency}`)
			if (dependency === project.id) throw new Error(`${project.id} cannot depend on itself`)
		}
	topologicallySortedProjects(registry)
	if (registry === projects)
		for (const taskName of projectTaskNames) {
			const projectIds = repositoryTaskProjects[taskName]
			for (const projectId of projectIds) {
				const project = registry.find(entry => entry.id === projectId)
				if (project === undefined) throw new Error(`${taskName} references unknown project ${projectId}`)
				if (project.tasks[taskName] === undefined) throw new Error(`${taskName} references ${projectId} without task metadata`)
			}
		}
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
