import { expect, test } from 'bun:test'
import { affectedProjects, projectDependencyClosure, projects, taskInputMatches } from '../repo/projects.ts'
import { appSharedPackages, sharedPackageClosure } from '../repo/sharedPackages.ts'
import { findSharedBoundaryViolations } from '../repo/check-shared-boundaries.mts'
import { getAppBuildCommands } from './apps.mts'
import { getSharedBrowserImports } from './sharedBrowserArtifacts.ts'
import { isContractProjectSource } from '../../solidity/ts/contractProjects.ts'

for (const app of ['zoltar', 'statoblast', 'trading'] as const) {
	test(`${app} build and browser mappings follow the runtime package closure`, () => {
		const expected = sharedPackageClosure(appSharedPackages[app])
		const closure = projectDependencyClosure([`ui-${app}`]).map(entry => entry.id)
		for (const entry of expected) expect(closure).toContain(entry.id)
		const forbidden = { zoltar: ['shared-statoblast', 'shared-open-oracle', 'shared-trading', 'ui-statoblast-shared', 'contracts-statoblast', 'contracts-trading', 'contracts'], statoblast: ['shared-trading', 'ui-trading', 'contracts-trading', 'contracts'], trading: ['contracts'] }[app]
		for (const id of forbidden) expect(closure).not.toContain(id)
		const imports = Object.keys(getSharedBrowserImports(app))
		for (const specifier of imports) expect(expected.some(entry => specifier.startsWith(`${entry.name}/`))).toBe(true)
		expect(getAppBuildCommands([app])[0]).toEqual(['./tooling/contracts/build-app-contracts.mts', app])
		expect(getAppBuildCommands([app])).toContainEqual(['./tooling/repo/build-shared.mts', app])
		expect(getAppBuildCommands([app]).flat().join(' ')).not.toContain('ensure-contract-artifacts')
	})
}

test('Zoltar excludes Statoblast and OpenOracle while retaining neutral infrastructure', () => {
	for (const source of ['contracts/statoblast/SecurityPool.sol', 'contracts/statoblast/openOracle/OpenOracle.sol', 'contracts/trading/Pair.sol', 'contracts/test/Mock.sol']) expect(isContractProjectSource(source, 'zoltar')).toBe(false)
	for (const source of ['contracts/Zoltar.sol', 'contracts/ScalarOutcomes.sol', 'contracts/statoblast/WETH9.sol', 'contracts/statoblast/Multicall3.sol']) expect(isContractProjectSource(source, 'zoltar')).toBe(true)
	expect(isContractProjectSource('contracts/trading/Pair.sol', 'statoblast')).toBe(false)
})

test('shared boundaries reject reverse edges, relative bypasses and type-only dependencies', () => {
	expect(findSharedBoundaryViolations('shared/core/ts/example.ts', "import type { T } from '@zoltar/ui-statoblast-shared/types/app.js'\n")).toHaveLength(1)
	expect(findSharedBoundaryViolations('shared/zoltar/ts/example.ts', "import type { T } from '@zoltar/statoblast-shared/example'\n")).toHaveLength(1)
	expect(findSharedBoundaryViolations('shared/core/ts/example.ts', "export { x } from '../../trading/ts/example'\n")).toHaveLength(1)
	expect(findSharedBoundaryViolations('ui/zoltarShared/ts/example.ts', "const x = import('@zoltar/open-oracle-shared/example')\n")).toHaveLength(1)
	expect(findSharedBoundaryViolations('shared/statoblast/ts/example.ts', "import { x } from '@zoltar/zoltar-shared/example'\n")).toHaveLength(0)
})

test('downstream contract changes do not invalidate upstream app builds', () => {
	for (const source of ['solidity/contracts/statoblast/SecurityPool.sol', 'solidity/contracts/statoblast/openOracle/OpenOracle.sol', 'solidity/contracts/trading/TradingPair.sol']) {
		const affected = affectedProjects([source]).map(entry => entry.id)
		expect(affected).not.toContain('ui-zoltar')
		expect(affected).toContain('contracts')
		const zoltar = projects.find(entry => entry.id === 'contracts-zoltar')
		if (zoltar === undefined) throw new Error('Missing Zoltar contract project')
		expect(taskInputMatches('build', source, zoltar)).toBe(false)
	}
	for (const name of ['WETH9', 'Multicall3']) expect(affectedProjects([`solidity/contracts/statoblast/${name}.sol`]).map(entry => entry.id)).toContain('ui-zoltar')
})
