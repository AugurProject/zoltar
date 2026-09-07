import { expect, test } from 'bun:test'
import { affectedProjects, componentProjects, projectDependencyClosure, projects, projectsInTaskGroup, projectTaskNames, taskProjects, topologicallySortedProjects, validateProjectRegistry, type Project } from './projects.ts'

const project = (id: string, dependencies: readonly string[] = []): Project => ({ id, path: id, type: 'library', dependencies, tasks: {}, generatedDirectories: [] })

test('orders dependencies before their consumers', () => {
	expect(topologicallySortedProjects([project('app', ['domain']), project('domain', ['shared']), project('shared')]).map(entry => entry.id)).toEqual(['shared', 'domain', 'app'])
})

test('rejects cycles, duplicates, self references, and unknown dependencies', () => {
	expect(() => validateProjectRegistry([project('a', ['b']), project('b', ['a'])])).toThrow('cycle')
	expect(() => validateProjectRegistry([project('a'), { ...project('b'), id: 'a' }])).toThrow('Duplicate project id')
	expect(() => validateProjectRegistry([project('a', ['a'])])).toThrow('cannot depend on itself')
	expect(() => validateProjectRegistry([project('a', ['missing'])])).toThrow('unknown project')
})

test('calculates affected projects through the complete dependent closure', () => {
	const registry = [project('shared'), project('domain', ['shared']), project('app', ['domain']), project('other')]
	expect(affectedProjects(['shared/source.ts'], registry).map(entry => entry.id)).toEqual(['shared', 'domain', 'app'])
	expect(affectedProjects(['other/source.ts'], registry).map(entry => entry.id)).toEqual(['other'])
})

test('registry records every independently checked component, including chaos', () => {
	expect(componentProjects().map(entry => entry.id)).toEqual(['bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'])
	expect(() => validateProjectRegistry(projects)).not.toThrow()
})

test('registry tasks carry explicit working directories and derive canonical task groups', () => {
	for (const project of projects)
		for (const taskName of projectTaskNames) {
			const task = project.tasks[taskName]
			if (task === undefined) continue
			expect(task.cwd === '.' || task.cwd === project.path).toBe(true)
		}
	expect(taskProjects('setup').map(project => project.id)).toContain('ui-trading')
	expect(projectsInTaskGroup('build', 'ui').at(-1)?.id).toBe('ui-trading')
	expect(taskProjects('test').map(project => project.id)).toContain('chaos')
	expect(taskProjects('dependency-update').map(project => project.id)).toContain('ui-core')
})

test('dependency closure follows registry edges without hard-coded package lists', () => {
	expect(projectDependencyClosure(['chaos']).map(project => project.id)).toEqual(['shared', 'contracts', 'bot-shared', 'chaos'])
})
