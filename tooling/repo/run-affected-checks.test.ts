import { expect, test } from 'bun:test'
import { projects } from './projects.ts'
import { affectedCheckPlan, affectedCheckSelection } from './run-affected-checks.mts'

test('global, tooling, and unowned paths select the complete registry', () => {
	for (const path of ['package.json', 'tooling/repo/projects.ts', 'future/package/file.ts']) expect(affectedCheckSelection([path])).toEqual(projects)
})

test('owned paths select their registry dependent closure', () => {
	const selected = affectedCheckSelection(['ui/tradingDomain/ts/capabilities.ts']).map(project => project.id)
	expect(selected).toContain('ui-trading-domain')
	expect(selected).toContain('ui-trading')
	expect(selected).toContain('repository')
	expect(selected).not.toContain('chaos')
})

const commandsFor = (path: string, projectId: string) =>
	affectedCheckPlan([path])
		.filter(entry => entry.projectId === projectId)
		.map(entry => entry.command.join(' '))

test.each([
	['bots/shared/src/index.ts', 'bot-shared'],
	['bots/chaos/src/run.ts', 'chaos'],
	['bots/open-oracle-arbitrager/src/run.ts', 'arbitrager'],
	['bots/liquidator/src/run.ts', 'liquidator'],
] as const)('runs the %s composite check exactly once', (path, projectId) => {
	expect(commandsFor(path, projectId)).toEqual(['bun run check'])
})

test('keeps AugurScan typechecking, tests, and its nonduplicated composite static check', () => {
	expect(commandsFor('augurScan/src/server.ts', 'augur-scan')).toEqual(['bun run typecheck', 'bun run test', 'bun run check'])
})

test('uses the repository composite check for lint without duplicating the full check', () => {
	const commands = commandsFor('ui/trading/ts/index.ts', 'repository')
	expect(commands).toEqual(['bun run tsc:root', 'bun run test', 'bun run check:complete'])
	expect(commands.filter(command => command === 'bun run check:complete')).toHaveLength(1)
})
