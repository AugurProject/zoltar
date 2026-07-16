import { afterAll, beforeAll, describe as baseDescribe, expect, test } from 'bun:test'
import { createPublicClient, http, mainnet } from '@zoltar/shared/ethereum'
import { ETH_ADDRESS, REP_ADDRESS, USDC_ADDRESS, quoteExactInput, quoteRepForEthV3 } from '../../protocol/uniswapQuoter.js'

const PINNED_MAINNET_BLOCK = 22_000_000n
const ANVIL_START_TIMEOUT_MS = 30_000
const forkRpcUrl = process.env['MAINNET_ARCHIVE_RPC_URL']?.trim()
const describe = process.env['RUN_MAINNET_FORK_INTEGRATION_TESTS'] === '1' && forkRpcUrl !== undefined && forkRpcUrl !== '' ? baseDescribe : baseDescribe.skip

type ScheduleTimeout = (callback: () => void, delayMs: number) => () => void
type RpcFetch = (input: string, init: RequestInit) => Promise<Response>

const scheduleTimeout: ScheduleTimeout = (callback, delayMs) => {
	const timeoutId = setTimeout(callback, delayMs)
	return () => clearTimeout(timeoutId)
}

const withTimeout = async <Result>(operation: Promise<Result>, timeoutMs: number, timeoutMessage: string, schedule: ScheduleTimeout = scheduleTimeout): Promise<Result> => {
	let cancelTimeout = () => {}
	const timeout = new Promise<never>((_resolve, reject) => {
		cancelTimeout = schedule(() => reject(new Error(timeoutMessage)), timeoutMs)
	})
	try {
		return await Promise.race([operation, timeout])
	} finally {
		cancelTimeout()
	}
}

const waitForDelay = async (delayMs: number, signal: AbortSignal): Promise<void> => {
	signal.throwIfAborted()
	await new Promise<void>((resolve, reject) => {
		const cancelTimeout = scheduleTimeout(() => {
			signal.removeEventListener('abort', handleAbort)
			resolve()
		}, delayMs)
		const handleAbort = () => {
			cancelTimeout()
			reject(signal.reason)
		}
		signal.addEventListener('abort', handleAbort, { once: true })
	})
}

const parseAnvilListeningRpcUrl = (output: string): string | undefined => {
	const port = /Listening on 127\.0\.0\.1:([1-9][0-9]*)/.exec(output)?.[1]
	return port === undefined ? undefined : `http://127.0.0.1:${port}`
}

const readAnvilStdout = async (stdout: ReadableStream<Uint8Array>, onListening: (rpcUrl: string) => void): Promise<string> => {
	const reader = stdout.getReader()
	const decoder = new TextDecoder()
	let output = ''
	let reportedListeningAddress = false
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		output += decoder.decode(value, { stream: true })
		if (reportedListeningAddress) continue
		const rpcUrl = parseAnvilListeningRpcUrl(output)
		if (rpcUrl === undefined) continue
		reportedListeningAddress = true
		onListening(rpcUrl)
	}
	return output + decoder.decode()
}

test('pinned fork startup parses the OS-assigned Anvil RPC address', () => {
	expect(parseAnvilListeningRpcUrl('Listening on 127.0.0.1:43127')).toBe('http://127.0.0.1:43127')
	expect(parseAnvilListeningRpcUrl('Listening on 127.0.0.1:0')).toBeUndefined()
})

test('pinned fork startup cancels losing deadlines and stops readiness polling', async () => {
	let cancelledDeadlines = 0
	const fakeSchedule: ScheduleTimeout = () => () => {
		cancelledDeadlines += 1
	}
	expect(await withTimeout(Promise.resolve('ready'), ANVIL_START_TIMEOUT_MS, 'timeout', fakeSchedule)).toBe('ready')
	await expect(withTimeout(Promise.reject(new Error('process exited')), ANVIL_START_TIMEOUT_MS, 'timeout', fakeSchedule)).rejects.toThrow('process exited')
	expect(cancelledDeadlines).toBe(2)

	const controller = new AbortController()
	controller.abort(new Error('process exited'))
	let fetchCalls = 0
	const fetchRpc: RpcFetch = async () => {
		fetchCalls += 1
		return new Response()
	}
	await expect(waitForFork('http://127.0.0.1:1', controller.signal, fetchRpc)).rejects.toThrow('process exited')
	expect(fetchCalls).toBe(0)
})

async function waitForFork(rpcUrl: string, signal: AbortSignal, fetchRpc: RpcFetch = fetch) {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		signal.throwIfAborted()
		try {
			const response = await fetchRpc(rpcUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] }),
				signal,
			})
			if (response.ok) return
		} catch (error) {
			if (signal.aborted) throw signal.reason
			if (!(error instanceof TypeError)) throw error
			// Anvil has not opened its RPC socket yet.
		}
		await waitForDelay(100, signal)
	}
	throw new Error('Timed out starting the pinned mainnet fork')
}

void describe('Uniswap quote paths — pinned mainnet fork', () => {
	let client: ReturnType<typeof createPublicClient> | undefined
	let stopFork: (() => Promise<void>) | undefined

	beforeAll(async () => {
		if (forkRpcUrl === undefined || forkRpcUrl === '') throw new Error('MAINNET_ARCHIVE_RPC_URL is required for the pinned mainnet fork')
		const anvil = Bun.spawn([process.env['ANVIL_BIN']?.trim() || 'anvil', '--fork-url', forkRpcUrl, '--fork-block-number', PINNED_MAINNET_BLOCK.toString(), '--host', '127.0.0.1', '--port', '0'], { stderr: 'pipe', stdout: 'pipe' })
		const stderrPromise = new Response(anvil.stderr).text()
		let reportListeningRpcUrl: ((rpcUrl: string) => void) | undefined
		const listeningRpcUrlPromise = new Promise<string>(resolve => {
			reportListeningRpcUrl = resolve
		})
		const stdoutPromise = readAnvilStdout(anvil.stdout, rpcUrl => reportListeningRpcUrl?.(rpcUrl))
		let localRpcUrl: string | undefined
		try {
			localRpcUrl = await withTimeout(
				Promise.race([
					listeningRpcUrlPromise,
					anvil.exited.then(exitCode => {
						throw new Error(`Anvil exited before reporting its fork RPC address with code ${exitCode.toString()}`)
					}),
				]),
				ANVIL_START_TIMEOUT_MS,
				'Timed out waiting for Anvil to report its fork RPC address',
			)
			const readyController = new AbortController()
			try {
				await Promise.race([
					waitForFork(localRpcUrl, readyController.signal),
					anvil.exited.then(exitCode => {
						throw new Error(`Anvil exited before its fork RPC became ready with code ${exitCode.toString()}`)
					}),
				])
			} finally {
				readyController.abort(new Error('Stopped waiting for the pinned mainnet fork RPC'))
			}
		} catch (error) {
			anvil.kill()
			await anvil.exited
			const [stderr, stdout] = await Promise.all([stderrPromise, stdoutPromise])
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to start the pinned mainnet fork: ${message}${stdout === '' ? '' : `\nAnvil stdout:\n${stdout}`}${stderr === '' ? '' : `\nAnvil stderr:\n${stderr}`}`, { cause: error })
		}
		if (localRpcUrl === undefined) throw new Error('Pinned mainnet fork RPC address was not initialized')
		client = createPublicClient({ chain: mainnet, transport: http(localRpcUrl) })
		stopFork = async () => {
			anvil.kill()
			await anvil.exited
			await Promise.all([stderrPromise, stdoutPromise])
		}
	})

	afterAll(async () => {
		await stopFork?.()
	})

	function getClient() {
		if (client === undefined) throw new Error('Pinned mainnet fork client was not initialized')
		return client
	}

	test('fork height and production token metadata are deterministic', async () => {
		expect(await getClient().getBlockNumber()).toBe(PINNED_MAINNET_BLOCK)
		for (const [address, expectedDecimals] of [
			[REP_ADDRESS, 18n],
			[USDC_ADDRESS, 6n],
		] as const) {
			const decimals: unknown = await getClient().readContract({
				address,
				abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
				functionName: 'decimals',
			})
			if (typeof decimals !== 'bigint') throw new Error('Token decimals returned an unexpected value')
			expect(decimals).toBe(expectedDecimals)
		}
	})

	test('production V4 ETH/USDC route quotes at the pinned block', async () => {
		const amountOut = await quoteExactInput(getClient(), ETH_ADDRESS, USDC_ADDRESS, 10n ** 18n, { fee: 500, tickSpacing: 10 })
		expect(amountOut).toBeGreaterThan(100n * 10n ** 6n)
		expect(amountOut).toBeLessThan(100_000n * 10n ** 6n)
	})

	test('production REP/WETH V3 fallback quotes at the pinned block', async () => {
		const amountOut = await quoteRepForEthV3(getClient(), 10n ** 18n)
		expect(amountOut).toBeGreaterThan(10n ** 12n)
		expect(amountOut).toBeLessThan(10n ** 18n)
	})
})
