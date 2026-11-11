import { getChangedFiles } from './changed-files.mts'
import { classifyCiChange, isDocumentationChange } from '../ci/classify-ci-change.mts'
import { affectedProjects, projects, projectTaskNames, taskProjects, type ProjectTaskName } from './projects.ts'
import { createProjectTaskPlan, runProjectTaskPlan, type ProjectTaskPlanEntry } from './run-project-tasks.mts'

export function affectedCheckSelection(filePaths: readonly string[]) {
	const classification = classifyCiChange(filePaths)
	if (classification.forcedFull) return projects
	const runtimePaths = filePaths.filter(filePath => !isDocumentationChange(filePath))
	const documentationPaths = filePaths.some(isDocumentationChange) ? projects.filter(project => project.type === 'documentation').map(project => project.path) : []
	return affectedProjects([...runtimePaths, ...documentationPaths], projects)
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
	const args = process.argv.slice(2)
	if (args[0] === '--') args.shift()
	if (args.some(argument => argument !== '--dry-run' && argument !== '--help')) throw new Error('Usage: bun run check:affected -- [--dry-run | --help]')
	if (args.includes('--help')) {
		console.log(
			[
				'Usage: bun run check:affected -- [--dry-run | --help]',
				'',
				'Select checks from committed changes since the merge base with origin/main, worktree changes and untracked files.',
				'--dry-run prints the ordered plan as JSON without executing checks.',
				'Each entry includes projectId, cwd and command.',
				'The plan follows project ownership and dependent projects; inspect relevant imports and test boundaries before relying on it.',
				'Use bun run test:plan for additional specialized test suggestions.',
			].join('\n'),
		)
		return
	}
	const plan = affectedCheckPlan(getChangedFiles())
	if (args.includes('--dry-run')) {
		console.log(JSON.stringify(plan, undefined, 2))
		return
	}
	const exitCode = await runProjectTaskPlan(plan)
	if (exitCode !== 0) process.exit(exitCode)
}

if (!checkTasks.every(taskName => projectTaskNames.includes(taskName))) throw new Error('Affected check tasks must be registered project tasks')
if (taskProjects('setup').length === 0) throw new Error('The project registry must own setup tasks')
if (import.meta.main) await main()
