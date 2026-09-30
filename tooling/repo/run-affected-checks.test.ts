import { expect, test } from 'bun:test'
import { projects } from './projects.ts'
import { affectedCheckPlan, affectedCheckSelection } from './run-affected-checks.mts'

test('global, tooling, and unowned paths select the complete registry', () => {
	for (const path of ['package.json', 'tooling/repo/projects.ts', 'future/package/file.ts']) expect(affectedCheckSelection([path])).toEqual(projects)
})

test('empty change detection keeps the safe full-registry fallback', () => {
	expect(affectedCheckSelection([])).toEqual(projects)
})

test('owned paths select their registry dependent closure', () => {
	const selected = affectedCheckSelection(['ui/statoblastShared/ts/protocol/trading.ts']).map(project => project.id)
	expect(selected).toContain('ui-statoblast-shared')
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
	expect(commandsFor('augurScan/src/server.ts', 'augur-scan')).toEqual(['bun run typecheck', 'bun run test:ci', 'bun run check'])
})

test('uses the repository composite check for lint without duplicating the full check', () => {
	const commands = commandsFor('ui/trading/ts/index.ts', 'repository')
	expect(commands).toEqual(['bun run tsc:root', 'bun run test', 'bun run check:complete'])
	expect(commands.filter(command => command === 'bun run check:complete')).toHaveLength(1)
})

for (const path of ['README.md', 'shared/core/README.md', 'bots/liquidator/README.md', 'augurScan/src/ARCHITECTURE.md', 'ui/AGENTS.md', '.codex/agents/reviewer.toml', '.vscode/settings.json', '.claude/skills/babysit']) {
	test(`documentation-only ${path} selects documentation checks`, () => {
		expect(affectedCheckSelection([path]).map(project => project.id)).toEqual(['docs'])
		expect(affectedCheckPlan([path]).map(entry => entry.command.join(' '))).toEqual(['bun run docs:check'])
	})
}

test('mixed documentation and runtime changes preserve each distinct owner', () => {
	const paths = ['bots/liquidator/README.md', 'bots/chaos/src/run.ts']
	expect(affectedCheckSelection(paths).map(project => project.id)).toEqual(['chaos', 'docs'])
	expect(affectedCheckPlan(paths).map(entry => entry.projectId)).toEqual(['chaos', 'docs'])
})
