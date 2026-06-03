/// <reference lib="webworker" />

import { assertNever } from '../lib/assert.js'
import { createSimulationEngine } from './tevmEngine.js'
import type { SimulationWorkerCallMessage, SimulationWorkerEvent, SimulationWorkerMessage, SimulationWorkerRpcMessage } from './tevmWorkerProtocol.js'

function isDedicatedWorkerGlobalScope(value: typeof globalThis): value is typeof globalThis & DedicatedWorkerGlobalScope {
	return typeof value.postMessage === 'function' && 'onmessage' in value
}

function getWorkerScope() {
	if (!isDedicatedWorkerGlobalScope(globalThis)) throw new Error('Simulation worker was initialized outside a dedicated worker scope')
	return globalThis
}

const scope = getWorkerScope()

let enginePromise: ReturnType<typeof createSimulationEngine> | undefined = undefined

function postEvent(event: SimulationWorkerEvent) {
	scope.postMessage(event)
}

async function getEngine() {
	const currentEnginePromise = enginePromise
	if (currentEnginePromise === undefined) throw new Error('Simulation worker has not been initialized')
	return await currentEnginePromise
}

async function handleCall(message: SimulationWorkerCallMessage) {
	const engine = await getEngine()
	const { method } = message
	switch (method) {
		case 'advanceTime':
			await engine.advanceTime(message.params.seconds)
			return undefined
		case 'bootstrap':
			await engine.bootstrap()
			return undefined
		case 'exportState':
			return await engine.exportState(message.params.name)
		case 'getAccounts':
			return await engine.getAccounts()
		case 'getState':
			return engine.getState()
		case 'installSimulationProxyDeployer':
			await engine.installSimulationProxyDeployer(message.params)
			return undefined
		case 'mintRep':
			await engine.mintRep(message.params.amount)
			return undefined
		case 'mineBlock':
			await engine.mineBlock()
			return undefined
		case 'patchSimulationGenesisRepToken':
			await engine.patchSimulationGenesisRepToken(message.params)
			return undefined
		case 'reset':
			await engine.reset()
			return undefined
		case 'selectAccount':
			await engine.selectAccount(message.params.address)
			return undefined
		case 'setRepPerEthPrice':
			engine.setRepPerEthPrice(message.params.value)
			return undefined
		case 'setRepPerUsdcPrice':
			engine.setRepPerUsdcPrice(message.params.value)
			return undefined
		case 'setQueryDelayMilliseconds':
			engine.setQueryDelayMilliseconds(message.params.value)
			return undefined
		case 'setTransactionDelayMilliseconds':
			engine.setTransactionDelayMilliseconds(message.params.value)
			return undefined
		case 'waitForTransactionReceipt':
			return await engine.waitForTransactionReceipt(message.params.hash)
		case 'waitUntilReady':
			await engine.waitUntilReady()
			return undefined
		default:
			return assertNever(method)
	}
}

async function handleRpc(message: SimulationWorkerRpcMessage) {
	const engine = await getEngine()
	return await engine.request({
		method: message.method,
		params: message.params,
	})
}

scope.onmessage = event => {
	void (async () => {
		const message = event.data as SimulationWorkerMessage
		try {
			if (message.type === 'init') {
				if (enginePromise !== undefined) throw new Error('Simulation worker was already initialized')
				enginePromise = createSimulationEngine({
					initialization: message.initialization,
				})
				const engine = await enginePromise
				engine.subscribe(() => {
					postEvent({
						state: engine.getState(),
						type: 'state',
					})
				})
				postEvent({
					state: engine.getState(),
					type: 'ready',
				})
				return
			}

			if (message.type === 'call') {
				postEvent({
					id: message.id,
					type: 'result',
					value: await handleCall(message),
				})
				return
			}

			postEvent({
				id: message.id,
				type: 'result',
				value: await handleRpc(message),
			})
		} catch (error) {
			postEvent({
				...(message.type === 'init' ? {} : { id: message.id }),
				message: error instanceof Error ? error.message : 'Simulation worker request failed',
				type: 'error',
			})
		}
	})()
}
