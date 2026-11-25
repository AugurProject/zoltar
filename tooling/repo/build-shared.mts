import { repositoryRoot } from './root.mts'
import { appSharedPackages, isSharedPackageId, type SharedPackageId, sharedPackageClosure, sharedPackages } from './sharedPackages.ts'
import { isUiAppId } from '../ui/appIds.mts'

const requested = process.argv[2]
let ids: readonly SharedPackageId[] = sharedPackages.map(entry => entry.id)
if (requested !== undefined) {
	if (isUiAppId(requested)) ids = appSharedPackages[requested]
	else if (isSharedPackageId(requested)) ids = [requested]
	else throw new Error(`Unknown shared build target: ${requested}`)
}
const packages = sharedPackageClosure(ids)
for (const entry of packages) {
	const child = Bun.spawn([process.execPath, 'x', 'tsc', '--project', `${entry.path}/tsconfig.json`], { cwd: repositoryRoot, stdout: 'inherit', stderr: 'inherit' })
	if ((await child.exited) !== 0) process.exit(1)
}
