import path from 'node:path'
import { componentProjects, type Project } from '../repo/projects.ts'

const repositoryRoot = path.resolve(import.meta.dir, '../..')

export type ComponentCiPlanEntry = {
	readonly command: readonly string[]
	readonly cwd: string
}

export function createComponentCiPlan(packageName: string, registry?: readonly Project[]): ComponentCiPlanEntry[] {
	const definitions = new Map(
		componentProjects(registry).map(project => {
			const ci = project.ci
			const test = project.tasks.test
			const check = project.tasks.check
			const audit = project.tasks.audit
			if (ci?.componentName === undefined || check === undefined || audit === undefined) throw new Error(`Component ${project.id} is missing check or audit task metadata`)
			const commands = [...(test !== undefined && check.covers?.includes('test') !== true ? [test] : []), check, audit]
			return [ci.componentName, commands] as const
		}),
	)
	const plan = definitions.get(packageName)
	if (plan === undefined) throw new Error(`Unknown component package: ${packageName}`)
	return plan
}

if (import.meta.main) {
	const packageName = process.argv[2]
	if (packageName === undefined) throw new Error('Unknown component package: (missing)')
	for (const task of createComponentCiPlan(packageName)) {
		console.log(`component-ci(${packageName}): ${task.command.join(' ')}`)
		const child = Bun.spawn({ cmd: [...task.command], cwd: path.join(repositoryRoot, task.cwd), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
		const exitCode = await child.exited
		if (exitCode !== 0) process.exit(exitCode)
	}
}
