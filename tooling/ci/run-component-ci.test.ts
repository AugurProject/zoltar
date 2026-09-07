import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createComponentCiPlan } from './run-component-ci.mts'
import { projects, type Project } from '../repo/projects.ts'

const task = (script: string) => ({ command: ['bun', 'run', script], cwd: 'package', inputs: ['package/**'] })

const component = (checkCovers: readonly ('test' | 'lint')[]): Project => ({
	id: 'package',
	path: 'package',
	type: 'service',
	dependencies: [],
	tasks: {
		test: task('test'),
		check: { ...task('check'), covers: checkCovers },
		audit: task('audit'),
	},
	generatedDirectories: [],
	ci: { scope: 'package', componentName: 'package' },
})

test('component CI runs an independently declared test before check and audit', () => {
	expect(createComponentCiPlan('package', [component(['lint'])]).map(entry => entry.command)).toEqual([
		['bun', 'run', 'test'],
		['bun', 'run', 'check'],
		['bun', 'run', 'audit'],
	])
})

test('component CI does not duplicate tests covered by the check task', () => {
	expect(createComponentCiPlan('package', [component(['lint', 'test'])]).map(entry => entry.command)).toEqual([
		['bun', 'run', 'check'],
		['bun', 'run', 'audit'],
	])
})

test('registered AugurScan CI runs its complete non-database suite while bots avoid duplicate tests', () => {
	const augurScanPlan = createComponentCiPlan('augur-scan')
	expect(augurScanPlan[0]?.command).toEqual(['bun', 'run', 'test:ci'])
	expect(augurScanPlan.map(entry => entry.command.slice(0, 3))).toEqual([
		['bun', 'run', 'test:ci'],
		['bun', 'run', 'check'],
		['bun', 'audit', '--ignore'],
	])
	expect(createComponentCiPlan('chaos').map(entry => entry.command.slice(0, 3))).toEqual([
		['bun', 'run', 'check'],
		['bun', 'audit', '--ignore'],
	])

	const manifest: unknown = JSON.parse(readFileSync(path.resolve(import.meta.dir, '../../augurScan/package.json'), 'utf8'))
	if (typeof manifest !== 'object' || manifest === null) throw new Error('augurScan/package.json must contain an object')
	const scripts = Reflect.get(manifest, 'scripts')
	if (typeof scripts !== 'object' || scripts === null) throw new Error('augurScan/package.json must declare scripts')
	expect(Reflect.get(scripts, 'test:ci')).toBe('bun run test:unit && bun run test:api && bun run test:replay')

	const augurScan = projects.find(project => project.id === 'augur-scan')
	expect(augurScan?.tasks.integration?.command).toEqual(['bun', 'run', 'test:integration'])
})
