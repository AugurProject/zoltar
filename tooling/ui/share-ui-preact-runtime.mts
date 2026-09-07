import { existsSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import * as path from 'node:path'

export const preactSingletonDependencyPaths = ['preact', '@preact/signals', '@preact/signals-core'] as const

export function shareUiPreactRuntime(installDirectory: string) {
	if (path.basename(path.dirname(installDirectory)) !== 'ui') return false
	const repositoryRoot = path.dirname(path.dirname(installDirectory))
	const dependencyPaths = preactSingletonDependencyPaths.map(dependencyPath => ({
		root: path.join(repositoryRoot, 'node_modules', dependencyPath),
		local: path.join(installDirectory, 'node_modules', dependencyPath),
	}))
	let changed = false

	for (const dependencyPath of dependencyPaths) {
		if (!existsSync(dependencyPath.root)) throw new Error(`Required root dependency is missing: ${dependencyPath.root}`)
		if (!existsSync(dependencyPath.local)) throw new Error(`Required UI dependency is missing: ${dependencyPath.local}`)
	}

	for (const dependencyPath of dependencyPaths) {
		if (realpathSync(dependencyPath.root) === realpathSync(dependencyPath.local)) continue

		rmSync(dependencyPath.local, { recursive: true })
		const linkTarget = process.platform === 'win32' ? dependencyPath.root : path.relative(path.dirname(dependencyPath.local), dependencyPath.root)
		symlinkSync(linkTarget, dependencyPath.local, process.platform === 'win32' ? 'junction' : 'dir')
		changed = true
	}

	return changed
}
