import * as path from 'node:path'
import { repositoryRoot as repositoryRootPath } from '../repo/root.mts'
import { preactSingletonDependencyPaths, shareUiPreactRuntime } from './share-ui-preact-runtime.mjs'

export const uiPackageIds = ['coreShared', 'zoltarShared', 'statoblastShared', 'zoltar', 'statoblast', 'trading'] as const
export { preactSingletonDependencyPaths }

export async function ensureUiPreactSingleton(rootPath = repositoryRootPath) {
	for (const packageId of uiPackageIds) shareUiPreactRuntime(path.join(rootPath, 'ui', packageId))
}

if (import.meta.main) await ensureUiPreactSingleton()
