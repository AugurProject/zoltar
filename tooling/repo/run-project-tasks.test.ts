import { expect, test } from 'bun:test'
import { createProjectTaskPlan } from './run-project-tasks.mts'
import type { Project } from './projects.ts'

const registry: readonly Project[] = [
	{ id: 'app', path: 'app', type: 'ui-app', dependencies: ['domain'], tasks: { build: { command: ['bun', 'run', 'build'], cwd: 'app', inputs: ['app/**'] } }, generatedDirectories: [] },
	{ id: 'domain', path: 'domain', type: 'ui-domain', dependencies: [], tasks: { build: { command: ['bun', 'run', 'build'], cwd: 'domain', inputs: ['domain/**'] } }, generatedDirectories: [] },
]

test('project task plans preserve dependency order and explicit working directories', () => {
	expect(createProjectTaskPlan('build', ['app', 'domain'], registry)).toEqual([
		{ command: ['bun', 'run', 'build'], cwd: 'domain', projectId: 'domain' },
		{ command: ['bun', 'run', 'build'], cwd: 'app', projectId: 'app' },
	])
})

test('project task plans reject unknown projects and unsupported tasks', () => {
	expect(() => createProjectTaskPlan('build', ['missing'], registry)).toThrow('Unknown project')
	expect(() => createProjectTaskPlan('test', ['app'], registry)).toThrow('does not support test')
})
