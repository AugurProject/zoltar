import { expect, test } from 'bun:test'
import { projects } from './projects.ts'
import { affectedCheckSelection } from './run-affected-checks.mts'

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
