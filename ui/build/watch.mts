import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const REPOSITORY_ROOT_PATH = path.join(UI_ROOT_PATH, '..')
const DEV_SERVER_PATH = path.join(UI_ROOT_PATH, 'dev-server.ts')
const INDEX_HTML_PATH = path.join(UI_ROOT_PATH, 'index.html')
const SHARED_SOURCE_ROOT_PATH = path.join(REPOSITORY_ROOT_PATH, 'shared', 'ts')
const SHARED_TSCONFIG_PATH = path.join(REPOSITORY_ROOT_PATH, 'shared', 'tsconfig.json')
const TYPE_SCRIPT_OUTPUT_PATH = path.join(UI_ROOT_PATH, 'js')
const TYPE_SCRIPT_SOURCE_PATH = path.join(UI_ROOT_PATH, 'ts')
const VENDOR_INPUT_PATHS = [path.join(UI_ROOT_PATH, 'build', 'vendor.mts'), path.join(UI_ROOT_PATH, 'package.json'), path.join(UI_ROOT_PATH, 'tsconfig.vendor.json'), path.join(UI_ROOT_PATH, 'bun.lock')]
const LIVE_RELOAD_ENDPOINT = 'http://127.0.0.1:12345/__live-reload'

type ManagedProcess = ReturnType<typeof spawn>

let shuttingDown = false
let restartingServer = false
let serverProcess: ManagedProcess | undefined
let sharedBuildProcess: ManagedProcess | undefined
let sharedBuildQueued = false
let sharedBuildRunning = false
let typeScriptWatchProcess: ManagedProcess | undefined
let vendorBuildProcess: ManagedProcess | undefined
let vendorBuildRunning = false
let vendorBuildQueued = false
let liveReloadQueued = false
let liveReloadTimeout: NodeJS.Timeout | undefined

const unwatchCallbacks: Array<() => void> = []
let sharedSourceUnwatchCallbacks: Array<() => void> = []
let typeScriptOutputUnwatchCallbacks: Array<() => void> = []
let typeScriptSourceUnwatchCallbacks: Array<() => void> = []

const waitForProcessExit = async (childProcess: ManagedProcess) => {
	return await new Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>((resolve, reject) => {
		const handleExit = (exitCode: number | null, signalCode: NodeJS.Signals | null) => {
			cleanup()
			resolve({ exitCode, signalCode })
		}
		const handleError = (error: Error) => {
			cleanup()
			reject(error)
		}
		const cleanup = () => {
			childProcess.off('exit', handleExit)
			childProcess.off('error', handleError)
		}

		childProcess.on('exit', handleExit)
		childProcess.on('error', handleError)

		if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
			handleExit(childProcess.exitCode, childProcess.signalCode)
		}
	})
}

const attachProcessErrorHandler = (childProcess: ManagedProcess, label: string) => {
	childProcess.on('error', error => {
		if (shuttingDown) return
		console.error(`[ui:watch] ${label} failed to start`)
		console.error(error)
		void shutdown(1)
	})
}

const stopProcess = async (childProcess: ManagedProcess | undefined) => {
	if (childProcess === undefined) return
	if (childProcess.exitCode !== null || childProcess.signalCode !== null) return
	try {
		childProcess.kill('SIGTERM')
	} catch {
		return
	}
	const forceKillTimeout = setTimeout(() => {
		if (childProcess.exitCode === null && childProcess.signalCode === null) {
			try {
				childProcess.kill('SIGKILL')
			} catch {
				return
			}
		}
	}, 2_000)
	try {
		await waitForProcessExit(childProcess)
	} catch (error) {
		console.error('[ui:watch] Failed while waiting for child process exit')
		console.error(error)
		return
	} finally {
		clearTimeout(forceKillTimeout)
	}
}

const getAllFiles = async (dirPath: string, fileList: string[] = []) => {
	const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
	for (const entry of entries) {
		const entryPath = path.join(dirPath, entry.name)
		if (entry.isDirectory()) {
			await getAllFiles(entryPath, fileList)
		} else {
			fileList.push(entryPath)
		}
	}
	return fileList
}

const getAllDirectories = async (dirPath: string, directoryList: string[] = []) => {
	directoryList.push(dirPath)
	const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		await getAllDirectories(path.join(dirPath, entry.name), directoryList)
	}
	return directoryList
}

const queueLiveReload = (reason: string) => {
	if (shuttingDown) return
	if (liveReloadTimeout !== undefined) clearTimeout(liveReloadTimeout)
	liveReloadQueued = true
	liveReloadTimeout = setTimeout(() => {
		liveReloadTimeout = undefined
		void sendLiveReload(reason)
	}, 250)
}

const sendLiveReload = async (reason: string) => {
	if (shuttingDown) return
	if (!liveReloadQueued) return
	liveReloadQueued = false
	try {
		await fetch(`${LIVE_RELOAD_ENDPOINT}?reason=${encodeURIComponent(reason)}`, { method: 'POST' })
		console.log(`[ui:watch] Reload requested (${reason})`)
	} catch (error) {
		console.error(`[ui:watch] Failed to signal browser reload because ${reason} changed`)
		console.error(error)
	}
}

const spawnServer = () => {
	console.log('[ui:watch] Starting ui:serve')
	try {
		serverProcess = spawn('bun', [DEV_SERVER_PATH], {
			cwd: REPOSITORY_ROOT_PATH,
			stdio: 'inherit',
		})
	} catch (error) {
		console.error('[ui:watch] Failed to start ui:serve')
		console.error(error)
		void shutdown(1)
		return
	}
	attachProcessErrorHandler(serverProcess, 'ui:serve')
	serverProcess.on('exit', (exitCode, signalCode) => {
		if (shuttingDown || restartingServer) return
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] ui:serve exited unexpectedly (${signalCode ?? failureCode})`)
		void shutdown(failureCode)
	})
}

const onTypeScriptWatchStdout = (chunk: Buffer) => {
	process.stdout.write(chunk)
}

const onTypeScriptWatchStderr = (chunk: Buffer) => {
	process.stderr.write(chunk)
}

const watchFileWithCleanup = (filePath: string, onChange: (relativePath: string) => void, registerUnwatch: (callback: () => void) => void) => {
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
	registerUnwatch(() => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		fs.unwatchFile(filePath, listener)
	})
}

const clearTypeScriptOutputWatchers = () => {
	for (const unwatch of typeScriptOutputUnwatchCallbacks) {
		unwatch()
	}
	typeScriptOutputUnwatchCallbacks = []
}

const clearSharedSourceWatchers = () => {
	for (const unwatch of sharedSourceUnwatchCallbacks) {
		unwatch()
	}
	sharedSourceUnwatchCallbacks = []
}

const clearTypeScriptSourceWatchers = () => {
	for (const unwatch of typeScriptSourceUnwatchCallbacks) {
		unwatch()
	}
	typeScriptSourceUnwatchCallbacks = []
}

const watchDirectoryForTypeScriptOutputs = (directoryPath: string, refreshWatchers: () => void) => {
	let debounceTimeout: NodeJS.Timeout | undefined
	const watcher = fs.watch(directoryPath, (_eventType, filename) => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		debounceTimeout = setTimeout(() => {
			debounceTimeout = undefined
			refreshWatchers()
			const changedPath = typeof filename === 'string' && filename.length > 0 ? path.join(directoryPath, filename) : directoryPath
			queueLiveReload(path.relative(UI_ROOT_PATH, changedPath).replaceAll('\\', '/'))
		}, 120)
	})
	typeScriptOutputUnwatchCallbacks.push(() => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		watcher.close()
	})
}

const watchDirectoryForTypeScriptSources = (directoryPath: string, refreshWatchers: () => void) => {
	let debounceTimeout: NodeJS.Timeout | undefined
	const watcher = fs.watch(directoryPath, (_eventType, _filename) => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		debounceTimeout = setTimeout(() => {
			debounceTimeout = undefined
			refreshWatchers()
		}, 120)
	})
	typeScriptSourceUnwatchCallbacks.push(() => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		watcher.close()
	})
}

const watchDirectoryForSharedSources = (directoryPath: string, refreshWatchers: () => void) => {
	let debounceTimeout: NodeJS.Timeout | undefined
	const watcher = fs.watch(directoryPath, (eventType, filename) => {
		if (eventType !== 'rename') return
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		debounceTimeout = setTimeout(() => {
			debounceTimeout = undefined
			refreshWatchers()
			const changedPath = typeof filename === 'string' && filename.length > 0 ? path.join(directoryPath, filename) : directoryPath
			void runSharedBuild(path.relative(UI_ROOT_PATH, changedPath).replaceAll('\\', '/'))
		}, 120)
	})
	sharedSourceUnwatchCallbacks.push(() => {
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		watcher.close()
	})
}

const refreshTypeScriptOutputWatchers = async () => {
	clearTypeScriptOutputWatchers()
	const directories = await getAllDirectories(TYPE_SCRIPT_OUTPUT_PATH)
	for (const directoryPath of directories) {
		watchDirectoryForTypeScriptOutputs(directoryPath, () => {
			void refreshTypeScriptOutputWatchers()
		})
	}
	const files = await getAllFiles(TYPE_SCRIPT_OUTPUT_PATH)
	for (const filePath of files) {
		watchFileWithCleanup(
			filePath,
			relativePath => {
				queueLiveReload(relativePath)
			},
			callback => {
				typeScriptOutputUnwatchCallbacks.push(callback)
			},
		)
	}
}

const refreshSharedSourceWatchers = async () => {
	clearSharedSourceWatchers()
	const directories = await getAllDirectories(SHARED_SOURCE_ROOT_PATH)
	for (const directoryPath of directories) {
		watchDirectoryForSharedSources(directoryPath, () => {
			void refreshSharedSourceWatchers()
		})
	}
	const files = await getAllFiles(SHARED_SOURCE_ROOT_PATH)
	for (const filePath of files) {
		watchFileWithCleanup(
			filePath,
			relativePath => {
				void runSharedBuild(relativePath)
			},
			callback => {
				sharedSourceUnwatchCallbacks.push(callback)
			},
		)
	}
}

const refreshTypeScriptSourceWatchers = async () => {
	clearTypeScriptSourceWatchers()
	const directories = await getAllDirectories(TYPE_SCRIPT_SOURCE_PATH)
	for (const directoryPath of directories) {
		watchDirectoryForTypeScriptSources(directoryPath, () => {
			void refreshTypeScriptSourceWatchers()
		})
	}
	const files = await getAllFiles(TYPE_SCRIPT_SOURCE_PATH)
	for (const filePath of files) {
		watchFileWithCleanup(
			filePath,
			relativePath => {
				queueLiveReload(relativePath)
			},
			callback => {
				typeScriptSourceUnwatchCallbacks.push(callback)
			},
		)
	}
}

const runSharedBuildStep = async (command: string[], cwd: string, label: string) => {
	try {
		const [executable, ...args] = command
		if (executable === undefined) throw new Error(`Missing executable for ${label}`)
		sharedBuildProcess = spawn(executable, args, {
			cwd,
			stdio: 'inherit',
		})
	} catch (error) {
		console.error(`[ui:watch] Failed to start ${label.toLowerCase()}`)
		console.error(error)
		await shutdown(1)
		return false
	}
	const childProcess = sharedBuildProcess
	attachProcessErrorHandler(childProcess, label)
	let exitCode: number | null
	let signalCode: NodeJS.Signals | null
	try {
		;({ exitCode, signalCode } = await waitForProcessExit(childProcess))
	} catch (error) {
		console.error(`[ui:watch] ${label} failed to start`)
		console.error(error)
		sharedBuildProcess = undefined
		await shutdown(1)
		return false
	}
	sharedBuildProcess = undefined
	if (exitCode !== 0) {
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] ${label} failed (${signalCode ?? failureCode})`)
		await shutdown(failureCode)
		return false
	}
	return true
}

const restartServer = async (reason: string) => {
	if (shuttingDown) return
	console.log(`[ui:watch] Restarting ui:serve because ${reason} changed`)
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
	console.log(`[ui:watch] Rebuilding UI vendor assets because ${reason} changed`)
	try {
		vendorBuildProcess = spawn('bun', ['./build/vendor.mts'], {
			cwd: UI_ROOT_PATH,
			stdio: 'inherit',
		})
	} catch (error) {
		vendorBuildRunning = false
		console.error('[ui:watch] Failed to start vendor rebuild')
		console.error(error)
		await shutdown(1)
		return
	}
	const childProcess = vendorBuildProcess
	attachProcessErrorHandler(childProcess, 'Vendor rebuild')
	let exitCode: number | null
	let signalCode: NodeJS.Signals | null
	try {
		;({ exitCode, signalCode } = await waitForProcessExit(childProcess))
	} catch (error) {
		console.error('[ui:watch] Vendor rebuild failed to start')
		console.error(error)
		vendorBuildRunning = false
		vendorBuildProcess = undefined
		await shutdown(1)
		return
	}
	vendorBuildRunning = false
	vendorBuildProcess = undefined
	if (exitCode !== 0) {
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] Vendor rebuild failed (${signalCode ?? failureCode})`)
		await shutdown(failureCode)
		return
	}
	if (vendorBuildQueued) {
		vendorBuildQueued = false
		await runVendorBuild('queued vendor input')
	}
	queueLiveReload(reason)
}

const runSharedBuild = async (reason: string) => {
	if (shuttingDown) return
	if (sharedBuildRunning) {
		sharedBuildQueued = true
		return
	}
	sharedBuildRunning = true
	console.log(`[ui:watch] Rebuilding shared UI helper assets because ${reason} changed`)
	const builtSharedOutputs = await runSharedBuildStep(['bun', 'run', 'shared:build'], REPOSITORY_ROOT_PATH, 'Shared TypeScript build')
	if (!builtSharedOutputs) return
	const mirroredSharedOutputs = await runSharedBuildStep(['bun', 'run', 'ui:shared'], REPOSITORY_ROOT_PATH, 'Shared UI asset mirror')
	if (!mirroredSharedOutputs) return
	sharedBuildRunning = false
	if (sharedBuildQueued) {
		sharedBuildQueued = false
		await runSharedBuild('queued shared input')
		return
	}
	queueLiveReload(reason)
}

const watchFile = (filePath: string, onChange: (relativePath: string) => void) => {
	watchFileWithCleanup(filePath, onChange, callback => {
		unwatchCallbacks.push(callback)
	})
}

const shutdown = async (exitCode: number) => {
	if (shuttingDown) return
	shuttingDown = true
	for (const unwatch of unwatchCallbacks) {
		unwatch()
	}
	clearSharedSourceWatchers()
	clearTypeScriptOutputWatchers()
	clearTypeScriptSourceWatchers()
	await stopProcess(sharedBuildProcess)
	await stopProcess(vendorBuildProcess)
	await stopProcess(serverProcess)
	await stopProcess(typeScriptWatchProcess)
	process.exit(exitCode)
}

const main = () => {
	console.log('[ui:watch] Watching UI TypeScript output and serving static assets')
	try {
		typeScriptWatchProcess = spawn('bun', ['x', 'tsc', '--project', 'tsconfig.json', '--watch', '--preserveWatchOutput'], {
			cwd: UI_ROOT_PATH,
			stdio: ['inherit', 'pipe', 'pipe'],
		})
	} catch (error) {
		console.error('[ui:watch] Failed to start TypeScript watch')
		console.error(error)
		void shutdown(1)
		return
	}
	attachProcessErrorHandler(typeScriptWatchProcess, 'TypeScript watch')
	if (typeScriptWatchProcess.stdout === null || typeScriptWatchProcess.stderr === null) {
		throw new Error('TypeScript watch streams are unavailable')
	}
	typeScriptWatchProcess.stdout.on('data', onTypeScriptWatchStdout)
	typeScriptWatchProcess.stderr.on('data', onTypeScriptWatchStderr)
	typeScriptWatchProcess.on('exit', (exitCode, signalCode) => {
		if (shuttingDown) return
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] TypeScript watch exited unexpectedly (${signalCode ?? failureCode})`)
		void shutdown(failureCode)
	})

	spawnServer()

	watchFile(DEV_SERVER_PATH, relativePath => {
		void restartServer(relativePath)
	})
	watchFile(INDEX_HTML_PATH, relativePath => {
		queueLiveReload(relativePath)
	})

	for (const inputPath of VENDOR_INPUT_PATHS) {
		watchFile(inputPath, relativePath => {
			void runVendorBuild(relativePath)
		})
	}

	void refreshTypeScriptOutputWatchers().catch(error => {
		console.error('[ui:watch] Failed to watch TypeScript output files')
		console.error(error)
		void shutdown(1)
	})

	watchFile(SHARED_TSCONFIG_PATH, relativePath => {
		void runSharedBuild(relativePath)
	})

	void refreshSharedSourceWatchers().catch(error => {
		console.error('[ui:watch] Failed to watch shared TypeScript source files')
		console.error(error)
		void shutdown(1)
	})

	void refreshTypeScriptSourceWatchers().catch(error => {
		console.error('[ui:watch] Failed to watch TypeScript source files')
		console.error(error)
		void shutdown(1)
	})

	void (async () => {
		try {
			const cssFiles = await getAllFiles(path.join(UI_ROOT_PATH, 'css'))
			for (const cssFile of cssFiles) {
				watchFile(cssFile, relativePath => {
					queueLiveReload(relativePath)
				})
			}
		} catch (error) {
			console.error('[ui:watch] Failed to load CSS files for watching')
			console.error(error)
		}
	})()

	process.on('SIGINT', () => {
		void shutdown(0)
	})
	process.on('SIGTERM', () => {
		void shutdown(0)
	})
}

main()
