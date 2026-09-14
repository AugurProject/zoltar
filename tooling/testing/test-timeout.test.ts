import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

test('the preload and repository runner respect both forms of CLI timeout', async () => {
	const root = path.resolve(import.meta.dir, '../..')
	const directory = await mkdtemp(path.join(root, '.timeout-probe-'))
	try {
		const file = path.join(directory, 'slow.test.ts')
		await writeFile(file, "import { test } from 'bun:test'\ntest('slow probe', async () => { await Bun.sleep(200) })\n")
		for (const args of [
			['test', '--timeout', '20'],
			['tooling/testing/bun-test.mts', '--timeout', '20'],
			['tooling/testing/bun-test.mts', '--timeout=20'],
		]) {
			const child = Bun.spawn([process.execPath, ...args, file], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
			const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
			expect(code).not.toBe(0)
			expect(stderr).toContain('timed out')
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('the repository runner allows tests longer than Bun’s five-second fallback', async () => {
	const root = path.resolve(import.meta.dir, '../..')
	const directory = await mkdtemp(path.join(root, '.timeout-probe-'))
	try {
		const file = path.join(directory, 'slow.test.ts')
		await writeFile(file, "import { test } from 'bun:test'\ntest('slow probe', async () => { await Bun.sleep(5100) })\n")
		const child = Bun.spawn([process.execPath, 'tooling/testing/bun-test.mts', file], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
		const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		expect(stderr).not.toContain('timed out')
		expect(code).toBe(0)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 15_000)
