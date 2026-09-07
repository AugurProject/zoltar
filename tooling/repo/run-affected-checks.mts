import { getChangedFiles } from './changed-files.mts'
import { classifyCiChange } from '../ci/classify-ci-change.mts'
import { affectedProjects, projects, projectTaskNames, taskProjects, type ProjectTaskName } from './projects.ts'
import { createProjectTaskPlan, runProjectTaskPlan, type ProjectTaskPlanEntry } from './run-project-tasks.mts'

export function affectedCheckSelection(filePaths: readonly string[]) {
	const classification = classifyCiChange(filePaths)
	return classification.forcedFull ? projects : affectedProjects(filePaths, projects)
}

const checkTasks = ['typecheck', 'lint', 'test', 'check'] satisfies readonly ProjectTaskName[]

export function affectedCheckPlan(filePaths: readonly string[]): ProjectTaskPlanEntry[] {
	const affected = affectedCheckSelection(filePaths)
	const coveredByCheck = new Map(affected.flatMap(project => (project.tasks.check?.covers === undefined ? [] : [[project.id, new Set(project.tasks.check.covers)] as const])))
	return checkTasks.flatMap(taskName => {
		const projectIds = affected
			.filter(project => project.tasks[taskName] !== undefined)
			.filter(project => taskName === 'check' || coveredByCheck.get(project.id)?.has(taskName) !== true)
			.filter(project => taskName !== 'check' || project.type === 'documentation' || (project.tasks.check?.covers?.length ?? 0) > 0)
			.map(project => project.id)
		return createProjectTaskPlan(taskName, projectIds)
	})
}

async function main() {
	const exitCode = await runProjectTaskPlan(affectedCheckPlan(getChangedFiles()))
	if (exitCode !== 0) process.exit(exitCode)
}

if (!checkTasks.every(taskName => projectTaskNames.includes(taskName))) throw new Error('Affected check tasks must be registered project tasks')
if (taskProjects('setup').length === 0) throw new Error('The project registry must own setup tasks')
if (import.meta.main) await main()
