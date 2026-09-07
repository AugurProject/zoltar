import { expect, test } from 'bun:test'
import { affectedProjects, componentProjects, projects, repositoryTaskProjects, topologicallySortedProjects, validateProjectRegistry, type Project } from './projects.ts'

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

test('registry tasks carry explicit working directories and canonical root task groups', () => {
	for (const project of projects)
		for (const task of Object.values(project.tasks)) {
			if (task === undefined) continue
			expect(task.cwd === '.' || task.cwd === project.path).toBe(true)
		}
	expect(repositoryTaskProjects.setup).toContain('ui-trading')
	expect(repositoryTaskProjects.build.at(-1)).toBe('ui-trading')
	expect(repositoryTaskProjects.test).toContain('chaos')
	expect(repositoryTaskProjects['dependency-update']).toContain('ui-core')
})
