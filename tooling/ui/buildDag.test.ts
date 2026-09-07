import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { createProjectTaskPlan } from '../repo/run-project-tasks.mts'
import { getUiAppDependencyOrder, getUiCoreSharedPaths } from './appPaths.mts'

type PackageJson = {
	scripts?: Record<string, string | undefined>
}

function readRootPackageJson(): PackageJson {
	const { repositoryRoot } = getUiCoreSharedPaths()
	return JSON.parse(fs.readFileSync(`${repositoryRoot}/package.json`, 'utf8')) as PackageJson
}

describe('UI build dependency direction', () => {
	test('ui:build:apps compiles domain packages before the dependency-leaf applications', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildAppsScript = scripts['ui:build:apps']
		if (buildAppsScript === undefined) throw new Error('ui:build:apps script is missing')
		expect(buildAppsScript).toBe('bun run projects:build')
		expect(createProjectTaskPlan('build').map(entry => entry.projectId)).toEqual(['ui-core', 'ui-zoltar-domain', 'ui-statoblast-domain', 'ui-trading-domain', 'ui-zoltar', 'ui-statoblast', 'ui-trading'])
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

	test('the public production build emits the complete UI DAG before bundling', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const productionBuild = scripts['ui:build:prod']
		if (productionBuild === undefined) throw new Error('ui:build:prod script is missing')
		const generateIndex = productionBuild.indexOf('bun run generate')
		const appBuildIndex = productionBuild.indexOf('bun run ui:build:apps')
		const productionBundleIndex = productionBuild.indexOf('bun run ui:build:prod:current')
		expect(generateIndex).toBeGreaterThanOrEqual(0)
		expect(appBuildIndex).toBeGreaterThan(generateIndex)
		expect(productionBundleIndex).toBeGreaterThan(appBuildIndex)
	})

	test('setup scripts emit the complete UI DAG before compiling tests', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const setup = scripts['setup']
		if (setup === undefined) throw new Error('setup script is missing')
		const projectsIndex = setup.indexOf('bun run projects:setup')
		const appsIndex = setup.indexOf('bun run ui:build:apps')
		const testsIndex = setup.indexOf('bun run ui:build:tests')
		expect(createProjectTaskPlan('setup').map(entry => entry.projectId)).toContain('ui-trading')
		expect(projectsIndex).toBeGreaterThan(0)
		expect(appsIndex).toBeGreaterThan(projectsIndex)
		expect(testsIndex).toBeGreaterThan(appsIndex)
		expect(scripts['ui:setup']).toBe('bun run setup')
	})

	test('applications depend on domain packages and no application depends on another application', () => {
		const { uiRoot } = getUiCoreSharedPaths()
		const coreSharedPackage = JSON.parse(fs.readFileSync(`${uiRoot}/coreShared/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const zoltarDomainPackage = JSON.parse(fs.readFileSync(`${uiRoot}/zoltarDomain/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const statoblastDomainPackage = JSON.parse(fs.readFileSync(`${uiRoot}/statoblastDomain/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const tradingDomainPackage = JSON.parse(fs.readFileSync(`${uiRoot}/tradingDomain/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const zoltarPackage = JSON.parse(fs.readFileSync(`${uiRoot}/zoltar/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const statoblastPackage = JSON.parse(fs.readFileSync(`${uiRoot}/statoblast/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const tradingPackage = JSON.parse(fs.readFileSync(`${uiRoot}/trading/package.json`, 'utf8')) as { dependencies?: Record<string, string> }

		for (const dependency of ['@zoltar/ui-zoltar', '@zoltar/ui-statoblast', '@zoltar/ui-trading']) expect(coreSharedPackage.dependencies?.[dependency]).toBeUndefined()
		expect(zoltarDomainPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(statoblastDomainPackage.dependencies?.['@zoltar/ui-zoltar-domain']).toBeDefined()
		expect(tradingDomainPackage.dependencies?.['@zoltar/shared']).toBeDefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-zoltar-domain']).toBeDefined()
		for (const dependency of ['@zoltar/ui-statoblast', '@zoltar/ui-trading']) expect(zoltarPackage.dependencies?.[dependency]).toBeUndefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-statoblast-domain']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-zoltar-domain']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-zoltar']).toBeUndefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-trading']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-zoltar-domain']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-statoblast-domain']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-trading-domain']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-zoltar']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-statoblast']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/trading']).toBeUndefined()
	})

	test('watch mode starts every TypeScript project required by the selected app', () => {
		expect(getUiAppDependencyOrder('zoltar')).toEqual(['coreShared', 'zoltarDomain', 'zoltar'])
		expect(getUiAppDependencyOrder('statoblast')).toEqual(['coreShared', 'zoltarDomain', 'statoblastDomain', 'statoblast'])
		expect(getUiAppDependencyOrder('trading')).toEqual(['coreShared', 'zoltarDomain', 'statoblastDomain', 'tradingDomain', 'trading'])
	})

	test('Trading watch mode rebuilds shared SDK and main contract outputs and reloads app CSS', () => {
		const watchSource = fs.readFileSync(`${import.meta.dir}/watch.mts`, 'utf8')
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
