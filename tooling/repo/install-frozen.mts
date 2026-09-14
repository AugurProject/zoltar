import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export function workspaceInstall(directory: string, production = false) {
	let root = path.resolve(directory)
	while (true) {
		const manifestPath = path.join(root, 'package.json')
		if (existsSync(manifestPath)) {
			const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
			if (typeof manifest === 'object' && manifest !== null && 'workspaces' in manifest) {
				if (!('packageManager' in manifest) || typeof manifest.packageManager !== 'string') throw new Error('Workspace must pin its Bun package manager')
				const version = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)?.[1]
				if (version === undefined) throw new Error('Workspace must pin an exact Bun version')
				if (process.versions.bun !== version) throw new Error(`Install Bun ${version} before installing this workspace`)
				return { cwd: root, command: [process.execPath, 'install', '--frozen-lockfile', ...(production ? ['--production'] : [])] }
			}
		}
		const parent = path.dirname(root)
		if (parent === root) throw new Error(`No Bun workspace found for ${directory}`)
		root = parent
	}
}

if (import.meta.main) {
	const [directory = '.', ...options] = process.argv.slice(2)
	if (options.some(option => option !== '--production')) throw new Error('Only --production is supported after the install directory')
	const plan = workspaceInstall(directory, options.includes('--production'))
	const child = Bun.spawn(plan.command, { cwd: plan.cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	process.exit(await child.exited)
}
