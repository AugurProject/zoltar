import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

export const UI_APP_IDS = ['zoltar', 'statoblast', 'trading'] as const
export type UiAppId = (typeof UI_APP_IDS)[number]
export type UiPackageId = 'coreShared' | UiAppId

export function getUiAppDependencyOrder(appId: UiAppId): readonly UiPackageId[] {
	if (appId === 'trading') return ['coreShared', 'zoltar', 'statoblast', 'trading']
	return appId === 'statoblast' ? ['coreShared', 'zoltar', 'statoblast'] : ['coreShared', 'zoltar']
}

export function isUiAppId(candidate: string): candidate is UiAppId {
	return (UI_APP_IDS as readonly string[]).includes(candidate)
}

export function parseUiAppId(candidate: string | undefined, context: string): UiAppId {
	if (candidate === undefined || candidate === '') throw new Error(`Missing UI app ID for ${context}; expected one of: ${UI_APP_IDS.join(', ')}`)
	if (!isUiAppId(candidate)) throw new Error(`Unknown UI app ID '${candidate}' for ${context}; expected one of: ${UI_APP_IDS.join(', ')}`)
	return candidate
}

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
	readonly faviconIco: string
	readonly faviconSvg: string
	readonly vendorBuildScript: string
	readonly workersBuildScript: string
	readonly testsBuildScript: string
	readonly productionBuildScript: string
	readonly projectArtifactsScript: string
	readonly bundlerPathsScript: string
	readonly devServerScript: string
	readonly sharedSourceRoot: string
	readonly sharedGeneratedJsRoot: string
}

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))

export function getUiAppPaths(appId: UiAppId): UiAppPaths {
	const coreSharedRoot = path.resolve(directoryOfThisFile, '..')
	const uiRoot = path.resolve(coreSharedRoot, '..')
	const repositoryRoot = path.resolve(uiRoot, '..')
	const appRoot = path.join(uiRoot, appId)
	const appSourceRoot = path.join(appRoot, 'ts')
	const appGeneratedJsRoot = path.join(appRoot, 'js')
	const appDistRoot = path.join(appRoot, 'dist')
	const buildRoot = path.join(coreSharedRoot, 'build')
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
		faviconIco: path.join(coreSharedRoot, 'favicon.ico'),
		faviconSvg: path.join(coreSharedRoot, 'favicon.svg'),
		vendorBuildScript: path.join(buildRoot, 'vendor.mts'),
		workersBuildScript: path.join(buildRoot, 'workers.mts'),
		testsBuildScript: path.join(buildRoot, 'tests.mts'),
		productionBuildScript: path.join(buildRoot, 'production.mts'),
		projectArtifactsScript: path.join(buildRoot, 'projectArtifacts.mts'),
		bundlerPathsScript: path.join(buildRoot, 'bundlerPaths.mts'),
		devServerScript: path.join(coreSharedRoot, 'dev-server.ts'),
		sharedSourceRoot: path.join(repositoryRoot, 'shared', 'ts'),
		sharedGeneratedJsRoot: path.join(repositoryRoot, 'shared', 'js'),
	}
}

export function getUiCoreSharedPaths() {
	const coreSharedRoot = path.resolve(directoryOfThisFile, '..')
	const uiRoot = path.resolve(coreSharedRoot, '..')
	const repositoryRoot = path.resolve(uiRoot, '..')
	return {
		repositoryRoot,
		uiRoot,
		coreSharedRoot,
		coreSharedSourceRoot: path.join(coreSharedRoot, 'ts'),
		coreSharedGeneratedJsRoot: path.join(coreSharedRoot, 'js'),
		coreSharedTestSourceRoot: path.join(coreSharedRoot, 'ts', 'tests'),
		coreSharedTestOutputRoot: path.join(coreSharedRoot, 'js', 'tests'),
		sharedSourceRoot: path.join(repositoryRoot, 'shared', 'ts'),
		sharedGeneratedJsRoot: path.join(repositoryRoot, 'shared', 'js'),
	}
}
