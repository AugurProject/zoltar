import { getChangedFiles } from './changed-files.mts'
import { classifyCiChange } from '../ci/classify-ci-change.mts'
import { affectedProjects, projects, projectTaskNames, taskProjects, type ProjectTaskName } from './projects.ts'
import { createProjectTaskPlan, runProjectTaskPlan } from './run-project-tasks.mts'

export function affectedCheckSelection(filePaths: readonly string[]) {
	const classification = classifyCiChange(filePaths)
	return classification.forcedFull ? projects : affectedProjects(filePaths, projects)
}

const checkTasks = ['typecheck', 'lint', 'test', 'check'] satisfies readonly ProjectTaskName[]

async function main() {
	const affected = affectedCheckSelection(getChangedFiles())
	for (const taskName of checkTasks) {
		const projectIds = affected
			.filter(project => project.tasks[taskName] !== undefined)
			.filter(project => taskName !== 'check' || project.type === 'documentation')
			.map(project => project.id)
		if (projectIds.length === 0) continue
		const exitCode = await runProjectTaskPlan(createProjectTaskPlan(taskName, projectIds))
		if (exitCode !== 0) process.exit(exitCode)
	}
}

if (!checkTasks.every(taskName => projectTaskNames.includes(taskName))) throw new Error('Affected check tasks must be registered project tasks')
if (taskProjects('setup').length === 0) throw new Error('The project registry must own setup tasks')
if (import.meta.main) await main()
