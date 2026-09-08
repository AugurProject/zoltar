import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'bun:test'
import { createProjectTaskPlan } from './run-project-tasks.mts'
import { projects, type Project } from './projects.ts'

const registry: readonly Project[] = [
	{ id: 'app', path: 'app', type: 'ui-app', dependencies: ['domain'], tasks: { build: { command: ['bun', 'run', 'build'], cwd: 'app', inputs: ['app/**'] } }, generatedDirectories: [] },
	{ id: 'domain', path: 'domain', type: 'ui-library', dependencies: [], tasks: { build: { command: ['bun', 'run', 'build'], cwd: 'domain', inputs: ['domain/**'] } }, generatedDirectories: [] },
]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

test('project task plans preserve dependency order and explicit working directories', () => {
	expect(createProjectTaskPlan('build', ['app', 'domain'], registry)).toEqual([
		{ command: ['bun', 'run', 'build'], cwd: 'domain', projectId: 'domain' },
		{ command: ['bun', 'run', 'build'], cwd: 'app', projectId: 'app' },
	])
})

test('project task plans derive their default membership from task support', () => {
	expect(createProjectTaskPlan('build', undefined, registry).map(entry => entry.projectId)).toEqual(['domain', 'app'])
})

test('full setup bootstraps the repository before dependency-ordered package setup', () => {
	const setupRegistry: readonly Project[] = [
		{
			id: 'repository',
			path: '.',
			type: 'repository',
			dependencies: ['app'],
			tasks: { setup: { command: ['bun', 'install'], cwd: '.', inputs: ['package.json'] } },
			generatedDirectories: [],
		},
		{ id: 'app', path: 'app', type: 'ui-app', dependencies: ['domain'], tasks: { setup: { command: ['bun', 'install'], cwd: 'app', inputs: ['app/package.json'] } }, generatedDirectories: [] },
		{ id: 'domain', path: 'domain', type: 'ui-library', dependencies: [], tasks: { setup: { command: ['bun', 'install'], cwd: 'domain', inputs: ['domain/package.json'] } }, generatedDirectories: [] },
	]

	expect(createProjectTaskPlan('setup', undefined, setupRegistry).map(entry => entry.projectId)).toEqual(['repository', 'domain', 'app'])
	expect(createProjectTaskPlan('setup', ['repository', 'app', 'domain'], setupRegistry).map(entry => entry.projectId)).toEqual(['domain', 'app', 'repository'])
})

test('the real full setup plan installs the root runtime before every Preact-consuming UI package', () => {
	const repositoryRoot = path.resolve(import.meta.dir, '../..')
	const preactConsumers = projects.filter(project => {
		if (!project.path.startsWith('ui/') || project.tasks.setup === undefined) return false
		const manifest: unknown = JSON.parse(readFileSync(path.join(repositoryRoot, project.path, 'package.json'), 'utf8'))
		if (!isRecord(manifest)) throw new Error(`${project.path}/package.json must contain an object`)
		return ['dependencies', 'devDependencies', 'optionalDependencies'].some(field => {
			const dependencies = manifest[field]
			return isRecord(dependencies) && ('preact' in dependencies || '@preact/signals' in dependencies)
		})
	})
	const planIds = createProjectTaskPlan('setup').map(entry => entry.projectId)
	const repositoryIndex = planIds.indexOf('repository')

	expect(preactConsumers.map(project => project.id)).toContain('ui-core')
	for (const project of preactConsumers) expect(repositoryIndex).toBeLessThan(planIds.indexOf(project.id))
})

test('project task plans reject unknown projects and unsupported tasks', () => {
	expect(() => createProjectTaskPlan('build', ['missing'], registry)).toThrow('Unknown project')
	expect(() => createProjectTaskPlan('test', ['app'], registry)).toThrow('does not support test')
})
