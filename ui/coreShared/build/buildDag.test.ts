import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { getUiCoreSharedPaths } from './appPaths.mts'

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
})
