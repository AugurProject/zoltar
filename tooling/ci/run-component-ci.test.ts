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
		lint: task('lint'),
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

test('component CI retries only the registry-backed audit on transient network errors', () => {
	expect(createComponentCiPlan('package', [component(['lint'])]).map(entry => entry.retryTransientNetworkErrors === true)).toEqual([false, false, true])
})

test('component CI does not duplicate tests covered by the check task', () => {
	expect(createComponentCiPlan('package', [component(['lint', 'test'])]).map(entry => entry.command)).toEqual([
		['bun', 'run', 'check'],
		['bun', 'run', 'audit'],
	])
})

test('bot component CI builds its shared dashboard UI dependency before checking', () => {
	for (const packageName of ['bot-shared', 'chaos', 'arbitrager', 'liquidator']) {
		const plan = createComponentCiPlan(packageName)
		expect(plan[0]).toMatchObject({ command: ['bun', 'run', 'tsc'], cwd: 'ui/coreShared' })
	}
	expect(createComponentCiPlan('augur-scan').some(entry => entry.cwd === 'ui/coreShared')).toBe(false)
})

test('registered AugurScan CI runs its complete non-database suite while bots avoid duplicate tests', () => {
	const augurScanPlan = createComponentCiPlan('augur-scan')
	expect(augurScanPlan[0]?.command).toEqual(['bun', 'run', 'typecheck'])
	expect(augurScanPlan.map(entry => entry.command.slice(0, 3))).toEqual([
		['bun', 'run', 'typecheck'],
		['bun', 'run', 'build'],
		['bun', 'run', 'test:ci'],
		['bun', 'run', 'check'],
		['bun', 'audit'],
	])
	expect(createComponentCiPlan('chaos').map(entry => entry.command.slice(0, 3))).toEqual([
		['bun', 'run', 'tsc'],
		['bun', 'run', 'check'],
		['bun', 'audit'],
	])

	const manifest: unknown = JSON.parse(readFileSync(path.resolve(import.meta.dir, '../../augurScan/package.json'), 'utf8'))
	if (typeof manifest !== 'object' || manifest === null) throw new Error('augurScan/package.json must contain an object')
	const scripts = Reflect.get(manifest, 'scripts')
	if (typeof scripts !== 'object' || scripts === null) throw new Error('augurScan/package.json must declare scripts')
	expect(Reflect.get(scripts, 'test:ci')).toBe('bun run test:unit && bun run test:api && bun run test:replay')

	const augurScan = projects.find(project => project.id === 'augur-scan')
	expect(augurScan?.tasks.integration?.command).toEqual(['bun', 'run', 'test:integration'])
})
