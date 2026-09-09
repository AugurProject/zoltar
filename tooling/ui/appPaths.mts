import { appSharedPackages, sharedPackageClosure } from '../repo/sharedPackages.ts'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'
import { projectDependencyClosure, projects } from '../repo/projects.ts'

import { parseUiAppId, type UiAppId } from './appIds.mts'
export { UI_APP_IDS, isUiAppId, parseUiAppId, type UiAppId } from './appIds.mts'
export type UiPackageId = 'coreShared' | 'zoltarShared' | 'statoblastShared' | UiAppId

const UI_PROJECT_ID_BY_PACKAGE_ID: Readonly<Record<UiPackageId, string>> = {
	coreShared: 'ui-core',
	statoblast: 'ui-statoblast',
	statoblastShared: 'ui-statoblast-shared',
	trading: 'ui-trading',
	zoltar: 'ui-zoltar',
	zoltarShared: 'ui-zoltar-shared',
}

const UI_PACKAGE_ID_BY_PROJECT_ID = new Map(Object.entries(UI_PROJECT_ID_BY_PACKAGE_ID).map(([packageId, projectId]) => [projectId, packageId as UiPackageId]))

function getUiProject(packageId: UiPackageId) {
	const projectId = UI_PROJECT_ID_BY_PACKAGE_ID[packageId]
	const project = projects.find(candidate => candidate.id === projectId)
	if (project === undefined) throw new Error(`UI package ${packageId} is missing canonical project ${projectId}`)
	return project
}

export function getUiAppDependencyOrder(appId: UiAppId): readonly UiPackageId[] {
	return projectDependencyClosure([UI_PROJECT_ID_BY_PACKAGE_ID[appId]])
		.map(project => UI_PACKAGE_ID_BY_PROJECT_ID.get(project.id))
		.filter((packageId): packageId is UiPackageId => packageId !== undefined)
}

export const getUiPackageRoot = (uiRoot: string, packageId: UiPackageId) => path.resolve(uiRoot, '..', getUiProject(packageId).path)

export function parseUiAppIdFromProcess(context: string): UiAppId {
	return parseUiAppId(process.argv[2] ?? process.env['UI_APP'], context)
}

export type UiAppPaths = {
	readonly appId: UiAppId
	readonly repositoryRoot: string
	readonly uiRoot: string
	readonly coreSharedRoot: string
	readonly appRoot: string
	readonly appSourceRoot: string
	readonly appGeneratedJsRoot: string
	readonly appDistRoot: string
	readonly appDistAssetsRoot: string
	readonly appIndexHtml: string
	readonly appEntrypoint: string
	readonly workerEntrypoint: string
	readonly coreSharedCssRoot: string
	readonly faviconSvg: string
	readonly vendorBuildScript: string
	readonly workersBuildScript: string
	readonly testsBuildScript: string
	readonly productionBuildScript: string
	readonly projectArtifactsScript: string
	readonly bundlerPathsScript: string
	readonly devServerScript: string
	readonly sharedSourceRoots: readonly string[]
	readonly sharedGeneratedJsRoots: readonly string[]
}

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))

export function getUiAppPaths(appId: UiAppId): UiAppPaths {
	const repositoryRoot = path.resolve(directoryOfThisFile, '..', '..')
	const uiRoot = path.join(repositoryRoot, 'ui')
	const coreSharedRoot = path.join(uiRoot, 'coreShared')
	const appRoot = path.join(uiRoot, appId)
	const appSourceRoot = path.join(appRoot, 'ts')
	const appGeneratedJsRoot = path.join(appRoot, 'js')
	const appDistRoot = path.join(appRoot, 'dist')
	const buildRoot = directoryOfThisFile
	return {
		appId,
		repositoryRoot,
		uiRoot,
		coreSharedRoot,
		appRoot,
		appSourceRoot,
		appGeneratedJsRoot,
		appDistRoot,
		appDistAssetsRoot: path.join(appDistRoot, 'assets'),
		appIndexHtml: path.join(appRoot, 'index.html'),
		appEntrypoint: path.join(appSourceRoot, 'index.ts'),
		workerEntrypoint: path.join(appSourceRoot, 'simulation', 'tevmWorker.ts'),
		coreSharedCssRoot: path.join(coreSharedRoot, 'css'),
		faviconSvg: path.join(appRoot, 'favicon.svg'),
		vendorBuildScript: path.join(buildRoot, 'vendor.mts'),
		workersBuildScript: path.join(buildRoot, 'workers.mts'),
		testsBuildScript: path.join(buildRoot, 'tests.mts'),
		productionBuildScript: path.join(buildRoot, 'production.mts'),
		projectArtifactsScript: path.join(buildRoot, 'projectArtifacts.mts'),
		bundlerPathsScript: path.join(buildRoot, 'bundlerPaths.mts'),
		devServerScript: path.join(buildRoot, 'dev-server.ts'),
		sharedSourceRoots: sharedPackageClosure(appSharedPackages[appId]).map(entry => path.join(repositoryRoot, entry.path, 'ts')),
		sharedGeneratedJsRoots: sharedPackageClosure(appSharedPackages[appId]).map(entry => path.join(repositoryRoot, entry.path, 'js')),
	}
}

export function getUiCoreSharedPaths() {
	const repositoryRoot = path.resolve(directoryOfThisFile, '..', '..')
	const uiRoot = path.join(repositoryRoot, 'ui')
	const coreSharedRoot = path.join(uiRoot, 'coreShared')
	return {
		repositoryRoot,
		uiRoot,
		coreSharedRoot,
		coreSharedSourceRoot: path.join(coreSharedRoot, 'ts'),
		coreSharedGeneratedJsRoot: path.join(coreSharedRoot, 'js'),
		coreSharedTestSourceRoot: path.join(coreSharedRoot, 'ts', 'tests'),
		coreSharedTestOutputRoot: path.join(coreSharedRoot, 'js', 'tests'),
		sharedSourceRoots: sharedPackageClosure(appSharedPackages.zoltar).map(entry => path.join(repositoryRoot, entry.path, 'ts')),
		sharedGeneratedJsRoots: sharedPackageClosure(appSharedPackages.zoltar).map(entry => path.join(repositoryRoot, entry.path, 'js')),
	}
}
