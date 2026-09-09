import { expect, test } from 'bun:test'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const scriptPath = path.join(import.meta.dir, 'link-shared-node-modules.mts')

test('preinstall linker runs without dependencies in an isolated non-git checkout', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-preinstall-linker-'))
	try {
		const result = Bun.spawnSync([process.execPath, scriptPath], { cwd: temporaryRoot, stderr: 'pipe', stdout: 'pipe' })
		expect(result.exitCode).toBe(0)
		expect((await lstat(path.join(temporaryRoot, 'node_modules'))).isDirectory()).toBe(true)
	} finally {
		await rm(temporaryRoot, { force: true, recursive: true })
	}
})
