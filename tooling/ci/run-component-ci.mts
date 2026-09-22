import { componentProjects, type Project } from '../repo/projects.ts'
import { runTaskProcess } from '../repo/task-process.mts'

export type ComponentCiPlanEntry = {
	readonly command: readonly string[]
	readonly cwd: string
	/** Dependency audits query the package registry, so registry connection failures are retried instead of failing the job. */
	readonly retryTransientNetworkErrors?: true
}

export function createComponentCiPlan(packageName: string, registry?: readonly Project[]): ComponentCiPlanEntry[] {
	const definitions = new Map(
		componentProjects(registry).map(project => {
			const ci = project.ci
			const check = project.tasks.check
			const audit = project.tasks.audit
			if (ci?.componentName === undefined || check === undefined || audit === undefined) throw new Error(`Component ${project.id} is missing check or audit task metadata`)
			const independentTasks = (['typecheck', 'build', 'test'] as const).flatMap(name => {
				const task = project.tasks[name]
				return task !== undefined && check.covers?.includes(name) !== true ? [task] : []
			})
			const commands: ComponentCiPlanEntry[] = [...independentTasks, check].map(task => ({ command: task.command, cwd: task.cwd }))
			commands.push({ command: audit.command, cwd: audit.cwd, retryTransientNetworkErrors: true })
			return [ci.componentName, commands] as const
		}),
	)
	const plan = definitions.get(packageName)
	if (plan === undefined) throw new Error(`Unknown component package: ${packageName}`)
	return plan
}

export async function runComponentCiCommand(args: readonly string[] = process.argv.slice(2)): Promise<void> {
	const packageName = args[0]
	if (packageName === undefined) throw new Error('Unknown component package: (missing)')
	for (const task of createComponentCiPlan(packageName)) {
		console.log(`component-ci(${packageName}): ${task.command.join(' ')}`)
		const exitCode = await runTaskProcess({ command: task.command, cwd: task.cwd, retryTransientNetworkErrors: task.retryTransientNetworkErrors === true })
		if (exitCode !== 0) process.exit(exitCode)
	}
}

if (import.meta.main) await runComponentCiCommand()
