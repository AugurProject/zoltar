import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROMIUM_COMMAND_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'msedge'] as const
const CHROMIUM_TEST_LOCK_DIRECTORY = join(tmpdir(), 'zoltar-chromium-test.lock')
const CHROMIUM_TEST_LOCK_OWNER_PATH = join(CHROMIUM_TEST_LOCK_DIRECTORY, 'owner-pid')
const CHROMIUM_TEST_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const CHROMIUM_TEST_LOCK_STALE_MS = 15 * 60 * 1000
const CHROMIUM_TEST_LOCK_INITIALIZATION_GRACE_MS = 5_000

const getWindowsChromiumPaths = (environment: Readonly<Record<string, string | undefined>>): string[] => {
	const localAppData = environment['LOCALAPPDATA']
	const programFiles = environment['PROGRAMFILES']
	const programFilesX86 = environment['PROGRAMFILES(X86)']
	return [
		...(localAppData === undefined ? [] : [win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), win32.join(localAppData, 'Chromium', 'Application', 'chrome.exe'), win32.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
		...(programFiles === undefined ? [] : [win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), win32.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
		...(programFilesX86 === undefined ? [] : [win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), win32.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
	]
}

export const getChromiumPath = ({
	environment = process.env,
	fileExists = existsSync,
	platform = process.platform,
	which = Bun.which,
}: {
	readonly environment?: Readonly<Record<string, string | undefined>>
	readonly fileExists?: (path: string) => boolean
	readonly platform?: NodeJS.Platform
	readonly which?: (commandName: string) => string | null
} = {}): string | undefined => {
	for (const commandName of CHROMIUM_COMMAND_NAMES) {
		const commandPath = which(commandName)
		if (commandPath !== null) return commandPath
	}

	if (platform === 'win32') {
		for (const commandPath of getWindowsChromiumPaths(environment)) {
			if (fileExists(commandPath)) return commandPath
		}
	}
	return undefined
}

const hasErrorCode = (error: unknown, code: string): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === code

const isProcessRunning = (pid: number): boolean => {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return !hasErrorCode(error, 'ESRCH')
	}
}

const removeAbandonedChromiumTestLock = async (): Promise<boolean> => {
	try {
		const ownerText = await readFile(CHROMIUM_TEST_LOCK_OWNER_PATH, 'utf8')
		const ownerPid = Number(ownerText)
		if (Number.isSafeInteger(ownerPid) && ownerPid > 0 && isProcessRunning(ownerPid)) return false
		await rm(CHROMIUM_TEST_LOCK_DIRECTORY, { force: true, recursive: true })
		return true
	} catch (error) {
		if (!hasErrorCode(error, 'ENOENT')) throw error
		try {
			const lockStats = await stat(CHROMIUM_TEST_LOCK_DIRECTORY)
			if (Date.now() - lockStats.mtimeMs < CHROMIUM_TEST_LOCK_INITIALIZATION_GRACE_MS) return false
			await rm(CHROMIUM_TEST_LOCK_DIRECTORY, { force: true, recursive: true })
			return true
		} catch (statError) {
			if (hasErrorCode(statError, 'ENOENT')) return true
			throw statError
		}
	}
}

const acquireChromiumTestLock = async (): Promise<void> => {
	const deadline = Date.now() + CHROMIUM_TEST_LOCK_TIMEOUT_MS
	while (Date.now() < deadline) {
		try {
			await mkdir(CHROMIUM_TEST_LOCK_DIRECTORY)
			try {
				await writeFile(CHROMIUM_TEST_LOCK_OWNER_PATH, process.pid.toString())
				return
			} catch (error) {
				await rm(CHROMIUM_TEST_LOCK_DIRECTORY, { force: true, recursive: true })
				throw error
			}
		} catch (error) {
			if (!hasErrorCode(error, 'EEXIST')) throw error
			if (await removeAbandonedChromiumTestLock()) continue
			const lockStats = await stat(CHROMIUM_TEST_LOCK_DIRECTORY)
			if (Date.now() - lockStats.mtimeMs >= CHROMIUM_TEST_LOCK_STALE_MS) {
				await rm(CHROMIUM_TEST_LOCK_DIRECTORY, { force: true, recursive: true })
				continue
			}
			await sleep(100)
		}
	}
	throw new Error(`Timed out waiting ${CHROMIUM_TEST_LOCK_TIMEOUT_MS.toString()}ms for the shared Chromium test lock.`)
}

export const withChromiumTestLock = async <TValue>(run: () => Promise<TValue>): Promise<TValue> => {
	await acquireChromiumTestLock()
	try {
		return await run()
	} finally {
		await rm(CHROMIUM_TEST_LOCK_DIRECTORY, { force: true, recursive: true })
	}
}
