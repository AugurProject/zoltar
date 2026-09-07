import path from 'node:path'
import { componentProjects } from '../repo/projects.ts'

const packageName = process.argv[2]
const repositoryRoot = path.resolve(import.meta.dir, '../..')
const definitions = new Map(
	componentProjects().map(project => {
		const ci = project.ci
		if (ci?.componentName === undefined || ci.commands === undefined) throw new Error(`Component ${project.id} is missing CI execution metadata`)
		return [ci.componentName, { directory: project.path, commands: ci.commands }]
	}),
)

if (packageName === undefined) throw new Error('Unknown component package: (missing)')
const definition = definitions.get(packageName)
if (definition === undefined) throw new Error(`Unknown component package: ${packageName}`)
const cwd = path.join(repositoryRoot, definition.directory)
for (const command of definition.commands) {
	console.log(`component-ci(${packageName}): ${command.join(' ')}`)
	const child = Bun.spawn({ cmd: [...command], cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await child.exited
	if (exitCode !== 0) process.exit(exitCode)
}
