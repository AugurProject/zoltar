import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { workspaceInstall } from './install-frozen.mts'

test('workspace installs preserve the lock and expose live package edits without refresh tasks', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'zoltar-workspace-'))
	const run = (command: string[], cwd = root) => Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
	try {
		await mkdir(path.join(root, 'packages/library'), { recursive: true })
		await mkdir(path.join(root, 'packages/app'), { recursive: true })
		await writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, packageManager: `bun@${process.versions.bun}`, workspaces: ['packages/*'] }))
		await writeFile(path.join(root, 'packages/library/package.json'), JSON.stringify({ name: 'workspace-library', version: '1.0.0', exports: './index.ts' }))
		await writeFile(path.join(root, 'packages/library/index.ts'), 'export default 1\n')
		await writeFile(path.join(root, 'packages/app/package.json'), JSON.stringify({ name: 'workspace-app', version: '1.0.0', dependencies: { 'workspace-library': 'workspace:1.0.0' } }))
		expect(run([process.execPath, 'install']).exitCode).toBe(0)
		const lock = await readFile(path.join(root, 'bun.lock'), 'utf8')
		const plan = workspaceInstall(path.join(root, 'packages/app'))
		expect(plan.cwd).toBe(root)
		expect(run(plan.command, plan.cwd).exitCode).toBe(0)
		expect(await readFile(path.join(root, 'bun.lock'), 'utf8')).toBe(lock)
		const resolve = run([process.execPath, '-e', "console.log(import.meta.resolve('workspace-library'))"], path.join(root, 'packages/app'))
		expect(resolve.exitCode).toBe(0)
		expect(await realpath(new URL(resolve.stdout.toString().trim()))).toBe(path.join(root, 'packages/library/index.ts'))
		await writeFile(path.join(root, 'packages/library/index.ts'), 'export default 2\n')
		const current = run([process.execPath, '-e', "import value from 'workspace-library'; console.log(value)"], path.join(root, 'packages/app'))
		expect(current.stdout.toString().trim()).toBe('2')
		await writeFile(path.join(root, 'packages/library/package.json'), JSON.stringify({ name: 'workspace-library', version: '2.0.0', exports: './index.ts' }))
		expect(run(plan.command, plan.cwd).exitCode).not.toBe(0)
		expect(await readFile(path.join(root, 'bun.lock'), 'utf8')).toBe(lock)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
