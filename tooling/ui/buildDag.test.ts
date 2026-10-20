import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createProjectTaskPlan } from '../repo/run-project-tasks.mts'
import { projectsInTaskGroup } from '../repo/projects.ts'
import { appSharedPackages, sharedPackageClosure, sharedPackages } from '../repo/sharedPackages.ts'
import { getAppBuildCommands } from './apps.mts'
import { getUiAppDependencyOrder, getUiAppPaths, getUiCoreSharedPaths, UI_APP_IDS, type UiAppId } from './appPaths.mts'
import { createWatchBuilds } from './watchBuilds.mts'

type PackageJson = {
	scripts?: Record<string, string | undefined>
}

function readRootPackageJson(): PackageJson {
	const { repositoryRoot } = getUiCoreSharedPaths()
	return JSON.parse(fs.readFileSync(`${repositoryRoot}/package.json`, 'utf8')) as PackageJson
}

function collectWatchBuilds(appId: UiAppId) {
	const appPaths = getUiAppPaths(appId)
	const calls: string[] = []
	const commands: string[][] = []
	const workingDirectories: string[] = []
	const builds = createWatchBuilds({
		appPaths,
		bunExecutablePath: process.execPath,
		isStopped: () => false,
		onIdle: () => {
			calls.push('reload')
		},
		run: async (job, step) => {
			calls.push(job)
			commands.push(step.command)
			workingDirectories.push(step.cwd)
			return true
		},
	})
	return { ...builds, appPaths, calls, commands, workingDirectories }
}

describe('UI build dependency direction', () => {
	test('the shared-build CLI compiles exactly the package closure for every application', async () => {
		const fixtureRoot = fs.mkdtempSync(path.join(tmpdir(), 'app-shared-build-'))
		const { repositoryRoot } = getUiCoreSharedPaths()
		try {
			for (const source of ['tooling/repo/build-shared.mts', 'tooling/repo/root.mts', 'tooling/repo/sharedPackages.ts', 'tooling/ui/appIds.mts']) {
				const destination = path.join(fixtureRoot, source)
				fs.mkdirSync(path.dirname(destination), { recursive: true })
				fs.copyFileSync(path.join(repositoryRoot, source), destination)
			}
			fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(fixtureRoot, 'node_modules'), 'dir')
			for (const entry of sharedPackages) {
				const packageRoot = path.join(fixtureRoot, entry.path)
				fs.mkdirSync(path.join(packageRoot, 'ts'), { recursive: true })
				fs.writeFileSync(path.join(packageRoot, 'ts/value.ts'), 'export const value = 1\n')
				fs.writeFileSync(path.join(packageRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], rootDir: 'ts', outDir: 'js' }, include: ['ts/**/*.ts'] }))
			}
			for (const appId of UI_APP_IDS) {
				for (const entry of sharedPackages) fs.rmSync(path.join(fixtureRoot, entry.path, 'js'), { recursive: true, force: true })
				const child = Bun.spawn([process.execPath, './tooling/repo/build-shared.mts', appId], { cwd: fixtureRoot, stdout: 'pipe', stderr: 'pipe' })
				const [exitCode, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
				expect({ appId, exitCode, output, errors }).toEqual({ appId, exitCode: 0, output: '', errors: '' })
				const expectedIds = sharedPackageClosure(appSharedPackages[appId]).map(entry => entry.id)
				for (const entry of sharedPackages) expect(fs.existsSync(path.join(fixtureRoot, entry.path, 'js/value.js'))).toBe(expectedIds.includes(entry.id))
			}
		} finally {
			fs.rmSync(fixtureRoot, { recursive: true, force: true })
		}
	})

	test('ui:build:apps compiles shared libraries before the dependency-leaf applications', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildAppsScript = scripts['ui:build:apps']
		if (buildAppsScript === undefined) throw new Error('ui:build:apps script is missing')
		expect(buildAppsScript).toBe('bun ./tooling/repo/run-project-tasks.mts build --group ui && bun run projects:workers')
		const uiProjects = projectsInTaskGroup('build', 'ui').map(project => project.id)
		expect(createProjectTaskPlan('build', uiProjects).map(entry => entry.projectId)).toEqual(['ui-core', 'ui-zoltar-shared', 'ui-statoblast-shared', 'ui-zoltar', 'ui-statoblast', 'ui-trading', 'ui-openoracle'])
	})

	test('targeted application preparation compiles each dependency once and builds only requested workers', () => {
		const commands = getAppBuildCommands(UI_APP_IDS)
		expect(commands.filter(command => command[0] === 'x').map(command => command[3])).toEqual(['coreShared', 'zoltarShared', 'zoltar', 'statoblastShared', 'statoblast', 'trading', 'openoracle'].map(packageId => `ui/${packageId}/tsconfig.json`))
		expect(commands.filter(command => command[0]?.endsWith('/vendor.mts') === true)).toEqual([
			['./tooling/ui/vendor.mts', 'zoltar', '--scoped-artifacts'],
			['./tooling/ui/vendor.mts', 'statoblast', '--scoped-artifacts'],
			['./tooling/ui/vendor.mts', 'trading', '--scoped-artifacts'],
			['./tooling/ui/vendor.mts', 'openoracle', '--scoped-artifacts'],
		])
		expect(commands.filter(command => command[0]?.endsWith('/workers.mts') === true).map(command => command[1])).toEqual([...UI_APP_IDS])
		expect(commands.filter(command => command.includes('ensure-contract-artifacts'))).toHaveLength(0)
	})

	test('app serve/watch scripts prepare only the selected application before starting', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		for (const app of UI_APP_IDS) {
			for (const mode of ['serve', 'watch']) expect(scripts[`app:${mode}:${app}`]).toStartWith(`bun ./tooling/ui/apps.mts ${app} && `)
			const commands = getAppBuildCommands([app])
			expect(commands.filter(command => command[0] === 'x').map(command => command[3])).toEqual(getUiAppDependencyOrder(app).map(packageId => `ui/${packageId}/tsconfig.json`))
			expect(commands.filter(command => command[0]?.endsWith('/workers.mts') === true)).toEqual([['./tooling/ui/workers.mts', app, '--artifacts-current']])
		}
		const appBuild = scripts['ui:build']
		if (appBuild === undefined) throw new Error('ui:build script is missing')
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
		expect(createProjectTaskPlan('setup').map(entry => entry.projectId)).toEqual(['repository'])
		expect(projectsIndex).toBeGreaterThanOrEqual(0)
		expect(appsIndex).toBeGreaterThan(projectsIndex)
		expect(testsIndex).toBeGreaterThan(appsIndex)
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

	test('Trading watch mode rebuilds shared SDK and main contract outputs and reloads app CSS', () => {
		const watchSource = fs.readFileSync(`${import.meta.dir}/watch.mts`, 'utf8')
		expect(watchSource).toContain('appPaths.sharedSourceRoots')
		expect(watchSource).toContain("path.join(REPOSITORY_ROOT_PATH, 'solidity', 'contracts')")
		expect(watchSource).toContain("path.join(APP_ROOT_PATH, 'css')")
		expect(watchSource).not.toContain('TRADING_PACKAGE_ROOT_PATH')
	})

	test('ui:build:tests compiles each package test tree exactly once', () => {
		const scripts = readRootPackageJson().scripts ?? {}
		const buildTestsScript = scripts['ui:build:tests']
		if (buildTestsScript === undefined) throw new Error('ui:build:tests script is missing')
		expect(buildTestsScript).toBe('bun ./tooling/repo/run-project-tasks.mts test-build')
		expect(createProjectTaskPlan('test-build').map(entry => entry.projectId)).toEqual(['ui-core', 'ui-zoltar', 'ui-statoblast', 'ui-trading', 'ui-openoracle'])
	})
})

describe('UI watcher build dependencies', () => {
	test('Trading artifact changes rebuild scoped vendor assets before the current-artifact worker', async () => {
		const builds = collectWatchBuilds('trading')
		await builds.runProjectArtifactBuild('contract output')
		expect(builds.calls).toEqual(['vendor', 'worker', 'reload'])
		expect(builds.commands).toEqual([
			[process.execPath, builds.appPaths.vendorBuildScript, 'trading', '--scoped-artifacts'],
			[process.execPath, builds.appPaths.workersBuildScript, 'trading', '--artifacts-current'],
		])
		expect(builds.workingDirectories).toEqual([builds.appPaths.coreSharedRoot, builds.appPaths.coreSharedRoot])
	})

	test('Zoltar and Statoblast artifact changes run their owning contract build', async () => {
		for (const appId of ['zoltar', 'statoblast'] as const) {
			const builds = collectWatchBuilds(appId)
			await builds.runProjectArtifactBuild('contract output')
			expect(builds.calls).toEqual(['contracts', 'reload'])
			expect(builds.commands).toEqual([[process.execPath, './tooling/contracts/build-app-contracts.mts', appId]])
			expect(builds.workingDirectories).toEqual([builds.appPaths.repositoryRoot])
		}
	})

	test('Trading contract changes rebuild contracts, vendor assets and the worker before reloading', async () => {
		const builds = collectWatchBuilds('trading')
		await builds.runContractBuild('Solidity source')
		expect(builds.calls).toEqual(['contracts', 'vendor', 'worker', 'reload'])
		expect(builds.commands[0]).toEqual([process.execPath, './tooling/contracts/build-app-contracts.mts', 'trading'])
		expect(builds.workingDirectories).toEqual([builds.appPaths.repositoryRoot, builds.appPaths.coreSharedRoot, builds.appPaths.coreSharedRoot])
	})

	test('shared source changes rebuild shared outputs and the selected application worker', async () => {
		for (const appId of UI_APP_IDS) {
			const builds = collectWatchBuilds(appId)
			await builds.runSharedBuild('shared source')
			expect(builds.calls).toEqual(['shared', 'worker', 'reload'])
			expect(builds.commands).toEqual([
				[process.execPath, './tooling/repo/build-shared.mts', appId],
				[process.execPath, builds.appPaths.workersBuildScript, appId, '--artifacts-current'],
			])
			expect(builds.workingDirectories).toEqual([builds.appPaths.repositoryRoot, builds.appPaths.coreSharedRoot])
		}
	})

	test('changes during a worker build serialize and coalesce upstream rebuilds before another worker', async () => {
		const calls: string[] = []
		let activeBuilds = 0
		let maximumActiveBuilds = 0
		let releaseFirst: () => void = () => undefined
		const firstBuild = new Promise<void>(resolve => {
			releaseFirst = resolve
		})
		let started: () => void = () => undefined
		const firstStarted = new Promise<void>(resolve => {
			started = resolve
		})
		const builds = createWatchBuilds({
			appPaths: getUiAppPaths('trading'),
			bunExecutablePath: process.execPath,
			isStopped: () => false,
			onIdle: () => {
				calls.push('reload')
			},
			run: async job => {
				calls.push(job)
				activeBuilds += 1
				maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds)
				if (calls.length === 1) {
					started()
					await firstBuild
				}
				activeBuilds -= 1
				return true
			},
		})
		const completion = builds.runWorkerBuild('worker source')
		await firstStarted
		void builds.runVendorBuild('vendor source')
		void builds.runContractBuild('contract source')
		void builds.runSharedBuild('shared source')
		releaseFirst()
		await completion
		expect(calls).toEqual(['worker', 'shared', 'contracts', 'vendor', 'worker', 'reload'])
		expect(maximumActiveBuilds).toBe(1)
	})
})
