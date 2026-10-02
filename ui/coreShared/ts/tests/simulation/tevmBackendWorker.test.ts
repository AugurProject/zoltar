/// <reference types='bun-types' />

import { describe, expect, mock, spyOn, test } from 'bun:test'
import { normalizeAccount } from '../../wallet/chainBackend.js'
import { createSimulationBackend } from '../../simulation/tevmBackend.js'
import { SIMULATION_WRONG_CHAIN_ID_HEX } from '../../simulation/simulationWallet.js'
import type { SimulationWorkerEvent, SimulationWorkerMessage, SimulationWorkerState } from '../../simulation/tevmWorkerProtocol.js'

function createWorkerHarness() {
	let errorHandler: ((event: ErrorEvent) => void) | undefined
	let messageErrorHandler: (() => void) | undefined
	let messageHandler: ((event: MessageEvent<SimulationWorkerEvent>) => void) | undefined
	let nextPostMessageError: Error | undefined
	const clearHandlers = mock(() => {
		errorHandler = undefined
		messageErrorHandler = undefined
		messageHandler = undefined
	})
	const postMessage = mock((_message: SimulationWorkerMessage) => {
		if (nextPostMessageError === undefined) return
		const error = nextPostMessageError
		nextPostMessageError = undefined
		throw error
	})
	const terminate = mock(() => undefined)
	const connection = {
		clearHandlers,
		postMessage,
		setErrorHandler: (handler: (event: ErrorEvent) => void) => {
			errorHandler = handler
		},
		setMessageErrorHandler: (handler: () => void) => {
			messageErrorHandler = handler
		},
		setMessageHandler: (handler: (event: MessageEvent<SimulationWorkerEvent>) => void) => {
			messageHandler = handler
		},
		terminate,
	}
	return {
		connection,
		emitError: (message: string) => errorHandler?.(new ErrorEvent('error', { message })),
		emitMessage: (message: SimulationWorkerEvent) => messageHandler?.(new MessageEvent('message', { data: message })),
		emitMessageError: () => messageErrorHandler?.(),
		failNextPostMessage: (error: Error) => {
			nextPostMessageError = error
		},
		postMessage,
		terminate,
	}
}

function createReadyState(): SimulationWorkerState {
	const selectedAccount = normalizeAccount('0x00000000000000000000000000000000000000a1')
	if (selectedAccount === undefined) throw new Error('Expected a valid simulation account')
	return {
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		blockCountSinceReset: 0n,
		currentScenario: 'baseline',
		currentSource: { kind: 'scenario', scenario: 'baseline' },
		currentTimestamp: 1n,
		isBootstrapped: true,
		isBootstrapping: false,
		queryDelayMilliseconds: 0,
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		selectedAccount,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
	}
}

describe('simulation worker lifecycle', () => {
	test('answers wallet discovery requests without forwarding them to the worker RPC', async () => {
		const worker = createWorkerHarness()
		const backendPromise = createSimulationBackend({}, { createWorkerConnection: () => worker.connection })
		worker.emitMessage({ state: createReadyState(), type: 'ready' })
		const backend = await backendPromise
		const provider = backend.getProvider()
		if (provider === undefined) throw new Error('Expected the simulation provider')

		const accountsPromise = provider.request({ method: 'eth_requestAccounts' })
		worker.emitMessage({ id: 1, type: 'result', value: undefined })

		await expect(accountsPromise).resolves.toEqual([backend.accounts[0]])
		expect(worker.postMessage).toHaveBeenCalledTimes(1)
	})

	test('honours the QA wallet mode for wallet discovery, network switching, and change listeners', async () => {
		const worker = createWorkerHarness()
		const backendPromise = createSimulationBackend({ walletMode: 'wrong-chain' }, { createWorkerConnection: () => worker.connection })
		worker.emitMessage({ state: createReadyState(), type: 'ready' })
		const backend = await backendPromise
		const chainChanged = mock(() => undefined)
		const accountsChanged = mock(() => undefined)
		backend.subscribeChainChanged(chainChanged)
		backend.subscribeAccountsChanged(accountsChanged)

		expect(backend.walletMode).toBe('wrong-chain')
		await expect(backend.getChainId()).resolves.toBe(SIMULATION_WRONG_CHAIN_ID_HEX)
		await expect(backend.createReadClient().getChainId()).resolves.toBe(backend.profile.chain.id)
		if (backend.switchNetwork === undefined) throw new Error('Expected the simulation backend to support switching networks')
		await backend.switchNetwork()
		expect(backend.walletMode).toBe('connected')
		await expect(backend.getChainId()).resolves.toBe(backend.profile.chainIdHex)
		expect(chainChanged).toHaveBeenCalledTimes(1)
		expect(accountsChanged).not.toHaveBeenCalled()

		await backend.setWalletMode('disconnected')
		expect(accountsChanged).toHaveBeenCalledTimes(1)
		await expect(backend.getAccounts()).resolves.toEqual([])
		const requestedAccounts = backend.requestAccounts()
		worker.emitMessage({ id: 1, type: 'result', value: [backend.accounts[0]] })
		await expect(requestedAccounts).resolves.toEqual([backend.accounts[0]])
		expect(backend.walletMode).toBe('connected')
		expect(accountsChanged).toHaveBeenCalledTimes(2)
		expect(chainChanged).toHaveBeenCalledTimes(1)
	})

	test('terminates a worker that fails before readiness', async () => {
		const worker = createWorkerHarness()
		const backendPromise = createSimulationBackend({}, { createWorkerConnection: () => worker.connection })

		worker.emitError('worker initialization failed')

		await expect(backendPromise).rejects.toThrow('worker initialization failed')
		expect(worker.terminate).toHaveBeenCalledTimes(1)
	})

	test('rejects pending and future controls when a ready worker fails', async () => {
		const worker = createWorkerHarness()
		const backendPromise = createSimulationBackend({}, { createWorkerConnection: () => worker.connection })
		worker.emitMessage({ state: createReadyState(), type: 'ready' })
		const backend = await backendPromise

		const mineBlockPromise = backend.mineBlock()
		expect(worker.postMessage).toHaveBeenLastCalledWith({
			id: 1,
			method: 'mineBlock',
			params: undefined,
			type: 'call',
		})
		worker.emitMessageError()

		await expect(mineBlockPromise).rejects.toThrow('Simulation worker message deserialization failed')
		await expect(backend.mineBlock()).rejects.toThrow('Simulation worker message deserialization failed')
		expect(worker.terminate).toHaveBeenCalledTimes(1)
	})

	test('keeps the worker usable after one request cannot be posted', async () => {
		const worker = createWorkerHarness()
		const backendPromise = createSimulationBackend({}, { createWorkerConnection: () => worker.connection })
		worker.emitMessage({ state: createReadyState(), type: 'ready' })
		const backend = await backendPromise

		worker.failNextPostMessage(new Error('request could not be posted'))
		await expect(backend.mineBlock()).rejects.toThrow('request could not be posted')

		const retryPromise = backend.mineBlock()
		worker.emitMessage({ id: 2, type: 'result', value: undefined })
		await expect(retryPromise).resolves.toBeUndefined()
		expect(worker.terminate).not.toHaveBeenCalled()
	})
})

test('stops a stalled simulation control and clears its loading state', async () => {
	const originalSetTimeout = globalThis.setTimeout
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => originalSetTimeout(handler, delay === 120_000 ? 10 : delay, ...args))
	const worker = createWorkerHarness()
	const pendingBackend = createSimulationBackend({}, { createWorkerConnection: () => worker.connection })
	worker.emitMessage({ state: { ...createReadyState(), isBootstrapping: true }, type: 'ready' })
	const backend = await pendingBackend
	try {
		const result = backend.mineBlock().then(
			() => 'unexpected success',
			error => (error instanceof Error ? error.message : 'unexpected error'),
		)
		expect(await Promise.race([result, new Promise(resolve => originalSetTimeout(() => resolve('still waiting'), 50))])).toContain('timed out')
		expect(backend.isBootstrapping).toBe(false)
		expect(backend.bootstrapError).toContain('Reload')
		expect(worker.terminate).toHaveBeenCalledTimes(1)
	} finally {
		await backend.dispose()
		timer.mockRestore()
	}
})

test('keeps a scenario bootstrap alive while the worker reports progress beyond the request timeout', async () => {
	const originalSetTimeout = globalThis.setTimeout
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => originalSetTimeout(handler, delay === 120_000 ? 30 : delay, ...args))
	const worker = createWorkerHarness()
	const pendingBackend = createSimulationBackend({ scenario: 'baseline' }, { createWorkerConnection: () => worker.connection })
	worker.emitMessage({ state: { ...createReadyState(), isBootstrapped: false }, type: 'ready' })
	const backend = await pendingBackend
	try {
		const bootstrap = backend.bootstrap().then(
			() => 'bootstrapped',
			error => (error instanceof Error ? error.message : 'unexpected error'),
		)
		// Ten progress reports 15 ms apart outlast the 30 ms stand-in for the request timeout several times over.
		for (let step = 1; step <= 10; step += 1) {
			await new Promise(resolve => originalSetTimeout(resolve, 15))
			worker.emitMessage({ state: { ...createReadyState(), bootstrapLabel: `Seeding step ${step.toString()}`, bootstrapProgress: step / 10, isBootstrapped: false, isBootstrapping: true }, type: 'state' })
		}
		worker.emitMessage({ id: 1, type: 'result', value: undefined })
		expect(await bootstrap).toBe('bootstrapped')
		expect(worker.terminate).not.toHaveBeenCalled()
	} finally {
		await backend.dispose()
		timer.mockRestore()
	}
})

test('stops a scenario bootstrap that stops reporting progress', async () => {
	const originalSetTimeout = globalThis.setTimeout
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => originalSetTimeout(handler, delay === 120_000 ? 10 : delay, ...args))
	const worker = createWorkerHarness()
	const pendingBackend = createSimulationBackend({ scenario: 'baseline' }, { createWorkerConnection: () => worker.connection })
	worker.emitMessage({ state: { ...createReadyState(), isBootstrapped: false }, type: 'ready' })
	const backend = await pendingBackend
	try {
		const bootstrap = backend.bootstrap().then(
			() => 'unexpected success',
			error => (error instanceof Error ? error.message : 'unexpected error'),
		)
		expect(await Promise.race([bootstrap, new Promise(resolve => originalSetTimeout(() => resolve('still waiting'), 100))])).toContain('timed out')
		expect(backend.bootstrapError).toContain('Reload')
		expect(worker.terminate).toHaveBeenCalledTimes(1)
	} finally {
		await backend.dispose()
		timer.mockRestore()
	}
})
