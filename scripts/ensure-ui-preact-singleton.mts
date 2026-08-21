import * as path from 'node:path'
import * as url from 'node:url'
import { preactSingletonDependencyPaths, shareUiPreactRuntime } from './share-ui-preact-runtime.mjs'

export const uiPackageIds = ['coreShared', 'zoltar', 'statoblast', 'trading'] as const
export { preactSingletonDependencyPaths }

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..')

export async function ensureUiPreactSingleton(rootPath = repositoryRootPath) {
	for (const packageId of uiPackageIds) shareUiPreactRuntime(path.join(rootPath, 'ui', packageId))
}

if (import.meta.main) await ensureUiPreactSingleton()
