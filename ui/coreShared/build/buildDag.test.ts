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
	})

	test('app serve/watch scripts build the full DAG before starting', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		for (const name of ['app:serve:zoltar', 'app:serve:statoblast', 'app:watch:zoltar', 'app:watch:statoblast']) {
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
			expect(appsIndex).toBeGreaterThan(0)
			expect(testsIndex).toBeGreaterThan(appsIndex)
			expect(script).not.toContain('cd ui/coreShared && bun x tsc')
		}
	})

	test('package dependency direction stays coreShared <- zoltar <- statoblast', () => {
		const { uiRoot } = getUiCoreSharedPaths()
		const coreSharedPackage = JSON.parse(fs.readFileSync(`${uiRoot}/coreShared/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const zoltarPackage = JSON.parse(fs.readFileSync(`${uiRoot}/zoltar/package.json`, 'utf8')) as { dependencies?: Record<string, string> }
		const statoblastPackage = JSON.parse(fs.readFileSync(`${uiRoot}/statoblast/package.json`, 'utf8')) as { dependencies?: Record<string, string> }

		expect(coreSharedPackage.dependencies?.['@zoltar/ui-zoltar']).toBeUndefined()
		expect(coreSharedPackage.dependencies?.['@zoltar/ui-statoblast']).toBeUndefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(zoltarPackage.dependencies?.['@zoltar/ui-statoblast']).toBeUndefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-core-shared']).toBeDefined()
		expect(statoblastPackage.dependencies?.['@zoltar/ui-zoltar']).toBeDefined()
	})

	test('watch mode starts every TypeScript project required by the selected app', () => {
		expect(getUiAppDependencyOrder('zoltar')).toEqual(['coreShared', 'zoltar'])
		expect(getUiAppDependencyOrder('statoblast')).toEqual(['coreShared', 'zoltar', 'statoblast'])
	})

	test('ui:build:tests compiles each package test tree exactly once', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildTestsScript = scripts['ui:build:tests']
		if (buildTestsScript === undefined) throw new Error('ui:build:tests script is missing')
		expect(buildTestsScript.match(/bun run build:tests/g)).toHaveLength(3)
		expect(buildTestsScript).toContain('cd ui/coreShared')
		expect(buildTestsScript).toContain('cd ../zoltar')
		expect(buildTestsScript).toContain('cd ../statoblast')
	})
})
