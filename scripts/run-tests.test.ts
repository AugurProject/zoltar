import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { DEFAULT_ANVIL_STATE_MAX_AGE_MS } from './cleanup-foundry-anvil-state.mts'

const createTemporaryDirectory = async (prefix: string) => await mkdtemp(join(tmpdir(), prefix))

const runTestWrapper = async ({ homeDirectory, testFile, useExistingProductionBuild = false }: { readonly homeDirectory: string; readonly testFile: string; readonly useExistingProductionBuild?: boolean }) => {
	const child = Bun.spawn({
		cmd: [process.execPath, './scripts/run-tests.mts', '--parallel=1', testFile],
		env: {
			...process.env,
			HOME: homeDirectory,
			...(useExistingProductionBuild ? { ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1' } : {}),
		},
		stderr: 'pipe',
		stdout: 'pipe',
	})
	const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
	return { exitCode, stderr, stdout }
}

test('run-tests preserves a prepared production build when requested', async () => {
	const workspaceDirectory = await createTemporaryDirectory('run-tests-existing-production-build-')
	const homeDirectory = join(workspaceDirectory, 'home')
	const testFile = join(workspaceDirectory, 'passing.test.ts')
	const productionBuildMarker = join(process.cwd(), 'ui', 'dist', 'run-tests-existing-production-build.marker')

	try {
		await mkdir(join(process.cwd(), 'ui', 'dist'), { recursive: true })
		await writeFile(productionBuildMarker, 'prepared')
		await writeFile(testFile, "import { expect, test } from 'bun:test'\ntest('passes', () => expect(1).toBe(1))\n")

		const result = await runTestWrapper({ homeDirectory, testFile, useExistingProductionBuild: true })

		expect(result.exitCode).toBe(0)
		expect(existsSync(productionBuildMarker)).toBe(true)
	} finally {
		await rm(productionBuildMarker, { force: true })
		await rm(workspaceDirectory, { recursive: true, force: true })
	}
})

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
