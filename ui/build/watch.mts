import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const REPOSITORY_ROOT_PATH = path.join(UI_ROOT_PATH, '..')
const DEV_SERVER_PATH = path.join(UI_ROOT_PATH, 'dev-server.mjs')
const VENDOR_INPUT_PATHS = [
	path.join(UI_ROOT_PATH, 'build', 'vendor.mts'),
	path.join(UI_ROOT_PATH, 'package.json'),
	path.join(UI_ROOT_PATH, 'tsconfig.vendor.json'),
	path.join(UI_ROOT_PATH, 'bun.lock'),
]

type ManagedProcess = ReturnType<typeof spawn>

let shuttingDown = false
let restartingServer = false
let serverProcess: ManagedProcess | undefined
let typeScriptWatchProcess: ManagedProcess | undefined
let vendorBuildRunning = false
let vendorBuildQueued = false

const unwatchCallbacks: Array<() => void> = []

const waitForProcessExit = async (childProcess: ManagedProcess) => {
	const [exitCode, signalCode] = await once(childProcess, 'exit') as [number | null, NodeJS.Signals | null]
	return { exitCode, signalCode }
}

const stopProcess = async (childProcess: ManagedProcess | undefined) => {
	if (childProcess === undefined) return
	if (childProcess.exitCode !== null) return
	childProcess.kill('SIGTERM')
	const forceKillTimeout = setTimeout(() => {
		if (childProcess.exitCode === null) {
			childProcess.kill('SIGKILL')
		}
	}, 2_000)
	try {
		await waitForProcessExit(childProcess)
	} finally {
		clearTimeout(forceKillTimeout)
	}
}

const spawnServer = () => {
	console.log('[ui:watch] Starting ui:serve')
	serverProcess = spawn('bun', ['./ui/dev-server.mjs'], {
		cwd: REPOSITORY_ROOT_PATH,
		stdio: 'inherit',
	})
	serverProcess.on('exit', (exitCode, signalCode) => {
		if (shuttingDown || restartingServer) return
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] ui:serve exited unexpectedly (${ signalCode ?? failureCode })`)
		void shutdown(failureCode)
	})
}

const restartServer = async (reason: string) => {
	if (shuttingDown) return
	console.log(`[ui:watch] Restarting ui:serve because ${ reason } changed`)
	restartingServer = true
	try {
		await stopProcess(serverProcess)
		spawnServer()
	} finally {
		restartingServer = false
	}
}

const runVendorBuild = async (reason: string) => {
	if (shuttingDown) return
	if (vendorBuildRunning) {
		vendorBuildQueued = true
		return
	}
	vendorBuildRunning = true
	console.log(`[ui:watch] Rebuilding UI vendor assets because ${ reason } changed`)
	const childProcess = spawn('bun', ['./build/vendor.mts'], {
		cwd: UI_ROOT_PATH,
		stdio: 'inherit',
	})
	const { exitCode, signalCode } = await waitForProcessExit(childProcess)
	vendorBuildRunning = false
	if (exitCode !== 0) {
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] Vendor rebuild failed (${ signalCode ?? failureCode })`)
		await shutdown(failureCode)
		return
	}
	if (vendorBuildQueued) {
		vendorBuildQueued = false
		await runVendorBuild('queued vendor input')
	}
}

const watchFile = (filePath: string, onChange: (relativePath: string) => void) => {
	let debounceTimeout: NodeJS.Timeout | undefined
	const listener = (currentStat: fs.Stats, previousStat: fs.Stats) => {
		if (currentStat.mtimeMs === previousStat.mtimeMs) return
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		debounceTimeout = setTimeout(() => {
			debounceTimeout = undefined
			const relativePath = path.relative(UI_ROOT_PATH, filePath).replaceAll('\\', '/')
			onChange(relativePath)
		}, 120)
	}
	fs.watchFile(filePath, { interval: 250 }, listener)
	unwatchCallbacks.push(() => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		fs.unwatchFile(filePath, listener)
	})
}

const shutdown = async (exitCode: number) => {
	if (shuttingDown) return
	shuttingDown = true
	for (const unwatch of unwatchCallbacks) {
		unwatch()
	}
	await stopProcess(serverProcess)
	await stopProcess(typeScriptWatchProcess)
	process.exit(exitCode)
}

const main = () => {
	console.log('[ui:watch] Watching UI TypeScript output and serving static assets')
	typeScriptWatchProcess = spawn('bun', ['x', 'tsc', '--project', 'tsconfig.json', '--watch', '--preserveWatchOutput'], {
		cwd: UI_ROOT_PATH,
		stdio: 'inherit',
	})
	typeScriptWatchProcess.on('exit', (exitCode, signalCode) => {
		if (shuttingDown) return
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] TypeScript watch exited unexpectedly (${ signalCode ?? failureCode })`)
		void shutdown(failureCode)
	})

	spawnServer()

	watchFile(DEV_SERVER_PATH, relativePath => {
		void restartServer(relativePath)
	})

	for (const inputPath of VENDOR_INPUT_PATHS) {
		watchFile(inputPath, relativePath => {
			void runVendorBuild(relativePath)
		})
	}

	process.on('SIGINT', () => {
		void shutdown(0)
	})
	process.on('SIGTERM', () => {
		void shutdown(0)
	})
}

main()
