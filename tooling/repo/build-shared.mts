import { fileURLToPath } from 'node:url'
import { appSharedPackages, sharedPackageClosure, sharedPackages } from './sharedPackages.ts'

const requested = process.argv[2]
let ids: readonly string[] = sharedPackages.map(entry => entry.id)
if (requested !== undefined) ids = requested === 'zoltar' || requested === 'statoblast' || requested === 'trading' ? appSharedPackages[requested] : [requested]
const packages = sharedPackageClosure(ids)
if (packages.length === 0) throw new Error(`Unknown shared build target: ${requested}`)
for (const entry of packages) {
	const child = Bun.spawn([process.execPath, 'x', 'tsc', '--project', `${entry.path}/tsconfig.json`], { cwd: fileURLToPath(new URL('../..', import.meta.url)), stdout: 'inherit', stderr: 'inherit' })
	if ((await child.exited) !== 0) process.exit(1)
}
