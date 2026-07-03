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
const SOLIDITY_CONTRACTS_ROOT_PATH = path.join(REPOSITORY_ROOT_PATH, 'solidity', 'contracts')
const SOLIDITY_ABI_INPUT_PATH = path.join(REPOSITORY_ROOT_PATH, 'solidity', 'ts', 'abi', 'abis.ts')
const SOLIDITY_COMPILE_INPUT_PATH = path.join(REPOSITORY_ROOT_PATH, 'solidity', 'ts', 'compile.ts')
const SOLIDITY_ARTIFACTS_JSON_PATH = path.join(REPOSITORY_ROOT_PATH, 'solidity', 'artifacts', 'Contracts.json')
const PROJECT_ARTIFACT_BUILD_PATH = path.join(UI_ROOT_PATH, 'build', 'projectArtifacts.mts')
const BUNDLER_PATHS_BUILD_PATH = path.join(UI_ROOT_PATH, 'build', 'bundlerPaths.mts')
const TYPE_SCRIPT_OUTPUT_PATH = path.join(UI_ROOT_PATH, 'js')
const TYPE_SCRIPT_SOURCE_PATH = path.join(UI_ROOT_PATH, 'ts')
const VENDOR_BUILD_PATH = path.join(UI_ROOT_PATH, 'build', 'vendor.mts')
const VENDOR_INPUT_PATHS = [VENDOR_BUILD_PATH, BUNDLER_PATHS_BUILD_PATH, path.join(UI_ROOT_PATH, 'package.json'), path.join(UI_ROOT_PATH, 'tsconfig.vendor.json'), path.join(UI_ROOT_PATH, 'bun.lock')]
const WORKER_BUILD_PATH = path.join(UI_ROOT_PATH, 'build', 'workers.mts')
const WORKER_INPUT_PATHS = [WORKER_BUILD_PATH, BUNDLER_PATHS_BUILD_PATH]
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
let workerBuildProcess: ManagedProcess | undefined
let workerBuildRunning = false
let workerBuildQueued = false
let contractBuildProcess: ManagedProcess | undefined
let contractBuildRunning = false
let contractBuildQueued = false
let projectArtifactBuildProcess: ManagedProcess | undefined
let projectArtifactBuildRunning = false
let projectArtifactBuildQueued = false
let liveReloadQueued = false
let liveReloadTimeout: NodeJS.Timeout | undefined

const unwatchCallbacks: Array<() => void> = []
let sharedSourceUnwatchCallbacks: Array<() => void> = []
let typeScriptOutputUnwatchCallbacks: Array<() => void> = []
let typeScriptSourceUnwatchCallbacks: Array<() => void> = []
let contractSourceUnwatchCallbacks: Array<() => void> = []

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

const isIgnorableKillError = (error: unknown): error is NodeJS.ErrnoException => error instanceof Error && 'code' in error && (error.code === 'ESRCH' || error.code === 'EPERM')

const stopProcess = async (childProcess: ManagedProcess | undefined) => {
	if (childProcess === undefined) return
	if (childProcess.exitCode !== null || childProcess.signalCode !== null) return
	try {
		childProcess.kill('SIGTERM')
	} catch (error) {
		if (!isIgnorableKillError(error)) throw error
		return
	}
	const forceKillTimeout = setTimeout(() => {
		if (childProcess.exitCode === null && childProcess.signalCode === null) {
			try {
				childProcess.kill('SIGKILL')
			} catch (error) {
				if (!isIgnorableKillError(error)) throw error
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

const clearContractSourceWatchers = () => {
	for (const unwatch of contractSourceUnwatchCallbacks) {
		unwatch()
	}
	contractSourceUnwatchCallbacks = []
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

const watchDirectoryForContractSources = (directoryPath: string, refreshWatchers: () => void) => {
	let debounceTimeout: NodeJS.Timeout | undefined
	const watcher = fs.watch(directoryPath, (eventType, filename) => {
		if (eventType !== 'rename') return
		if (debounceTimeout !== undefined) clearTimeout(debounceTimeout)
		debounceTimeout = setTimeout(() => {
			debounceTimeout = undefined
			refreshWatchers()
			const changedPath = typeof filename === 'string' && filename.length > 0 ? path.join(directoryPath, filename) : directoryPath
			void runContractBuild(path.relative(UI_ROOT_PATH, changedPath).replaceAll('\\', '/'))
		}, 120)
	})
	contractSourceUnwatchCallbacks.push(() => {
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
				void runWorkerBuild(relativePath)
			},
			callback => {
				typeScriptSourceUnwatchCallbacks.push(callback)
			},
		)
	}
}

const refreshContractSourceWatchers = async () => {
	clearContractSourceWatchers()
	const directories = await getAllDirectories(SOLIDITY_CONTRACTS_ROOT_PATH)
	for (const directoryPath of directories) {
		watchDirectoryForContractSources(directoryPath, () => {
			void refreshContractSourceWatchers()
		})
	}
	const files = await getAllFiles(SOLIDITY_CONTRACTS_ROOT_PATH)
	for (const filePath of files) {
		watchFileWithCleanup(
			filePath,
			relativePath => {
				void runContractBuild(relativePath)
			},
			callback => {
				contractSourceUnwatchCallbacks.push(callback)
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
		vendorBuildProcess = spawn('bun', [VENDOR_BUILD_PATH], {
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

const runWorkerBuild = async (reason: string) => {
	if (shuttingDown) return
	if (workerBuildRunning) {
		workerBuildQueued = true
		return
	}
	workerBuildRunning = true
	console.log(`[ui:watch] Rebuilding simulation worker because ${reason} changed`)
	try {
		workerBuildProcess = spawn('bun', [WORKER_BUILD_PATH], {
			cwd: UI_ROOT_PATH,
			stdio: 'inherit',
		})
	} catch (error) {
		workerBuildRunning = false
		console.error('[ui:watch] Failed to start simulation worker rebuild')
		console.error(error)
		await shutdown(1)
		return
	}
	const childProcess = workerBuildProcess
	attachProcessErrorHandler(childProcess, 'Simulation worker rebuild')
	let exitCode: number | null
	let signalCode: NodeJS.Signals | null
	try {
		;({ exitCode, signalCode } = await waitForProcessExit(childProcess))
	} catch (error) {
		console.error('[ui:watch] Simulation worker rebuild failed to start')
		console.error(error)
		workerBuildRunning = false
		workerBuildProcess = undefined
		await shutdown(1)
		return
	}
	workerBuildRunning = false
	workerBuildProcess = undefined
	if (exitCode !== 0) {
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] Simulation worker rebuild failed (${signalCode ?? failureCode})`)
		await shutdown(failureCode)
		return
	}
	if (workerBuildQueued) {
		workerBuildQueued = false
		await runWorkerBuild('queued TypeScript input')
	}
}

const runSharedBuild = async (reason: string) => {
	if (shuttingDown) return
	if (sharedBuildRunning) {
		sharedBuildQueued = true
		return
	}
	sharedBuildRunning = true
	console.log(`[ui:watch] Rebuilding shared package outputs because ${reason} changed`)
	const builtSharedOutputs = await runSharedBuildStep(['bun', 'run', 'shared:build'], REPOSITORY_ROOT_PATH, 'Shared TypeScript build')
	if (!builtSharedOutputs) return
	sharedBuildRunning = false
	if (sharedBuildQueued) {
		sharedBuildQueued = false
		await runSharedBuild('queued shared input')
		return
	}
	queueLiveReload(reason)
}

const runProjectArtifactBuild = async (reason: string) => {
	if (shuttingDown) return
	if (projectArtifactBuildRunning) {
		projectArtifactBuildQueued = true
		return
	}
	projectArtifactBuildRunning = true
	console.log(`[ui:watch] Rebuilding UI contract artifacts because ${reason} changed`)
	try {
		projectArtifactBuildProcess = spawn('bun', ['run', 'generate:ui-contract-artifact'], {
			cwd: REPOSITORY_ROOT_PATH,
			stdio: 'inherit',
		})
	} catch (error) {
		projectArtifactBuildRunning = false
		console.error('[ui:watch] Failed to start UI contract artifact rebuild')
		console.error(error)
		await shutdown(1)
		return
	}
	const childProcess = projectArtifactBuildProcess
	attachProcessErrorHandler(childProcess, 'UI contract artifact rebuild')
	let exitCode: number | null
	let signalCode: NodeJS.Signals | null
	try {
		;({ exitCode, signalCode } = await waitForProcessExit(childProcess))
	} catch (error) {
		console.error('[ui:watch] UI contract artifact rebuild failed to start')
		console.error(error)
		projectArtifactBuildRunning = false
		projectArtifactBuildProcess = undefined
		await shutdown(1)
		return
	}
	projectArtifactBuildRunning = false
	projectArtifactBuildProcess = undefined
	if (exitCode !== 0) {
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] UI contract artifact rebuild failed (${signalCode ?? failureCode})`)
		await shutdown(failureCode)
		return
	}
	if (projectArtifactBuildQueued) {
		projectArtifactBuildQueued = false
		await runProjectArtifactBuild('queued project artifact input')
		return
	}
	queueLiveReload(reason)
}

const runContractBuild = async (reason: string) => {
	if (shuttingDown) return
	if (contractBuildRunning) {
		contractBuildQueued = true
		return
	}
	contractBuildRunning = true
	console.log(`[ui:watch] Rebuilding Solidity contracts and UI artifacts because ${reason} changed`)
	try {
		contractBuildProcess = spawn('bun', ['run', 'generate:contracts'], {
			cwd: REPOSITORY_ROOT_PATH,
			stdio: 'inherit',
		})
	} catch (error) {
		contractBuildRunning = false
		console.error('[ui:watch] Failed to start Solidity rebuild')
		console.error(error)
		await shutdown(1)
		return
	}
	const childProcess = contractBuildProcess
	attachProcessErrorHandler(childProcess, 'Solidity rebuild')
	let exitCode: number | null
	let signalCode: NodeJS.Signals | null
	try {
		;({ exitCode, signalCode } = await waitForProcessExit(childProcess))
	} catch (error) {
		console.error('[ui:watch] Solidity rebuild failed to start')
		console.error(error)
		contractBuildRunning = false
		contractBuildProcess = undefined
		await shutdown(1)
		return
	}
	contractBuildRunning = false
	contractBuildProcess = undefined
	if (exitCode !== 0) {
		const failureCode = exitCode ?? 1
		console.error(`[ui:watch] Solidity rebuild failed (${signalCode ?? failureCode})`)
		await shutdown(failureCode)
		return
	}
	if (contractBuildQueued) {
		contractBuildQueued = false
		await runContractBuild('queued Solidity input')
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
	clearContractSourceWatchers()
	await stopProcess(sharedBuildProcess)
	await stopProcess(vendorBuildProcess)
	await stopProcess(workerBuildProcess)
	await stopProcess(contractBuildProcess)
	await stopProcess(projectArtifactBuildProcess)
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
	for (const inputPath of WORKER_INPUT_PATHS) {
		watchFile(inputPath, relativePath => {
			void runWorkerBuild(relativePath)
		})
	}
	watchFile(PROJECT_ARTIFACT_BUILD_PATH, relativePath => {
		void runProjectArtifactBuild(relativePath)
	})
	watchFile(SOLIDITY_ABI_INPUT_PATH, relativePath => {
		void runContractBuild(relativePath)
	})
	watchFile(SOLIDITY_COMPILE_INPUT_PATH, relativePath => {
		void runContractBuild(relativePath)
	})
	watchFile(SOLIDITY_ARTIFACTS_JSON_PATH, relativePath => {
		void runProjectArtifactBuild(relativePath)
	})

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

	void refreshContractSourceWatchers().catch(error => {
		console.error('[ui:watch] Failed to watch Solidity contract source files')
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
