import { expect, test } from 'bun:test'
import { createProjectTaskPlan } from './run-project-tasks.mts'
import { type Project } from './projects.ts'

const registry: readonly Project[] = [
	{ id: 'app', path: 'app', type: 'ui-app', dependencies: ['domain'], tasks: { build: { command: ['bun', 'run', 'build'], cwd: 'app', inputs: ['app/**'] } }, generatedDirectories: [] },
	{ id: 'domain', path: 'domain', type: 'ui-library', dependencies: [], tasks: { build: { command: ['bun', 'run', 'build'], cwd: 'domain', inputs: ['domain/**'] } }, generatedDirectories: [] },
]

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

test('workspace setup installs once even when several projects are selected', () => {
	expect(createProjectTaskPlan('setup')).toHaveLength(1)
	expect(createProjectTaskPlan('setup', ['ui-core', 'ui-trading', 'repository'])).toHaveLength(1)
	expect(createProjectTaskPlan('setup')[0]?.command).toEqual(['bun', './tooling/repo/install-frozen.mts'])
})

test('project task plans reject unknown projects and unsupported tasks', () => {
	expect(() => createProjectTaskPlan('build', ['missing'], registry)).toThrow('Unknown project')
	expect(() => createProjectTaskPlan('test', ['app'], registry)).toThrow('does not support test')
})
