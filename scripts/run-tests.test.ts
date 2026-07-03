import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { DEFAULT_ANVIL_STATE_MAX_AGE_MS } from './cleanup-foundry-anvil-state.mts'

const createTemporaryDirectory = async (prefix: string) => await mkdtemp(join(tmpdir(), prefix))

const runTestWrapper = async ({ homeDirectory, testFile }: { readonly homeDirectory: string; readonly testFile: string }) => {
	const child = Bun.spawn({
		cmd: [process.execPath, './scripts/run-tests.mts', '--parallel=1', testFile],
		env: {
			...process.env,
			HOME: homeDirectory,
		},
		stderr: 'pipe',
		stdout: 'pipe',
	})
	const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
	return { exitCode, stderr, stdout }
}

test('run-tests cleans stale Anvil state before and after a passing child test', async () => {
	const workspaceDirectory = await createTemporaryDirectory('run-tests-cleanup-')
	const homeDirectory = join(workspaceDirectory, 'home')
	const stateDirectory = join(homeDirectory, '.foundry', 'anvil', 'tmp')
	const staleStateDirectory = join(stateDirectory, 'anvil-state-stale')
	const freshStateDirectory = join(stateDirectory, 'anvil-state-fresh')
	const testFile = join(workspaceDirectory, 'passing.test.ts')

	try {
		await mkdir(staleStateDirectory, { recursive: true })
		await mkdir(freshStateDirectory, { recursive: true })
		await writeFile(testFile, "import { expect, test } from 'bun:test'\ntest('passes', () => expect(1).toBe(1))\n")
		const staleTime = new Date(Date.now() - DEFAULT_ANVIL_STATE_MAX_AGE_MS - 60_000)
		await utimes(staleStateDirectory, staleTime, staleTime)

		const result = await runTestWrapper({ homeDirectory, testFile })

		expect(result.exitCode).toBe(0)
		expect(existsSync(staleStateDirectory)).toBe(false)
		expect(existsSync(freshStateDirectory)).toBe(true)
		expect(result.stderr).toContain('Deleted 1 stale Anvil state directory before tests')
	} finally {
		await rm(workspaceDirectory, { recursive: true, force: true })
	}
})

test('run-tests preserves a failing child exit code when cleanup fails', async () => {
	const workspaceDirectory = await createTemporaryDirectory('run-tests-cleanup-failure-')
	const homeDirectory = join(workspaceDirectory, 'home-file')
	const testFile = join(workspaceDirectory, 'failing.test.ts')

	try {
		await writeFile(homeDirectory, 'not a directory')
		await writeFile(testFile, "import { expect, test } from 'bun:test'\ntest('fails', () => expect(1).toBe(2))\n")

		const result = await runTestWrapper({ homeDirectory, testFile })

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('Failed to clean stale Anvil state directories before tests')
		expect(result.stderr).toContain('Failed to clean stale Anvil state directories after tests')
	} finally {
		await rm(workspaceDirectory, { recursive: true, force: true })
	}
})
