import { componentProjects } from './projects.ts'
import { runProjectTaskPlan } from './run-project-tasks.mts'

export function packageFormatPlan(command: string | undefined) {
	if (command !== 'format' && command !== 'format:check') throw new Error('Expected format or format:check')
	return componentProjects().map(project => ({ command: ['bun', 'run', command], cwd: project.path, projectId: project.id }))
}

if (import.meta.main) {
	const exitCode = await runProjectTaskPlan(packageFormatPlan(process.argv[2]))
	if (exitCode !== 0) process.exit(exitCode)
}
