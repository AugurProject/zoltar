import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { getAppBuildCommands } from './apps.mts'
import { getUiAppDependencyOrder, getUiCoreSharedPaths } from './appPaths.mts'

type PackageJson = {
	scripts?: Record<string, string | undefined>
}

function readRootPackageJson(): PackageJson {
	const { repositoryRoot } = getUiCoreSharedPaths()
	return JSON.parse(fs.readFileSync(`${repositoryRoot}/package.json`, 'utf8')) as PackageJson
}

describe('UI build dependency direction', () => {
	test('full builds compile each dependency once and build every application worker', () => {
		const commands = getAppBuildCommands(['zoltar', 'statoblast', 'trading'])
		expect(commands.filter(command => command[0] === 'x')).toEqual(['coreShared', 'zoltar', 'statoblast', 'trading'].map(app => ['x', 'tsc', '--project', `ui/${app}/tsconfig.json`]))
		expect(commands.filter(command => command[0]?.endsWith('/workers.mts')).map(command => command[1])).toEqual(['zoltar', 'statoblast', 'trading'])
		expect(commands.filter(command => command.includes('ensure-contract-artifacts'))).toHaveLength(1)
	})

	test('app serve/watch builds only the selected application and its TypeScript dependencies', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		for (const app of ['zoltar', 'statoblast', 'trading'] as const) {
			for (const mode of ['serve', 'watch']) expect(scripts[`app:${mode}:${app}`]).toStartWith(`bun ./ui/coreShared/build/apps.mts ${app} && `)
			const commands = getAppBuildCommands([app])
			expect(commands.filter(command => command[0] === 'x').map(command => command[3])).toEqual(getUiAppDependencyOrder(app).map(id => `ui/${id}/tsconfig.json`))
			expect(commands.filter(command => command[0]?.endsWith('/vendor.mts'))).toEqual([['./ui/coreShared/build/vendor.mts', app]])
			expect(commands.filter(command => command[0]?.endsWith('/workers.mts'))).toEqual([['./ui/coreShared/build/workers.mts', app, '--artifacts-current']])
		}
		expect(scripts['app:build']).toBe('bun run ui:build:apps && bun run ui:build:tests')
		expect(scripts['ui:build:apps']).toBe('bun ./ui/coreShared/build/apps.mts')
		expect(scripts['ui:build:prod']).toBe('bun run ui:build:apps && bun run ui:build:prod:current')
	})

	test('prepared commands do not repeat shared package preparation', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		expect(scripts['test']).toBe('bun run ensure-contract-artifacts && bun run tsc:ci:current && bun run test:run')
		expect(scripts['tsc']).not.toContain('check:shared-dependencies')
		expect(scripts['tsc']).toEndWith('bun run tsc:solidity:current')
		expect(scripts['trading:compile']).not.toContain('shared:build')
		const { repositoryRoot } = getUiCoreSharedPaths()
		const solidityPackage = JSON.parse(fs.readFileSync(`${repositoryRoot}/solidity/package.json`, 'utf8')) as PackageJson
		expect(solidityPackage.scripts?.['compile-contracts']).toBe('bun run shared && bun run refresh:shared-dependency && bun run compile-contracts:current')
		expect(solidityPackage.scripts?.['compile-contracts:current']).not.toContain('bun run shared')
		expect(solidityPackage.scripts?.['compile-contracts:current']).not.toContain('refresh:shared-dependency')
		expect(solidityPackage.scripts?.['test']).toBe('bun run ensure-contract-artifacts && bun tsc && bun test --timeout 300000 ./js/tests/')
		expect(solidityPackage.scripts?.['gas-costs']).toBe('cd .. && bun run ensure-shared-build && cd solidity && bun run ./ts/gas-costs.ts')
	})

	test('setup scripts emit the complete UI DAG before compiling tests', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		for (const name of ['setup', 'ui:setup']) {
			const script = scripts[name]
			if (script === undefined) throw new Error(`${name} script is missing`)
			const appsIndex = script.indexOf('bun run ui:build:apps')
			const testsIndex = script.indexOf('bun run ui:build:tests')
			const tradingUiInstallIndex = script.indexOf('install-frozen.mts ui/trading')
			expect(script).not.toContain('install-frozen.mts trading')
			expect(tradingUiInstallIndex).toBeGreaterThan(0)
			expect(appsIndex).toBeGreaterThan(0)
			expect(appsIndex).toBeGreaterThan(tradingUiInstallIndex)
			expect(testsIndex).toBeGreaterThan(appsIndex)
			expect(script).not.toContain('cd ui/coreShared && bun x tsc')
		}
	})

	test('package dependency direction stays coreShared <- zoltar <- statoblast <- trading', () => {
		const { uiRoot } = getUiCoreSharedPaths()
		const coreSharedPackage = JSON.parse(fs.readFileSync(`${uiRoot}/coreShared/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const zoltarPackage = JSON.parse(fs.readFileSync(`${uiRoot}/zoltar/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const statoblastPackage = JSON.parse(fs.readFileSync(`${uiRoot}/statoblast/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const tradingPackage = JSON.parse(fs.readFileSync(`${uiRoot}/trading/package.json`, 'utf8')) as { dependencies?: Record<string, string> }

		for (const dependency of ['@zoltar/ui-zoltar', '@zoltar/ui-statoblast', '@zoltar/ui-trading']) expect(coreSharedPackage.dependencies?.[dependency]).toBeUndefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		for (const dependency of ['@zoltar/ui-statoblast', '@zoltar/ui-trading']) expect(zoltarPackage.dependencies?.[dependency]).toBeUndefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-zoltar']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-trading']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-zoltar']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-statoblast']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/trading']).toBeUndefined()
	})

	test('watch mode starts every TypeScript project required by the selected app', () => {
		expect(getUiAppDependencyOrder('zoltar')).toEqual(['coreShared', 'zoltar'])
		expect(getUiAppDependencyOrder('statoblast')).toEqual(['coreShared', 'zoltar', 'statoblast'])
		expect(getUiAppDependencyOrder('trading')).toEqual(['coreShared', 'zoltar', 'statoblast', 'trading'])
	})

	test('Trading watch mode rebuilds shared SDK and main contract outputs and reloads app CSS', () => {
		const { coreSharedRoot } = getUiCoreSharedPaths()
		const watchSource = fs.readFileSync(`${coreSharedRoot}/build/watch.mts`, 'utf8')
		expect(watchSource).toContain("path.join(REPOSITORY_ROOT_PATH, 'shared', 'ts')")
		expect(watchSource).toContain("path.join(REPOSITORY_ROOT_PATH, 'solidity', 'contracts')")
		expect(watchSource).toContain("spawn(BUN_EXECUTABLE_PATH, ['run', 'generate:contracts']")
		expect(watchSource).toContain("path.join(APP_ROOT_PATH, 'css')")
		expect(watchSource).not.toContain('TRADING_PACKAGE_ROOT_PATH')
	})

	test('ui:build:tests compiles each package test tree exactly once', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildTestsScript = scripts['ui:build:tests']
		if (buildTestsScript === undefined) throw new Error('ui:build:tests script is missing')
		expect(buildTestsScript.match(/bun run build:tests/g)).toHaveLength(4)
		expect(buildTestsScript).toContain('cd ui/coreShared')
		expect(buildTestsScript).toContain('cd ../zoltar')
		expect(buildTestsScript).toContain('cd ../statoblast')
		expect(buildTestsScript).toContain('cd ../trading')
	})
})
