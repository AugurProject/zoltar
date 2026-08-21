import { existsSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import * as path from 'node:path'

export function shareUiPreactRuntime(installDirectory: string) {
	if (path.basename(path.dirname(installDirectory)) !== 'ui') return false
	const repositoryRoot = path.dirname(path.dirname(installDirectory))
	const rootPreactPath = path.join(repositoryRoot, 'node_modules', 'preact')
	const localPreactPath = path.join(installDirectory, 'node_modules', 'preact')
	if (!existsSync(rootPreactPath) || !existsSync(localPreactPath)) return false
	if (realpathSync(rootPreactPath) === realpathSync(localPreactPath)) return false
	rmSync(localPreactPath, { recursive: true })
	const linkTarget = process.platform === 'win32' ? rootPreactPath : path.relative(path.dirname(localPreactPath), rootPreactPath)
	symlinkSync(linkTarget, localPreactPath, process.platform === 'win32' ? 'junction' : 'dir')
	return true
}
