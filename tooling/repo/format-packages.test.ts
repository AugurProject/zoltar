import { expect, test } from 'bun:test'
import { packageFormatPlan } from './format-packages.mts'
import { componentProjects } from './projects.ts'

test('package formatting shares registry targets while keeping write and check commands distinct', () => {
	for (const command of ['format', 'format:check']) {
		const plan = packageFormatPlan(command)
		expect(plan.map(entry => entry.cwd)).toEqual(componentProjects().map(project => project.path))
		expect(plan.map(entry => entry.cwd).sort()).toEqual(['augurScan', 'bots/chaos', 'bots/liquidator', 'bots/open-oracle-arbitrager', 'bots/shared'])
		for (const entry of plan) expect(entry.command).toEqual(['bun', 'run', command])
	}
})

test('package formatting rejects unsupported commands', () => {
	for (const command of [undefined, 'lint', '--write']) expect(() => packageFormatPlan(command)).toThrow('Expected format or format:check')
})
