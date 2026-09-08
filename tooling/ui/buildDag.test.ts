import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { createProjectTaskPlan } from '../repo/run-project-tasks.mts'
import { projectsInTaskGroup } from '../repo/projects.ts'
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
	test('ui:build:apps compiles shared libraries before the dependency-leaf applications', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildAppsScript = scripts['ui:build:apps']
		if (buildAppsScript === undefined) throw new Error('ui:build:apps script is missing')
		expect(buildAppsScript).toBe('bun ./tooling/repo/run-project-tasks.mts build --group ui && bun run projects:workers')
		const uiProjects = projectsInTaskGroup('build', 'ui').map(project => project.id)
		expect(createProjectTaskPlan('build', uiProjects).map(entry => entry.projectId)).toEqual(['ui-core', 'ui-zoltar-shared', 'ui-statoblast-shared', 'ui-zoltar', 'ui-statoblast', 'ui-trading'])
	})

	test('targeted application preparation compiles each dependency once and builds only requested workers', () => {
		const commands = getAppBuildCommands(['zoltar', 'statoblast', 'trading'])
		expect(commands.filter(command => command[0] === 'x').map(command => command[3])).toEqual(['coreShared', 'zoltarShared', 'zoltar', 'statoblastShared', 'statoblast', 'trading'].map(packageId => `ui/${packageId}/tsconfig.json`))
		expect(commands.filter(command => command[0]?.endsWith('/vendor.mts') === true)).toEqual([
			['./tooling/ui/vendor.mts', 'zoltar', '--scoped-artifacts'],
			['./tooling/ui/vendor.mts', 'statoblast', '--scoped-artifacts'],
			['./tooling/ui/vendor.mts', 'trading', '--scoped-artifacts'],
		])
		expect(commands.filter(command => command[0]?.endsWith('/workers.mts') === true).map(command => command[1])).toEqual(['zoltar', 'statoblast', 'trading'])
		expect(commands.filter(command => command.includes('ensure-contract-artifacts'))).toHaveLength(0)
	})

	test('app serve/watch scripts prepare only the selected application before starting', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		for (const app of ['zoltar', 'statoblast', 'trading'] as const) {
			for (const mode of ['serve', 'watch']) expect(scripts[`app:${mode}:${app}`]).toStartWith(`bun ./tooling/ui/apps.mts ${app} && `)
			const commands = getAppBuildCommands([app])
			expect(commands.filter(command => command[0] === 'x').map(command => command[3])).toEqual(getUiAppDependencyOrder(app).map(packageId => `ui/${packageId}/tsconfig.json`))
			expect(commands.filter(command => command[0]?.endsWith('/workers.mts') === true)).toEqual([['./tooling/ui/workers.mts', app, '--artifacts-current']])
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
		expect(projectsIndex).toBeGreaterThanOrEqual(0)
		expect(appsIndex).toBeGreaterThan(projectsIndex)
		expect(testsIndex).toBeGreaterThan(appsIndex)
		expect(scripts['ui:setup']).toBe('bun run setup')
	})

	test('applications depend on shared libraries and no application depends on another application', () => {
		const { uiRoot } = getUiCoreSharedPaths()
		const coreSharedPackage = JSON.parse(fs.readFileSync(`${uiRoot}/coreShared/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const zoltarSharedPackage = JSON.parse(fs.readFileSync(`${uiRoot}/zoltarShared/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const statoblastSharedPackage = JSON.parse(fs.readFileSync(`${uiRoot}/statoblastShared/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const zoltarPackage = JSON.parse(fs.readFileSync(`${uiRoot}/zoltar/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const statoblastPackage = JSON.parse(fs.readFileSync(`${uiRoot}/statoblast/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const tradingPackage = JSON.parse(fs.readFileSync(`${uiRoot}/trading/package.json`, 'utf8')) as { dependencies?: Record<string, string> }

		for (const dependency of ['@zoltar/ui-zoltar', '@zoltar/ui-statoblast', '@zoltar/ui-trading']) expect(coreSharedPackage.dependencies?.[dependency]).toBeUndefined()
		expect(zoltarSharedPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(statoblastSharedPackage.dependencies?.['@zoltar/ui-zoltar-shared']).toBeDefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-zoltar-shared']).toBeDefined()
		for (const dependency of ['@zoltar/ui-statoblast', '@zoltar/ui-trading']) expect(zoltarPackage.dependencies?.[dependency]).toBeUndefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-statoblast-shared']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-zoltar-shared']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-zoltar']).toBeUndefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-trading']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(getUiAppDependencyOrder('trading')).toContain('zoltarShared')
		expect(tradingPackage.dependencies?.['@zoltar/ui-statoblast-shared']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/core-shared']).toBeDefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-zoltar']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/ui-statoblast']).toBeUndefined()
		expect(tradingPackage.dependencies?.['@zoltar/trading']).toBeUndefined()
	})

	test('watch mode starts every TypeScript project required by the selected app', () => {
		expect(getUiAppDependencyOrder('zoltar')).toEqual(['coreShared', 'zoltarShared', 'zoltar'])
		expect(getUiAppDependencyOrder('statoblast')).toEqual(['coreShared', 'zoltarShared', 'statoblastShared', 'statoblast'])
		expect(getUiAppDependencyOrder('trading')).toEqual(['coreShared', 'zoltarShared', 'statoblastShared', 'trading'])
	})

	test('Trading watch mode rebuilds shared SDK and main contract outputs and reloads app CSS', () => {
		const watchSource = fs.readFileSync(`${import.meta.dir}/watch.mts`, 'utf8')
		expect(watchSource).toContain('appPaths.sharedSourceRoots')
		expect(watchSource).toContain("path.join(REPOSITORY_ROOT_PATH, 'solidity', 'contracts')")
		expect(watchSource).toContain('build-app-contracts.mts')
		expect(watchSource).toContain("path.join(APP_ROOT_PATH, 'css')")
		expect(watchSource).not.toContain('TRADING_PACKAGE_ROOT_PATH')
	})

	test('ui:build:tests compiles each package test tree exactly once', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildTestsScript = scripts['ui:build:tests']
		if (buildTestsScript === undefined) throw new Error('ui:build:tests script is missing')
		expect(buildTestsScript).toBe('bun run projects:test-build')
		expect(createProjectTaskPlan('test-build').map(entry => entry.projectId)).toEqual(['ui-core', 'ui-zoltar', 'ui-statoblast', 'ui-trading'])
	})
})
