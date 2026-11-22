import { projectDependencyClosure, projects, projectsInTaskGroup, projectTaskNames, taskProjects, topologicallySortedProjects, validateProjectRegistry, type Project, type ProjectTaskName } from './projects.ts'
import { repositoryRoot as defaultRepositoryRoot } from './root.mts'
import { runTaskProcess } from './task-process.mts'

export type ProjectTaskPlanEntry = {
	readonly command: readonly string[]
	readonly cwd: string
	readonly projectId: string
	/** Dependency audits query the package registry, so registry connection failures are retried instead of failing the run. */
	readonly retryTransientNetworkErrors?: true
}

export function createProjectTaskPlan(taskName: ProjectTaskName, requestedProjectIds: readonly string[] | undefined = undefined, registry: readonly Project[] = projects): ProjectTaskPlanEntry[] {
	validateProjectRegistry(registry)
	const requested = new Set(requestedProjectIds ?? taskProjects(taskName, registry).map(project => project.id))
	for (const projectId of requested) {
		if (!registry.some(project => project.id === projectId)) throw new Error(`Unknown project: ${projectId}`)
	}
	const selectedProjects = topologicallySortedProjects(registry).filter(project => requested.has(project.id))
	const orderedProjects = taskName === 'setup' && requestedProjectIds === undefined ? [...selectedProjects.filter(project => project.id === 'repository'), ...selectedProjects.filter(project => project.id !== 'repository')] : selectedProjects
	const entries = orderedProjects.map(project => {
		const task = project.tasks[taskName]
		if (task === undefined) throw new Error(`${project.id} does not support ${taskName}`)
		return { command: task.command, cwd: task.cwd, projectId: project.id, ...(taskName === 'audit' ? { retryTransientNetworkErrors: true as const } : {}) }
	})
	return taskName === 'setup' ? entries.filter((entry, index) => entries.findIndex(other => other.cwd === entry.cwd && JSON.stringify(other.command) === JSON.stringify(entry.command)) === index) : entries
}

export async function runProjectTaskPlan(plan: readonly ProjectTaskPlanEntry[], repositoryRoot = defaultRepositoryRoot): Promise<number> {
	for (const entry of plan) {
		console.log(`project:${entry.projectId}: ${entry.command.join(' ')}`)
		const exitCode = await runTaskProcess({ command: entry.command, cwd: entry.cwd, repositoryRoot, retryTransientNetworkErrors: entry.retryTransientNetworkErrors === true })
		if (exitCode !== 0) return exitCode
	}
	return 0
}

/**
 * Resolves CLI selection arguments to the project IDs a task runs for, or undefined for the task's default membership.
 * Positional project IDs may be combined with one registry filter so that a single plan, and its setup deduplication,
 * covers both, for example `setup repository --project-path augurScan --dependencies`. With a filter, `--dependencies`
 * expands only the filtered project; without one, it expands the positional IDs.
 */
export function selectProjectIdsFromArguments(taskName: ProjectTaskName, args: readonly string[], registry: readonly Project[] = projects): string[] | undefined {
	const filterOptions: readonly string[] = ['--group', '--project-path', '--path-prefix']
	const [groupIndex = -1, pathIndex = -1, prefixIndex = -1] = filterOptions.map(option => args.indexOf(option))
	const filterIndexes = [groupIndex, pathIndex, prefixIndex].filter(index => index >= 0)
	if (filterIndexes.length > 1) throw new Error('Select only one registry filter')
	const withDependencies = args.includes('--dependencies')
	const filterValueIndexes = new Set(filterIndexes.map(index => index + 1))
	const projectIds = args.filter((argument, index) => argument !== '--dependencies' && !filterOptions.includes(argument) && !filterValueIndexes.has(index))
	const unknownProjectId = projectIds.find(projectId => !registry.some(project => project.id === projectId))
	if (unknownProjectId !== undefined) throw new Error(`Unknown project: ${unknownProjectId}`)
	const expand = (ids: readonly string[], includeDependencies: boolean) => {
		createProjectTaskPlan(taskName, ids, registry)
		return includeDependencies ? projectDependencyClosure(ids, registry) : registry.filter(project => ids.includes(project.id))
	}
	let filtered: readonly Project[] = []
	if (groupIndex >= 0) {
		const group = args[groupIndex + 1]
		if (group === undefined) throw new Error('--group requires a task group')
		filtered = projectsInTaskGroup(taskName, group, registry)
	} else if (pathIndex >= 0) {
		const projectPath = args[pathIndex + 1]
		if (projectPath === undefined) throw new Error('--project-path requires a registered path')
		const selectedProject = registry.find(project => project.path === projectPath)
		if (selectedProject === undefined) throw new Error(`Unknown project path: ${projectPath}`)
		filtered = expand([selectedProject.id], withDependencies)
	} else if (prefixIndex >= 0) {
		const prefix = args[prefixIndex + 1]
		if (prefix === undefined) throw new Error('--path-prefix requires a path prefix')
		filtered = registry.filter(project => project.path.startsWith(prefix))
	} else if (projectIds.length === 0) {
		return undefined
	}
	const selected = [...filtered, ...(projectIds.length > 0 ? expand(projectIds, withDependencies && filterIndexes.length === 0) : [])]
	const selectedIds = [...new Set(selected.filter(project => project.tasks[taskName] !== undefined).map(project => project.id))]
	if (selectedIds.length === 0) throw new Error(`No projects support ${taskName} for the requested selection`)
	return selectedIds
}

if (import.meta.main) {
	const [taskName, ...args] = process.argv.slice(2)
	if (!projectTaskNames.includes(taskName as ProjectTaskName)) throw new Error(`Task must be one of: ${projectTaskNames.join(', ')}`)
	const exitCode = await runProjectTaskPlan(createProjectTaskPlan(taskName as ProjectTaskName, selectProjectIdsFromArguments(taskName as ProjectTaskName, args)))
	if (exitCode !== 0) process.exit(exitCode)
}
