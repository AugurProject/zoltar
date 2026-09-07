import { getChangedFiles } from './changed-files.mts'
import { affectedProjects, projects, projectTaskNames, type ProjectTaskName } from './projects.ts'
import { createProjectTaskPlan, runProjectTaskPlan } from './run-project-tasks.mts'

const affected = affectedProjects(getChangedFiles(), projects)
const checkTasks = ['typecheck', 'lint', 'test'] satisfies readonly ProjectTaskName[]

for (const taskName of checkTasks) {
	const projectIds = affected.filter(project => project.tasks[taskName] !== undefined).map(project => project.id)
	if (projectIds.length === 0) continue
	const exitCode = await runProjectTaskPlan(createProjectTaskPlan(taskName, projectIds))
	if (exitCode !== 0) process.exit(exitCode)
}

if (!checkTasks.every(taskName => projectTaskNames.includes(taskName))) throw new Error('Affected check tasks must be registered project tasks')
