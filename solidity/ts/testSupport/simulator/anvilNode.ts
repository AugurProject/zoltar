import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AnvilWindowEthereum } from './AnvilWindowEthereum'
import { getDefaultAnvilRpcUrl, getMockedEthSimulateWindowEthereum, validateLocalAnvilRpcUrl } from './AnvilWindowEthereum'

const DEFAULT_ANVIL_HOST = '127.0.0.1'
const OS_ASSIGNED_PORT = 0
const ANVIL_MAX_PERSISTED_STATES = '0'
const ANVIL_THREADS = '1'
const ANVIL_OUTPUT_TAIL_LENGTH = 16_384
const RPC_READY_TIMEOUT_MS = 30_000
const RPC_PROBE_TIMEOUT_MS = 3_000
const SHUTDOWN_TIMEOUT_MS = 15_000

type AnvilProcess = ReturnType<typeof spawn>

export type AnvilConnectionMode = { readonly type: 'spawn-isolated'; readonly rpcUrl: string; readonly port: number } | { readonly type: 'use-existing'; readonly rpcUrl: string }

export type AnvilNode = {
	readonly rpcUrl: string
	readonly anvilWindowEthereum: AnvilWindowEthereum
	readonly dispose: () => Promise<void>
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const appendOutputTail = (current: string, chunk: unknown): string => `${current}${String(chunk)}`.slice(-ANVIL_OUTPUT_TAIL_LENGTH)

export const parseAnvilListeningRpcUrl = (output: string): string | undefined => {
	const match = /Listening on 127\.0\.0\.1:([1-9][0-9]*)/.exec(output)
	const port = match?.[1]
	return port === undefined ? undefined : `http://${DEFAULT_ANVIL_HOST}:${port}`
}

const getAnvilProcessFailureMessage = (child: AnvilProcess): string => {
	const status = child.exitCode === null ? `signal ${child.signalCode ?? 'unknown'}` : `exit code ${child.exitCode.toString()}`
	return `Anvil stopped before it became ready (${status}).`
}

const resolveAnvilBinary = (): string => {
	const explicitAnvilBin = process.env['ANVIL_BIN']?.trim()
	if (explicitAnvilBin !== undefined && explicitAnvilBin !== '') return explicitAnvilBin

	const homeDirectory = process.env['USERPROFILE'] ?? process.env['HOME']
	if (homeDirectory !== undefined) {
		const candidates = process.platform === 'win32' ? [`${homeDirectory}\\.foundry\\bin\\anvil.exe`, `${homeDirectory}\\.foundry\\bin\\anvil.cmd`, `${homeDirectory}\\.foundry\\bin\\anvil.bat`] : [`${homeDirectory}/.foundry/bin/anvil`]

		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate
		}
	}

	return 'anvil'
}

const DEFAULT_ANVIL_BIN = resolveAnvilBinary()

const getConfiguredAnvilRpc = (): string | undefined => {
	const anvilRpc = process.env['ANVIL_RPC']?.trim()
	if (anvilRpc === undefined || anvilRpc === '') return undefined
	return anvilRpc
}

export const getAnvilConnectionMode = (): AnvilConnectionMode => {
	const anvilRpc = getConfiguredAnvilRpc()
	if (anvilRpc !== undefined) return { type: 'use-existing', rpcUrl: anvilRpc }

	if (process.platform === 'win32') return { type: 'use-existing', rpcUrl: getDefaultAnvilRpcUrl() }

	return {
		type: 'spawn-isolated',
		rpcUrl: '',
		port: 0,
	}
}

export const getGasCostsAnvilConnectionMode = (): AnvilConnectionMode => {
	const anvilRpc = getConfiguredAnvilRpc()
	if (anvilRpc !== undefined) return { type: 'use-existing', rpcUrl: anvilRpc }

	return {
		type: 'spawn-isolated',
		rpcUrl: '',
		port: 0,
	}
}

const waitForRpcReady = async (rpcUrl: string): Promise<void> => {
	validateLocalAnvilRpcUrl(rpcUrl)

	const deadline = Date.now() + RPC_READY_TIMEOUT_MS
	let lastError: unknown

	while (Date.now() < deadline) {
		const controller = new AbortController()
		const remainingMs = deadline - Date.now()
		const probeTimeoutMs = Math.min(RPC_PROBE_TIMEOUT_MS, remainingMs)
		const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs)

		try {
			const response = await fetch(rpcUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_chainId',
					params: [],
				}),
			})
			if (response.ok) {
				clearTimeout(timeoutId)
				return
			}
			lastError = new Error(`HTTP ${response.status}: ${response.statusText}`)
		} catch (error) {
			lastError = error
		} finally {
			clearTimeout(timeoutId)
		}
		await sleep(100)
	}

	throw new Error(`Timed out waiting for Anvil RPC at ${rpcUrl}: ${getErrorMessage(lastError)}`)
}

const waitForExit = async (child: AnvilProcess): Promise<void> =>
	await new Promise((resolve, reject) => {
		if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
			resolve()
			return
		}

		const timeoutId = setTimeout(() => {
			child.kill('SIGKILL')
			resolve()
		}, SHUTDOWN_TIMEOUT_MS)

		child.once('exit', () => {
			clearTimeout(timeoutId)
			resolve()
		})
		child.once('error', error => {
			clearTimeout(timeoutId)
			reject(error)
		})
	})

const getErrorCode = (error: unknown): string | undefined => {
	if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return undefined
	return error.code
}

const terminateProcess = (child: AnvilProcess, signal: NodeJS.Signals = 'SIGTERM') => {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
	try {
		child.kill(signal)
	} catch (error) {
		const errorCode = getErrorCode(error)
		if (errorCode !== 'ESRCH' && errorCode !== 'EPERM') throw error
		// Ignore termination errors while cleaning up a failed spawn/startup path.
	}
}

export const connectToExistingAnvilNode = async (rpcUrl: string, context: string): Promise<AnvilNode> => {
	try {
		await waitForRpcReady(rpcUrl)
		const anvilWindowEthereum = await getMockedEthSimulateWindowEthereum(rpcUrl)
		await anvilWindowEthereum.setNextBlockBaseFeePerGasToZero()
		return {
			rpcUrl,
			anvilWindowEthereum,
			dispose: async () => {},
		}
	} catch (error) {
		throw new Error(`Unable to connect to Anvil at ${rpcUrl} for ${context}. Start Anvil or set ANVIL_RPC to a local endpoint. ${getErrorMessage(error)}`)
	}
}

export const getIsolatedAnvilArgs = ({ printTraces = false }: { printTraces?: boolean } = {}): string[] => {
	const anvilArgs = ['--host', DEFAULT_ANVIL_HOST, '--port', OS_ASSIGNED_PORT.toString(), '--threads', ANVIL_THREADS, '--chain-id', '1', '--timestamp', '1', '--block-base-fee-per-gas', '0', '--gas-price', '0', '--no-priority-fee', '--max-persisted-states', ANVIL_MAX_PERSISTED_STATES]
	if (printTraces) anvilArgs.push('--print-traces')
	return anvilArgs
}

const createIsolatedAnvilNode = async ({ context, printTraces = false, startTimestamp }: { context: string; printTraces?: boolean; startTimestamp?: bigint }): Promise<AnvilNode> => {
	const anvilArgs = getIsolatedAnvilArgs({ printTraces })

	const childProcess = spawn(DEFAULT_ANVIL_BIN, anvilArgs, {
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let stderr = ''
	let stdout = ''
	if (childProcess.stderr === null || childProcess.stdout === null) {
		terminateProcess(childProcess)
		await waitForExit(childProcess)
		throw new Error(`Failed to start isolated Anvil node for ${context}: Anvil output pipes are unavailable`)
	}
	childProcess.stderr.on('data', chunk => {
		stderr = appendOutputTail(stderr, chunk)
	})
	childProcess.stdout.on('data', chunk => {
		stdout = appendOutputTail(stdout, chunk)
	})

	const processFailurePromise = new Promise<never>((_, reject) => {
		childProcess.once('error', error => {
			if (getErrorCode(error) === 'ENOENT') {
				reject(new Error(`Failed to start isolated Anvil node: could not find Anvil executable '${DEFAULT_ANVIL_BIN}'. On Windows, Foundry usually installs to %USERPROFILE%\\.foundry\\bin\\anvil.exe. Set ANVIL_BIN to the full path if Anvil is not on PATH.`))
				return
			}
			reject(error)
		})
		childProcess.once('exit', () => reject(new Error(getAnvilProcessFailureMessage(childProcess))))
	})
	const listeningRpcUrlPromise = new Promise<string>((resolve, reject) => {
		const timeoutId = setTimeout(() => reject(new Error('Timed out waiting for Anvil to report its listening address.')), RPC_READY_TIMEOUT_MS)
		childProcess.once('error', () => clearTimeout(timeoutId))
		childProcess.once('exit', () => clearTimeout(timeoutId))
		childProcess.stdout?.on('data', () => {
			const rpcUrl = parseAnvilListeningRpcUrl(stdout)
			if (rpcUrl === undefined) return
			clearTimeout(timeoutId)
			resolve(rpcUrl)
		})
	})

	try {
		const rpcUrl = await Promise.race([listeningRpcUrlPromise, processFailurePromise])
		await Promise.race([waitForRpcReady(rpcUrl), processFailurePromise])
		const anvilWindowEthereum = await getMockedEthSimulateWindowEthereum(rpcUrl)
		if (startTimestamp !== undefined) await anvilWindowEthereum.setTime(startTimestamp)
		await anvilWindowEthereum.setNextBlockBaseFeePerGasToZero()
		let disposed = false
		return {
			rpcUrl,
			anvilWindowEthereum,
			dispose: async () => {
				if (disposed) return
				disposed = true
				terminateProcess(childProcess)
				await waitForExit(childProcess)
			},
		}
	} catch (error) {
		terminateProcess(childProcess)
		await waitForExit(childProcess)
		const stderrMessage = stderr.trim() === '' ? '' : `\nAnvil stderr:\n${stderr.trim()}`
		const stdoutMessage = stdout.trim() === '' ? '' : `\nAnvil stdout:\n${stdout.trim()}`
		throw new Error(`Failed to start isolated Anvil node for ${context}: ${getErrorMessage(error)}${stderrMessage}${stdoutMessage}`)
	}
}

export const createAnvilNodeForConnectionMode = async (connectionMode: AnvilConnectionMode, options: { context: string; printTraces?: boolean; startTimestamp?: bigint }): Promise<AnvilNode> => {
	if (connectionMode.type === 'use-existing') return await connectToExistingAnvilNode(connectionMode.rpcUrl, options.context)
	return await createIsolatedAnvilNode(options)
}
