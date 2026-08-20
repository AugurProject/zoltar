import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { getUiAppDependencyOrder, getUiCoreSharedPaths } from './appPaths.mts'

type PackageJson = {
	scripts?: Record<string, string | undefined>
}

function readRootPackageJson(): PackageJson {
	const { repositoryRoot } = getUiCoreSharedPaths()
	return JSON.parse(fs.readFileSync(`${repositoryRoot}/package.json`, 'utf8')) as PackageJson
}

describe('UI build dependency direction', () => {
	test('ui:build:apps compiles coreShared before the dependent apps', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildAppsScript = scripts['ui:build:apps']
		if (buildAppsScript === undefined) throw new Error('ui:build:apps script is missing')
		const coreSharedIndex = buildAppsScript.indexOf('coreShared')
		const zoltarIndex = buildAppsScript.indexOf('zoltar && bun run build')
		const statoblastIndex = buildAppsScript.indexOf('statoblast && bun run build')
		expect(coreSharedIndex).toBeGreaterThanOrEqual(0)
		expect(zoltarIndex).toBeGreaterThan(coreSharedIndex)
		expect(statoblastIndex).toBeGreaterThan(zoltarIndex)
		const tradingIndex = buildAppsScript.indexOf('trading && bun run build')
		expect(tradingIndex).toBeGreaterThan(statoblastIndex)
	})

	test('app serve/watch scripts build the full DAG before starting', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		for (const name of ['app:serve:zoltar', 'app:serve:statoblast', 'app:serve:trading', 'app:watch:zoltar', 'app:watch:statoblast', 'app:watch:trading']) {
			const script = scripts[name]
			if (script === undefined) throw new Error(`${name} script is missing`)
			expect(script.startsWith('bun run app:build')).toBe(true)
		}
		const appBuild = scripts['app:build']
		if (appBuild === undefined) throw new Error('app:build script is missing')
		expect(appBuild).toContain('ui:build:apps')
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
