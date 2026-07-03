import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { cleanupFoundryAnvilState, DEFAULT_ANVIL_STATE_MAX_AGE_MS } from './cleanup-foundry-anvil-state.mts'

const createTemporaryStateDirectory = async () => await mkdtemp(join(tmpdir(), 'anvil-state-cleanup-'))

const setDirectoryMtime = async (directory: string, time: Date) => {
	await utimes(directory, time, time)
}

test('cleanupFoundryAnvilState deletes only stale Anvil state directories', async () => {
	const stateDirectory = await createTemporaryStateDirectory()
	const now = new Date('2026-07-03T13:00:00Z')
	const staleStateDirectory = join(stateDirectory, 'anvil-state-stale')
	const freshStateDirectory = join(stateDirectory, 'anvil-state-fresh')
	const unrelatedDirectory = join(stateDirectory, 'unrelated-state-stale')

	try {
		await mkdir(staleStateDirectory)
		await writeFile(join(staleStateDirectory, 'state.json'), '{}')
		await mkdir(freshStateDirectory)
		await writeFile(join(freshStateDirectory, 'state.json'), '{}')
		await mkdir(unrelatedDirectory)
		await writeFile(join(stateDirectory, 'anvil-state-file'), '{}')
		await setDirectoryMtime(staleStateDirectory, new Date(now.getTime() - DEFAULT_ANVIL_STATE_MAX_AGE_MS - 1))
		await setDirectoryMtime(freshStateDirectory, new Date(now.getTime() - DEFAULT_ANVIL_STATE_MAX_AGE_MS + 1))
		await setDirectoryMtime(unrelatedDirectory, new Date(now.getTime() - DEFAULT_ANVIL_STATE_MAX_AGE_MS - 1))

		const result = await cleanupFoundryAnvilState({ now, stateDirectory })
		const remainingEntries = await readdir(stateDirectory)

		expect(result).toEqual({ deletedCount: 1, skippedCount: 3, stateDirectory })
		expect(remainingEntries.sort()).toEqual(['anvil-state-file', 'anvil-state-fresh', 'unrelated-state-stale'])
	} finally {
		await rm(stateDirectory, { recursive: true, force: true })
	}
})

test('cleanupFoundryAnvilState tolerates a missing state directory', async () => {
	const stateDirectory = join(tmpdir(), 'missing-anvil-state-directory')

	await rm(stateDirectory, { recursive: true, force: true })

	expect(await cleanupFoundryAnvilState({ stateDirectory })).toEqual({ deletedCount: 0, skippedCount: 0, stateDirectory })
})
