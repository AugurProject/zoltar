import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const projectTypes = ['repository', 'library', 'contracts', 'ui-domain', 'ui-app', 'service', 'bot', 'documentation'] as const
type ProjectType = (typeof projectTypes)[number]

export const projectTaskNames = ['setup', 'build', 'vendor', 'test-build', 'workers', 'test', 'check', 'lint', 'typecheck', 'knip', 'audit', 'dependency-update', 'integration'] as const
export type ProjectTaskName = (typeof projectTaskNames)[number]

type ProjectTask = {
	readonly command: readonly string[]
	readonly cwd: string
	readonly inputs: readonly string[]
	readonly outputs?: readonly string[]
	readonly requiredEnvironment?: readonly string[]
	readonly cacheInputs?: readonly string[]
	readonly groups?: readonly string[]
}

export type Project = {
	readonly id: string
	readonly path: string
	readonly type: ProjectType
	readonly dependencies: readonly string[]
	readonly tasks: Readonly<Partial<Record<ProjectTaskName, ProjectTask>>>
	readonly generatedDirectories: readonly string[]
	readonly generatedFiles?: readonly string[]
	readonly ci?: {
		readonly scope: string
		readonly componentName?: string
		readonly requiresContractArtifacts?: boolean
		readonly artifactOutputs?: readonly string[]
	}
}

const packageInputs = (projectPath: string) => [`${projectPath}/package.json`, `${projectPath}/bun.lock`]
const packageTask = (projectPath: string, scriptName: string, options: { readonly cacheInputs?: readonly string[]; readonly groups?: readonly string[]; readonly outputs?: readonly string[] } = {}): ProjectTask => ({
	command: ['bun', 'run', scriptName],
	cwd: projectPath,
	inputs: [...packageInputs(projectPath), `${projectPath}/**`],
	...(options.outputs === undefined ? {} : { outputs: options.outputs }),
	...(options.groups === undefined ? {} : { groups: options.groups }),
	cacheInputs: options.cacheInputs ?? packageInputs(projectPath),
})

const packageInstallTask = (projectPath: string, groups?: readonly string[]): ProjectTask => ({
	command: ['bun', './tooling/repo/install-frozen.mts', projectPath],
	cwd: '.',
	inputs: packageInputs(projectPath),
	cacheInputs: packageInputs(projectPath),
	...(groups === undefined ? {} : { groups }),
})

const packageAuditTask = (projectPath: string, groups?: readonly string[]): ProjectTask => ({ ...packageTask(projectPath, 'audit'), command: ['bun', 'audit'], ...(groups === undefined ? {} : { groups }) })

const sharedDependencyTask = (projectPath: string): ProjectTask => ({
	command: ['bun', `${'../'.repeat(projectPath.split('/').length)}tooling/repo/ensure-shared-package-fresh.mts`, '--refresh'],
	cwd: projectPath,
	inputs: [...packageInputs(projectPath), 'shared/package.json', 'shared/ts/**'],
	cacheInputs: [...packageInputs(projectPath), 'shared/package.json'],
})

const rootTask = (command: readonly string[], inputs: readonly string[], groups?: readonly string[]): ProjectTask => ({ command, cwd: '.', inputs, ...(groups === undefined ? {} : { groups }) })

const botAudit = ['bun', 'audit', '--ignore', 'GHSA-8xcm-r25x-g524', '--ignore', 'GHSA-4cwx-7wf7-3272', '--ignore', 'GHSA-m8rv-5g2x-5cg5', '--ignore', 'GHSA-jr45-8vmc-qm54', '--ignore', 'GHSA-v3r7-h72x-cjcm'] as const
const augurScanAudit = ['bun', 'audit', '--ignore', 'GHSA-52f5-9888-hmc6', '--ignore', 'GHSA-ph9p-34f9-6g65'] as const

/**
 * Canonical repository project graph. Package boundaries remain independent:
 * every non-root package keeps its own lockfile and no workspace is implied.
 */
export const projects: readonly Project[] = [
	{
		id: 'repository',
		path: '.',
		type: 'repository',
		dependencies: ['shared', 'contracts', 'ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain', 'ui-zoltar', 'ui-statoblast', 'ui-trading'],
		tasks: {
			setup: { command: ['bun', './tooling/repo/install-frozen.mts'], cwd: '.', inputs: ['package.json', 'bun.lock'], cacheInputs: ['package.json', 'bun.lock'] },
			test: rootTask(['bun', 'run', 'test'], ['package.json', 'bun.lock', 'bun-test-setup*.ts', 'tooling/testing/**', 'shared/ts/**', 'solidity/ts/**', 'ui/*/ts/**']),
			check: rootTask(['bun', 'run', 'check:complete'], ['package.json', 'bun.lock', 'biome.json', 'knip.json', '.prettierrc.json', 'tooling/**', 'docs/**', 'shared/ts/**', 'solidity/**', 'ui/**']),
			lint: rootTask(['bun', 'run', 'check:static'], ['package.json', 'biome.json', 'tooling/**', 'shared/ts/**', 'solidity/ts/**', 'ui/**']),
			typecheck: rootTask(['bun', 'run', 'tsc:root'], ['package.json', 'tsconfig.scripts.json', 'docs/tsconfig.json', 'tooling/**']),
			knip: rootTask(['bun', 'x', 'knip'], ['package.json', 'knip.json', 'tooling/**', 'shared/ts/**', 'solidity/ts/**', 'ui/**', 'bots/**', 'augurScan/**']),
			audit: rootTask(['bun', 'audit'], ['package.json', 'bun.lock'], ['core-audit']),
		},
		generatedDirectories: [],
		ci: { scope: 'core' },
	},
	{
		id: 'shared',
		path: 'shared',
		type: 'library',
		dependencies: [],
		tasks: { setup: packageInstallTask('shared'), build: packageTask('shared', 'build', { cacheInputs: [...packageInputs('shared'), 'shared/tsconfig.json', 'shared/ts/**'], groups: ['generated', 'component-artifacts'], outputs: ['shared/js'] }), audit: packageAuditTask('shared', ['core-audit']) },
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
			build: packageTask('solidity', 'compile-contracts', {
				cacheInputs: [...packageInputs('solidity'), 'solidity/tsconfig-compile.json', 'solidity/ts/abi/**', 'solidity/ts/compile.ts', 'solidity/contracts/**', 'tooling/ui/projectArtifacts.mts'],
				groups: ['generated', 'component-artifacts'],
				outputs: ['solidity/artifacts', 'solidity/js', 'solidity/.contract-hash.json', 'solidity/ts/types/contractArtifact.ts', 'ui/coreShared/ts/abis.ts', 'ui/coreShared/ts/contractArtifact.ts', 'ui/trading/ts/generated/contractArtifact.ts'],
			}),
			test: packageTask('solidity', 'test'),
			typecheck: { ...packageTask('solidity', 'tsc'), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.typecheck.json'] },
			audit: packageAuditTask('solidity', ['core-audit']),
			'dependency-update': sharedDependencyTask('solidity'),
		},
		generatedDirectories: ['solidity/artifacts', 'solidity/js'],
		generatedFiles: ['solidity/.contract-hash.json', 'solidity/ts/types/contractArtifact.ts', 'ui/coreShared/ts/abis.ts', 'ui/coreShared/ts/contractArtifact.ts', 'ui/trading/ts/generated/contractArtifact.ts'],
		ci: { scope: 'infrastructure' },
	},
	{
		id: 'ui-core',
		path: 'ui/coreShared',
		type: 'library',
		dependencies: ['shared', 'contracts'],
		tasks: {
			setup: packageInstallTask('ui/coreShared'),
			build: packageTask('ui/coreShared', 'tsc', { groups: ['ui'], outputs: ['ui/coreShared/js'] }),
			'test-build': { ...packageTask('ui/coreShared', 'build:tests'), outputs: ['ui/coreShared/js/tests'] },
			typecheck: { ...packageTask('ui/coreShared', 'tsc'), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json', '--noEmit'] },
			audit: packageAuditTask('ui/coreShared', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/coreShared'),
		},
		generatedDirectories: ['ui/coreShared/js'],
		ci: { scope: 'core', artifactOutputs: ['ui/coreShared/js'] },
	},
	{
		id: 'ui-zoltar-domain',
		path: 'ui/zoltarDomain',
		type: 'ui-domain',
		dependencies: ['shared', 'ui-core'],
		tasks: {
			setup: packageInstallTask('ui/zoltarDomain'),
			build: packageTask('ui/zoltarDomain', 'build', { groups: ['ui'], outputs: ['ui/zoltarDomain/js'] }),
			typecheck: packageTask('ui/zoltarDomain', 'typecheck'),
			audit: packageAuditTask('ui/zoltarDomain', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/zoltarDomain'),
		},
		generatedDirectories: ['ui/zoltarDomain/js'],
		ci: { scope: 'core', artifactOutputs: ['ui/zoltarDomain/js'] },
	},
	{
		id: 'ui-statoblast-domain',
		path: 'ui/statoblastDomain',
		type: 'ui-domain',
		dependencies: ['shared', 'ui-core', 'ui-zoltar-domain'],
		tasks: {
			setup: packageInstallTask('ui/statoblastDomain'),
			build: packageTask('ui/statoblastDomain', 'build', { groups: ['ui'], outputs: ['ui/statoblastDomain/js'] }),
			typecheck: packageTask('ui/statoblastDomain', 'typecheck'),
			audit: packageAuditTask('ui/statoblastDomain', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/statoblastDomain'),
		},
		generatedDirectories: ['ui/statoblastDomain/js'],
		ci: { scope: 'core', artifactOutputs: ['ui/statoblastDomain/js'] },
	},
	{
		id: 'ui-trading-domain',
		path: 'ui/tradingDomain',
		type: 'ui-domain',
		dependencies: ['shared'],
		tasks: {
			setup: packageInstallTask('ui/tradingDomain'),
			build: packageTask('ui/tradingDomain', 'build', { groups: ['ui'], outputs: ['ui/tradingDomain/js'] }),
			typecheck: packageTask('ui/tradingDomain', 'typecheck'),
			audit: packageAuditTask('ui/tradingDomain', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/tradingDomain'),
		},
		generatedDirectories: ['ui/tradingDomain/js'],
		ci: { scope: 'core', artifactOutputs: ['ui/tradingDomain/js'] },
	},
	{
		id: 'ui-zoltar',
		path: 'ui/zoltar',
		type: 'ui-app',
		dependencies: ['shared', 'ui-core', 'ui-zoltar-domain'],
		tasks: {
			setup: packageInstallTask('ui/zoltar'),
			build: { ...packageTask('ui/zoltar', 'build', { groups: ['ui'], outputs: ['ui/zoltar/js'] }), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json'] },
			vendor: { ...packageTask('ui/zoltar', 'vendor', { cacheInputs: [...packageInputs('ui/zoltar'), 'tooling/ui/bundlerPaths.mts', 'tooling/ui/vendor.mts'] }), outputs: ['ui/zoltar/vendor'] },
			'test-build': { ...packageTask('ui/zoltar', 'build:tests'), outputs: ['ui/zoltar/js/tests'] },
			workers: packageTask('ui/zoltar', 'build:workers'),
			typecheck: { ...packageTask('ui/zoltar', 'build'), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json', '--noEmit'] },
			audit: packageAuditTask('ui/zoltar', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/zoltar'),
		},
		generatedDirectories: ['ui/zoltar/js', 'ui/zoltar/dist', 'ui/zoltar/vendor'],
		ci: { scope: 'core', artifactOutputs: ['ui/zoltar/js', 'ui/zoltar/dist'] },
	},
	{
		id: 'ui-statoblast',
		path: 'ui/statoblast',
		type: 'ui-app',
		dependencies: ['shared', 'ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain'],
		tasks: {
			setup: packageInstallTask('ui/statoblast'),
			build: { ...packageTask('ui/statoblast', 'build', { groups: ['ui'], outputs: ['ui/statoblast/js'] }), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json'] },
			vendor: { ...packageTask('ui/statoblast', 'vendor', { cacheInputs: [...packageInputs('ui/statoblast'), 'tooling/ui/bundlerPaths.mts', 'tooling/ui/vendor.mts'] }), outputs: ['ui/statoblast/vendor'] },
			'test-build': { ...packageTask('ui/statoblast', 'build:tests'), outputs: ['ui/statoblast/js/tests'] },
			workers: packageTask('ui/statoblast', 'build:workers'),
			typecheck: { ...packageTask('ui/statoblast', 'build'), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json', '--noEmit'] },
			audit: packageAuditTask('ui/statoblast', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/statoblast'),
		},
		generatedDirectories: ['ui/statoblast/js', 'ui/statoblast/dist', 'ui/statoblast/vendor'],
		ci: { scope: 'core', artifactOutputs: ['ui/statoblast/js', 'ui/statoblast/dist'] },
	},
	{
		id: 'ui-trading',
		path: 'ui/trading',
		type: 'ui-app',
		dependencies: ['shared', 'ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain'],
		tasks: {
			setup: packageInstallTask('ui/trading'),
			build: { ...packageTask('ui/trading', 'build', { groups: ['ui'], outputs: ['ui/trading/js'] }), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json'] },
			test: packageTask('ui/trading', 'test'),
			vendor: { ...packageTask('ui/trading', 'vendor', { cacheInputs: [...packageInputs('ui/trading'), 'tooling/ui/bundlerPaths.mts', 'tooling/ui/vendor.mts'] }), outputs: ['ui/trading/vendor'] },
			'test-build': { ...packageTask('ui/trading', 'build:tests'), outputs: ['ui/trading/js/tests'] },
			workers: packageTask('ui/trading', 'build:workers'),
			typecheck: { ...packageTask('ui/trading', 'build'), command: ['bun', 'x', 'tsc', '--project', 'tsconfig.json', '--noEmit'] },
			knip: rootTask(['bun', 'x', 'knip', '--production', '--workspace', 'ui/trading', '--include', 'files'], ['knip.json', 'ui/trading/**']),
			audit: packageAuditTask('ui/trading', ['core-audit']),
			'dependency-update': sharedDependencyTask('ui/trading'),
		},
		generatedDirectories: ['ui/trading/js', 'ui/trading/dist', 'ui/trading/vendor'],
		ci: { scope: 'core', artifactOutputs: ['ui/trading/js', 'ui/trading/dist'] },
	},
	{
		id: 'bot-shared',
		path: 'bots/shared',
		type: 'library',
		dependencies: ['shared'],
		tasks: {
			setup: packageInstallTask('bots/shared'),
			test: packageTask('bots/shared', 'test'),
			check: packageTask('bots/shared', 'check'),
			lint: packageTask('bots/shared', 'check'),
			typecheck: packageTask('bots/shared', 'typecheck'),
			audit: { ...packageTask('bots/shared', 'audit'), command: botAudit },
			'dependency-update': sharedDependencyTask('bots/shared'),
		},
		generatedDirectories: [],
		ci: { scope: 'bot-shared', componentName: 'bot-shared' },
	},
	{
		id: 'chaos',
		path: 'bots/chaos',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: {
			setup: packageInstallTask('bots/chaos'),
			test: packageTask('bots/chaos', 'test'),
			check: packageTask('bots/chaos', 'check'),
			lint: packageTask('bots/chaos', 'check'),
			typecheck: packageTask('bots/chaos', 'typecheck'),
			audit: { ...packageTask('bots/chaos', 'audit'), command: botAudit },
			'dependency-update': sharedDependencyTask('bots/chaos'),
		},
		generatedDirectories: [],
		ci: { scope: 'chaos', componentName: 'chaos', requiresContractArtifacts: true },
	},
	{
		id: 'arbitrager',
		path: 'bots/open-oracle-arbitrager',
		type: 'bot',
		dependencies: ['shared', 'bot-shared', 'contracts'],
		tasks: {
			setup: packageInstallTask('bots/open-oracle-arbitrager'),
			test: packageTask('bots/open-oracle-arbitrager', 'test'),
			check: packageTask('bots/open-oracle-arbitrager', 'check'),
			lint: packageTask('bots/open-oracle-arbitrager', 'check'),
			typecheck: packageTask('bots/open-oracle-arbitrager', 'typecheck'),
			audit: { ...packageTask('bots/open-oracle-arbitrager', 'audit'), command: botAudit },
			'dependency-update': sharedDependencyTask('bots/open-oracle-arbitrager'),
		},
		generatedDirectories: [],
		generatedFiles: ['bots/open-oracle-arbitrager/src/contracts/artifacts.generated.ts'],
		ci: { scope: 'arbitrager', componentName: 'arbitrager', requiresContractArtifacts: true },
	},
	{
		id: 'liquidator',
		path: 'bots/liquidator',
		type: 'bot',
		dependencies: ['bot-shared', 'contracts'],
		tasks: {
			setup: packageInstallTask('bots/liquidator'),
			test: packageTask('bots/liquidator', 'test'),
			check: packageTask('bots/liquidator', 'check'),
			lint: packageTask('bots/liquidator', 'check'),
			typecheck: packageTask('bots/liquidator', 'typecheck'),
			audit: { ...packageTask('bots/liquidator', 'audit'), command: botAudit },
			'dependency-update': sharedDependencyTask('bots/liquidator'),
		},
		generatedDirectories: [],
		ci: { scope: 'liquidator', componentName: 'liquidator', requiresContractArtifacts: true },
	},
	{
		id: 'augur-scan',
		path: 'augurScan',
		type: 'service',
		dependencies: ['shared'],
		tasks: {
			setup: packageInstallTask('augurScan'),
			build: packageTask('augurScan', 'build', { outputs: ['augurScan/dist'] }),
			test: packageTask('augurScan', 'test'),
			check: packageTask('augurScan', 'check'),
			lint: packageTask('augurScan', 'check'),
			typecheck: packageTask('augurScan', 'typecheck'),
			audit: { ...packageTask('augurScan', 'audit'), command: augurScanAudit },
			'dependency-update': sharedDependencyTask('augurScan'),
			integration: { ...packageTask('augurScan', 'test:integration'), inputs: ['shared/**', 'augurScan/schema.sql', 'augurScan/migrations/**', 'augurScan/config/**', 'augurScan/src/**', 'augurScan/tests/**', 'augurScan/scripts/**', 'augurScan/package.json', 'augurScan/bun.lock', 'augurScan/tsconfig.json'] },
		},
		generatedDirectories: ['augurScan/dist'],
		ci: { scope: 'augur-scan', componentName: 'augur-scan' },
	},
	{
		id: 'docs',
		path: 'docs',
		type: 'documentation',
		dependencies: ['contracts'],
		tasks: { check: rootTask(['bun', 'run', 'docs:check'], ['docs/**', 'solidity/contracts/**']) },
		generatedDirectories: ['docs/assets/js'],
		generatedFiles: ['docs/reference/contracts.html'],
		ci: { scope: 'docs' },
	},
	{ id: 'reth', path: 'reth', type: 'service', dependencies: [], tasks: {}, generatedDirectories: [], ci: { scope: 'infrastructure' } },
	{ id: 'testnetwork', path: 'testnetwork', type: 'service', dependencies: ['contracts'], tasks: {}, generatedDirectories: [], ci: { scope: 'infrastructure' } },
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
		for (const taskName of projectTaskNames) {
			const task = project.tasks[taskName]
			if (task === undefined) continue
			if (task.command.length === 0) throw new Error(`${project.id} ${taskName} command must not be empty`)
			if (task.command.some(argument => argument.trim() === '')) throw new Error(`${project.id} ${taskName} command arguments must not be blank`)
			if (task.cwd === '' || task.cwd.startsWith('/') || task.cwd.split('/').includes('..')) throw new Error(`${project.id} ${taskName} has invalid cwd ${task.cwd}`)
			for (const [field, entries] of [
				['inputs', task.inputs],
				['outputs', task.outputs ?? []],
				['cache inputs', task.cacheInputs ?? []],
				['environment', task.requiredEnvironment ?? []],
				['groups', task.groups ?? []],
			] as const)
				if (entries.some(entry => entry.trim() === '')) throw new Error(`${project.id} ${taskName} ${field} must not contain blank entries`)
		}
		if ((project.generatedDirectories ?? []).some(entry => entry.trim() === '')) throw new Error(`${project.id} generated directories must not contain blank entries`)
		if ((project.generatedFiles ?? []).some(entry => entry.trim() === '')) throw new Error(`${project.id} generated files must not contain blank entries`)
		if (project.ci?.componentName !== undefined && project.tasks.check === undefined) throw new Error(`${project.id} has a component CI route without a check task`)
	}
	for (const project of registry)
		for (const dependency of project.dependencies) {
			if (!ids.has(dependency)) throw new Error(`${project.id} depends on unknown project ${dependency}`)
			if (dependency === project.id) throw new Error(`${project.id} cannot depend on itself`)
		}
	topologicallySortedProjects(registry)
}

const wildcardPrefix = (entry: string) => entry.split(/[*?[\]{}]/u, 1)[0] ?? ''
const resolveRegistryPath = (repositoryRoot: string, entry: string) => path.resolve(repositoryRoot, wildcardPrefix(entry))

export function validateProjectRegistryFiles(repositoryRoot = path.resolve(import.meta.dir, '../..'), registry: readonly Project[] = projects): void {
	validateProjectRegistry(registry)
	const packagesByPath = new Map(registry.map(project => [path.resolve(repositoryRoot, project.path), project]))
	for (const project of registry) {
		const projectPath = path.resolve(repositoryRoot, project.path)
		if (!existsSync(projectPath)) throw new Error(`${project.id} path does not exist: ${project.path}`)
		const manifestPath = path.join(projectPath, 'package.json')
		if (existsSync(manifestPath)) {
			const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
			if (typeof manifest !== 'object' || manifest === null) throw new Error(`${project.id} package manifest must contain an object`)
			const localDependencyIds = new Set<string>()
			for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
				const dependencies = Reflect.get(manifest, field)
				if (typeof dependencies !== 'object' || dependencies === null) continue
				for (const value of Object.values(dependencies)) {
					if (typeof value !== 'string' || !value.startsWith('file:')) continue
					const dependencyPath = path.resolve(projectPath, value.slice('file:'.length))
					const dependency = packagesByPath.get(dependencyPath)
					if (dependency === undefined) throw new Error(`${project.id} has an unregistered local dependency at ${value}`)
					localDependencyIds.add(dependency.id)
				}
			}
			for (const dependencyId of localDependencyIds) if (!project.dependencies.includes(dependencyId)) throw new Error(`${project.id} is missing direct local dependency ${dependencyId}`)
		}
		const generated = [...project.generatedDirectories, ...(project.generatedFiles ?? [])]
		for (const taskName of projectTaskNames) {
			const task = project.tasks[taskName]
			if (task === undefined) continue
			if (!existsSync(path.resolve(repositoryRoot, task.cwd))) throw new Error(`${project.id} ${taskName} cwd does not exist: ${task.cwd}`)
			for (const input of [...task.inputs, ...(task.cacheInputs ?? [])]) {
				const inputPrefix = resolveRegistryPath(repositoryRoot, input)
				if (!existsSync(inputPrefix) && !existsSync(path.dirname(inputPrefix))) throw new Error(`${project.id} ${taskName} input has no existing path prefix: ${input}`)
			}
			for (const output of task.outputs ?? []) {
				const owned = generated.some(generatedPath => output === generatedPath || output.startsWith(`${generatedPath}/`))
				if (!owned) throw new Error(`${project.id} ${taskName} output is not declared as generated: ${output}`)
			}
		}
	}
}

export function taskProjects(taskName: ProjectTaskName, registry: readonly Project[] = projects): Project[] {
	return topologicallySortedProjects(registry).filter(project => project.tasks[taskName] !== undefined)
}

export function projectsInTaskGroup(taskName: ProjectTaskName, group: string, registry: readonly Project[] = projects): Project[] {
	return taskProjects(taskName, registry).filter(project => project.tasks[taskName]?.groups?.includes(group) === true)
}

export function projectDependencyClosure(projectIds: readonly string[], registry: readonly Project[] = projects): Project[] {
	validateProjectRegistry(registry)
	const requested = new Set(projectIds)
	let changed = true
	while (changed) {
		changed = false
		for (const project of registry) {
			if (!requested.has(project.id)) continue
			for (const dependency of project.dependencies)
				if (!requested.has(dependency)) {
					requested.add(dependency)
					changed = true
				}
		}
	}
	return topologicallySortedProjects(registry).filter(project => requested.has(project.id))
}

export function projectForPath(filePath: string, registry: readonly Project[] = projects): Project | undefined {
	return ownerProject(filePath, registry)
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

function ownerProject(filePath: string, registry: readonly Project[] = projects): Project | undefined {
	return [...registry]
		.filter(project => project.path !== '.')
		.sort((left, right) => right.path.length - left.path.length)
		.find(project => filePath === project.path || filePath.startsWith(`${project.path}/`))
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

export function ciScopes(registry: readonly Project[] = projects): string[] {
	return [...new Set(registry.flatMap(project => (project.ci === undefined ? [] : [project.ci.scope])))]
}

export function generatedOutputsForTaskGroup(taskName: ProjectTaskName, group: string, registry: readonly Project[] = projects): string[] {
	return projectsInTaskGroup(taskName, group, registry).flatMap(project => project.tasks[taskName]?.outputs ?? [])
}

const globExpression = (pattern: string): RegExp => {
	let expression = '^'
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index]
		if (character === '*' && pattern[index + 1] === '*') {
			expression += '.*'
			index++
		} else if (character === '*') expression += '[^/]*'
		else if (character === '?') expression += '[^/]'
		else expression += character?.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&') ?? ''
	}
	return new RegExp(`${expression}$`, 'u')
}

export function taskInputMatches(taskName: ProjectTaskName, filePath: string, project: Project): boolean {
	return project.tasks[taskName]?.inputs.some(input => globExpression(input).test(filePath)) === true
}

export function uiArtifactOutputs(registry: readonly Project[] = projects): string[] {
	return registry.flatMap(project => project.ci?.artifactOutputs ?? [])
}
