import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ANVIL_STATE_DIRECTORY_PREFIX = 'anvil-state-'
export const DEFAULT_ANVIL_STATE_MAX_AGE_MS = 3 * 60 * 60 * 1000

export type CleanupFoundryAnvilStateResult = {
	readonly deletedCount: number
	readonly skippedCount: number
	readonly stateDirectory: string
}

const getDefaultAnvilStateDirectory = (): string => process.env['ZOLTAR_ANVIL_STATE_DIRECTORY']?.trim() || join(homedir(), '.foundry', 'anvil', 'tmp')

const isMissingPathError = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

export const cleanupFoundryAnvilState = async ({ maxAgeMs = DEFAULT_ANVIL_STATE_MAX_AGE_MS, now = new Date(), stateDirectory = getDefaultAnvilStateDirectory() }: { readonly maxAgeMs?: number; readonly now?: Date; readonly stateDirectory?: string } = {}): Promise<CleanupFoundryAnvilStateResult> => {
	const cutoffTime = now.getTime() - maxAgeMs
	let entries: string[]

	try {
		entries = await readdir(stateDirectory)
	} catch (error) {
		if (isMissingPathError(error)) return { deletedCount: 0, skippedCount: 0, stateDirectory }
		throw error
	}

	let deletedCount = 0
	let skippedCount = 0

	for (const entry of entries) {
		if (!entry.startsWith(ANVIL_STATE_DIRECTORY_PREFIX)) {
			skippedCount += 1
			continue
		}

		const entryPath = join(stateDirectory, entry)
		let entryStats: Awaited<ReturnType<typeof stat>>

		try {
			entryStats = await stat(entryPath)
		} catch (error) {
			if (isMissingPathError(error)) continue
			throw error
		}

		if (!entryStats.isDirectory() || entryStats.mtimeMs >= cutoffTime) {
			skippedCount += 1
			continue
		}

		await rm(entryPath, { recursive: true, force: true })
		deletedCount += 1
	}

	return { deletedCount, skippedCount, stateDirectory }
}
