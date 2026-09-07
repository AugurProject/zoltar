import path from 'node:path'
import { projects, projectTaskNames, repositoryTaskProjects, topologicallySortedProjects, validateProjectRegistry, type Project, type ProjectTaskName } from './projects.ts'

export type ProjectTaskPlanEntry = {
	readonly command: readonly string[]
	readonly cwd: string
	readonly projectId: string
}

export function createProjectTaskPlan(taskName: ProjectTaskName, requestedProjectIds: readonly string[] = repositoryTaskProjects[taskName], registry: readonly Project[] = projects): ProjectTaskPlanEntry[] {
	validateProjectRegistry(registry)
	const requested = new Set(requestedProjectIds)
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
	const taskName = process.argv[2]
	if (!projectTaskNames.includes(taskName as ProjectTaskName)) throw new Error(`Task must be one of: ${projectTaskNames.join(', ')}`)
	const exitCode = await runProjectTaskPlan(createProjectTaskPlan(taskName as ProjectTaskName, process.argv.slice(3).length === 0 ? undefined : process.argv.slice(3)))
	if (exitCode !== 0) process.exit(exitCode)
}
