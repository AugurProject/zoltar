import path from 'node:path'
import { projectDependencyClosure, projects, projectsInTaskGroup, projectTaskNames, taskProjects, topologicallySortedProjects, validateProjectRegistry, type Project, type ProjectTaskName } from './projects.ts'

export type ProjectTaskPlanEntry = {
	readonly command: readonly string[]
	readonly cwd: string
	readonly projectId: string
}

export function createProjectTaskPlan(taskName: ProjectTaskName, requestedProjectIds: readonly string[] | undefined = undefined, registry: readonly Project[] = projects): ProjectTaskPlanEntry[] {
	validateProjectRegistry(registry)
	const requested = new Set(requestedProjectIds ?? taskProjects(taskName, registry).map(project => project.id))
	for (const projectId of requested) {
		if (!registry.some(project => project.id === projectId)) throw new Error(`Unknown project: ${projectId}`)
	}
	return topologicallySortedProjects(registry)
		.filter(project => requested.has(project.id))
		.map(project => {
			const task = project.tasks[taskName]
			if (task === undefined) throw new Error(`${project.id} does not support ${taskName}`)
			return { command: task.command, cwd: task.cwd, projectId: project.id }
		})
}

export async function runProjectTaskPlan(plan: readonly ProjectTaskPlanEntry[], repositoryRoot = path.resolve(import.meta.dir, '../..')): Promise<number> {
	for (const entry of plan) {
		console.log(`project:${entry.projectId}: ${entry.command.join(' ')}`)
		const child = Bun.spawn({ cmd: [...entry.command], cwd: path.join(repositoryRoot, entry.cwd), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
		const exitCode = await child.exited
		if (exitCode !== 0) return exitCode
	}
	return 0
}

if (import.meta.main) {
	const [taskName, ...args] = process.argv.slice(2)
	if (!projectTaskNames.includes(taskName as ProjectTaskName)) throw new Error(`Task must be one of: ${projectTaskNames.join(', ')}`)
	const groupIndex = args.indexOf('--group')
	const pathIndex = args.indexOf('--project-path')
	const prefixIndex = args.indexOf('--path-prefix')
	const withDependencies = args.includes('--dependencies')
	if ([groupIndex, pathIndex, prefixIndex].filter(index => index >= 0).length > 1) throw new Error('Select only one registry filter')
	let selected: readonly Project[] | undefined
	if (groupIndex >= 0) {
		const group = args[groupIndex + 1]
		if (group === undefined) throw new Error('--group requires a task group')
		selected = projectsInTaskGroup(taskName as ProjectTaskName, group)
	} else if (pathIndex >= 0) {
		const projectPath = args[pathIndex + 1]
		if (projectPath === undefined) throw new Error('--project-path requires a registered path')
		const selectedProject = projects.find(project => project.path === projectPath)
		if (selectedProject === undefined) throw new Error(`Unknown project path: ${projectPath}`)
		selected = withDependencies ? projectDependencyClosure([selectedProject.id]) : [selectedProject]
	} else if (prefixIndex >= 0) {
		const prefix = args[prefixIndex + 1]
		if (prefix === undefined) throw new Error('--path-prefix requires a path prefix')
		selected = projects.filter(project => project.path.startsWith(prefix))
	} else {
		const projectIds = args.filter(argument => argument !== '--dependencies')
		if (projectIds.length > 0) selected = withDependencies ? projectDependencyClosure(projectIds) : projects.filter(project => projectIds.includes(project.id))
	}
	const selectedIds = selected?.filter(project => project.tasks[taskName as ProjectTaskName] !== undefined).map(project => project.id)
	const exitCode = await runProjectTaskPlan(createProjectTaskPlan(taskName as ProjectTaskName, selectedIds))
	if (exitCode !== 0) process.exit(exitCode)
}
