import { afterAll, beforeAll, beforeEach, setDefaultTimeout } from 'bun:test'
import { spawn } from 'node:child_process'
import { AddressInfo, createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { getDefaultAnvilRpcUrl, getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from './AnvilWindowEthereum'
import { ensureDefined } from './utils/testUtils'

const DEFAULT_ANVIL_HOST = '127.0.0.1'
const DEFAULT_ANVIL_BIN = process.env['ANVIL_BIN'] ?? 'anvil'
const RPC_READY_TIMEOUT_MS = 30_000
const RPC_PROBE_TIMEOUT_MS = 3_000
const SHUTDOWN_TIMEOUT_MS = 15_000
const TEST_CHAIN_START_TIMESTAMP = 1n
export const TEST_TIMEOUT_MS = 300_000

setDefaultTimeout(TEST_TIMEOUT_MS)

function getAddressPort(address: string | AddressInfo | undefined) {
	if (address === undefined || typeof address === 'string') {
		throw new Error('Failed to resolve TCP port for Anvil')
	}
	return address.port
}

const getFreePort = async (): Promise<number> =>
	await new Promise((resolve, reject) => {
		const server = createServer()
		server.listen(0, DEFAULT_ANVIL_HOST, () => {
			const address = server.address() ?? undefined
			if (address === undefined) {
				server.close(() => reject(new Error('Failed to allocate a free TCP port for Anvil')))
				return
			}
			server.close(error => {
				if (error !== undefined) {
					reject(error)
					return
				}
				resolve(getAddressPort(address))
			})
		})
		server.on('error', reject)
	})

type AnvilProcess = ReturnType<typeof spawn>

type AnvilConnectionMode = { readonly type: 'spawn-isolated'; readonly rpcUrl: string; readonly port: number } | { readonly type: 'use-existing'; readonly rpcUrl: string }

export const getAnvilConnectionMode = (): AnvilConnectionMode => {
	if (process.platform === 'win32') {
		return { type: 'use-existing', rpcUrl: process.env['ANVIL_RPC'] ?? getDefaultAnvilRpcUrl() }
	}

	return {
		type: 'spawn-isolated',
		rpcUrl: '',
		port: 0,
	}
}

const waitForRpcReady = async (rpcUrl: string): Promise<void> => {
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

	const detail = lastError instanceof Error ? lastError.message : String(lastError)
	throw new Error(`Timed out waiting for Anvil RPC at ${rpcUrl}: ${detail}`)
}

const waitForExit = async (child: AnvilProcess): Promise<void> =>
	await new Promise((resolve, reject) => {
		if (child.exitCode !== null || child.signalCode !== null) {
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

const terminateProcess = (child: AnvilProcess, signal: NodeJS.Signals = 'SIGTERM') => {
	if (child.exitCode !== null || child.signalCode !== null) return
	try {
		child.kill(signal)
	} catch {
		// Ignore termination errors while cleaning up a failed spawn/startup path.
	}
}

export const useIsolatedAnvilNode = () => {
	let anvilProcess: AnvilProcess | undefined
	let anvilWindowEthereum: AnvilWindowEthereum | undefined
	let snapshotId: string | undefined

	beforeAll(async () => {
		const connectionMode = getAnvilConnectionMode()

		if (connectionMode.type === 'use-existing') {
			try {
				await waitForRpcReady(connectionMode.rpcUrl)
				anvilWindowEthereum = await getMockedEthSimulateWindowEthereum(connectionMode.rpcUrl)
				snapshotId = await anvilWindowEthereum.anvilSnapshot()
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				throw new Error(`Failed to connect to existing Anvil node for test file at ${connectionMode.rpcUrl}: ${errorMessage}`)
			}
			return
		}

		const port = await getFreePort()
		const rpcUrl = `http://${DEFAULT_ANVIL_HOST}:${port}`

		const process = spawn(DEFAULT_ANVIL_BIN, ['--host', DEFAULT_ANVIL_HOST, '--port', `${port}`, '--chain-id', '1', '--timestamp', '1', '--block-base-fee-per-gas', '0', '--gas-price', '0', '--no-priority-fee'], {
			stdio: ['ignore', 'ignore', 'pipe'],
		})
		anvilProcess = process
		const spawnErrorPromise = new Promise<never>((_, reject) => {
			process.once('error', reject)
		})

		let stderr = ''
		ensureDefined(process.stderr, 'Anvil stderr pipe is unavailable').on('data', chunk => {
			stderr += chunk.toString()
		})

		try {
			await Promise.race([waitForRpcReady(rpcUrl), spawnErrorPromise])
			anvilWindowEthereum = await getMockedEthSimulateWindowEthereum(rpcUrl)
			await anvilWindowEthereum.setTime(TEST_CHAIN_START_TIMESTAMP)
			await anvilWindowEthereum.setNextBlockBaseFeePerGasToZero()
			snapshotId = await anvilWindowEthereum.anvilSnapshot()
		} catch (error) {
			terminateProcess(process)
			const errorMessage = error instanceof Error ? error.message : String(error)
			const stderrMessage = stderr.trim() === '' ? '' : `\nAnvil stderr:\n${stderr.trim()}`
			throw new Error(`Failed to start isolated Anvil node for test file: ${errorMessage}${stderrMessage}`)
		}
	})

	beforeEach(async () => {
		const currentEthereum = ensureDefined(anvilWindowEthereum, 'Isolated Anvil node was not initialized')
		const currentSnapshotId = ensureDefined(snapshotId, 'Missing Anvil snapshot for test isolation')
		await currentEthereum.anvilRevert(currentSnapshotId)
		await currentEthereum.setNextBlockBaseFeePerGasToZero()
		snapshotId = await currentEthereum.anvilSnapshot()
	})

	afterAll(async () => {
		if (anvilProcess === undefined) return
		terminateProcess(anvilProcess)
		await waitForExit(anvilProcess)
		anvilProcess = undefined
		anvilWindowEthereum = undefined
		snapshotId = undefined
	})

	return {
		getAnvilWindowEthereum: () => ensureDefined(anvilWindowEthereum, 'Isolated Anvil node was not initialized'),
	}
}
