import path from 'node:path'
import { componentProjects } from '../repo/projects.ts'

const packageName = process.argv[2]
const repositoryRoot = path.resolve(import.meta.dir, '../..')
const definitions = new Map(
	componentProjects().map(project => {
		const ci = project.ci
		const check = project.tasks.check
		const audit = project.tasks.audit
		if (ci?.componentName === undefined || check === undefined || audit === undefined) throw new Error(`Component ${project.id} is missing check or audit task metadata`)
		return [ci.componentName, { commands: [check, audit] }]
	}),
)

if (packageName === undefined) throw new Error('Unknown component package: (missing)')
const definition = definitions.get(packageName)
if (definition === undefined) throw new Error(`Unknown component package: ${packageName}`)
for (const task of definition.commands) {
	console.log(`component-ci(${packageName}): ${task.command.join(' ')}`)
	const child = Bun.spawn({ cmd: [...task.command], cwd: path.join(repositoryRoot, task.cwd), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await child.exited
	if (exitCode !== 0) process.exit(exitCode)
}
