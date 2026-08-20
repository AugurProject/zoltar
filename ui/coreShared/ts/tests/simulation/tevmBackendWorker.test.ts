/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { normalizeAccount } from '../../lib/chainBackend.js'
import { createSimulationBackend } from '../../simulation/tevmBackend.js'
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
