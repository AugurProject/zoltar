import { existsSync } from 'node:fs'
import { createConnection, createServer, type Server } from 'node:net'
import { win32 } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROMIUM_COMMAND_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'msedge'] as const
const CHROMIUM_TEST_LOCK_HOST = '127.0.0.1'
const CHROMIUM_TEST_LOCK_PORT = 43871
const CHROMIUM_TEST_LOCK_SIGNATURE = 'zoltar-chromium-test-lock-v1'
const CHROMIUM_TEST_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const CHROMIUM_TEST_LOCK_PROBE_TIMEOUT_MS = 2_000

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

const listenForChromiumTestLock = async (port: number): Promise<Server | undefined> => {
	const server = createServer(socket => socket.end(CHROMIUM_TEST_LOCK_SIGNATURE))
	const outcome = await new Promise<'listening' | 'occupied'>((resolve, reject) => {
		server.once('error', error => {
			if (hasErrorCode(error, 'EADDRINUSE')) resolve('occupied')
			else reject(error)
		})
		server.listen(port, CHROMIUM_TEST_LOCK_HOST, () => resolve('listening'))
	})
	if (outcome === 'listening') return server
	return undefined
}

const probeChromiumTestLock = async (port: number): Promise<'released' | 'zoltar-lock'> =>
	await new Promise((resolve, reject) => {
		const socket = createConnection({ host: CHROMIUM_TEST_LOCK_HOST, port })
		let response = ''
		const timeoutId = setTimeout(() => socket.destroy(new Error(`Timed out probing port ${port.toString()} for the Chromium test lock.`)), CHROMIUM_TEST_LOCK_PROBE_TIMEOUT_MS)
		socket.setEncoding('utf8')
		socket.on('data', chunk => {
			response += chunk
		})
		socket.once('end', () => {
			clearTimeout(timeoutId)
			if (response === CHROMIUM_TEST_LOCK_SIGNATURE) resolve('zoltar-lock')
			else reject(new Error(`Port ${port.toString()} is occupied by a process other than the Zoltar Chromium test lock.`))
		})
		socket.once('error', error => {
			clearTimeout(timeoutId)
			if (hasErrorCode(error, 'ECONNREFUSED') || hasErrorCode(error, 'ECONNRESET')) resolve('released')
			else reject(error)
		})
	})

const acquireChromiumTestLock = async (port: number): Promise<Server> => {
	const deadline = Date.now() + CHROMIUM_TEST_LOCK_TIMEOUT_MS
	while (Date.now() < deadline) {
		const server = await listenForChromiumTestLock(port)
		if (server !== undefined) return server
		if ((await probeChromiumTestLock(port)) === 'released') continue
		await sleep(100)
	}
	throw new Error(`Timed out waiting ${CHROMIUM_TEST_LOCK_TIMEOUT_MS.toString()}ms for the shared Chromium test lock.`)
}

const closeServer = async (server: Server): Promise<void> => await new Promise((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))

export const withChromiumTestLock = async <TValue>(run: () => Promise<TValue>, { port = CHROMIUM_TEST_LOCK_PORT }: { readonly port?: number } = {}): Promise<TValue> => {
	const server = await acquireChromiumTestLock(port)
	try {
		return await run()
	} finally {
		await closeServer(server)
	}
}
