import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import { DEFAULT_SIMULATION_WALLET_MODE, SIMULATION_WRONG_CHAIN_ID_HEX, UNRECOGNIZED_CHAIN_ERROR_CODE, createProviderRpcError, type SimulationWalletMode } from './simulationWallet.js'
import { sameChainId } from '../wallet/chainId.js'

export type SimulationProviderRequest = {
	method: string
	params?: unknown
}

export type SimulationProvider = InjectedEthereum & {
	getWalletMode(): SimulationWalletMode
	setWalletMode(mode: SimulationWalletMode): void
}

type ProviderEventHandler = (...args: unknown[]) => void

async function delayMilliseconds(milliseconds: number) {
	if (milliseconds <= 0) return
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds)
	})
}

function normalizeTevmRequest(parameters: SimulationProviderRequest): SimulationProviderRequest {
	if (parameters.method !== 'eth_call' || !Array.isArray(parameters.params) || parameters.params.length < 2) return parameters
	const blockSelector = parameters.params[1]
	if (typeof blockSelector !== 'object' || blockSelector === null || !('blockHash' in blockSelector)) return parameters
	return { ...parameters, params: [parameters.params[0], 'latest'] }
}

function readRequestedChainId(params: unknown) {
	if (!Array.isArray(params)) return undefined
	const request = params[0]
	if (typeof request !== 'object' || request === null || !('chainId' in request) || typeof request.chainId !== 'string') return undefined
	return request.chainId
}

export function createSimulationProvider({
	getChainId,
	getQueryDelayMilliseconds = () => 0,
	getSelectedAccount,
	initialWalletMode = DEFAULT_SIMULATION_WALLET_MODE,
	onWalletModeChange,
	requestRpc,
}: {
	getChainId: () => string
	getQueryDelayMilliseconds?: () => number
	getSelectedAccount: () => Address
	initialWalletMode?: SimulationWalletMode
	onWalletModeChange?: (mode: SimulationWalletMode, previousMode: SimulationWalletMode) => void
	requestRpc: (parameters: SimulationProviderRequest) => Promise<unknown>
}): SimulationProvider {
	let walletMode = initialWalletMode
	const handlers = new Map<string, Set<ProviderEventHandler>>()

	const emit = (eventName: string, ...args: unknown[]) => {
		for (const handler of handlers.get(eventName) ?? []) handler(...args)
	}

	const getAccounts = () => (walletMode === 'disconnected' ? [] : [getSelectedAccount()])
	const getReportedChainId = () => (walletMode === 'wrong-chain' ? SIMULATION_WRONG_CHAIN_ID_HEX : getChainId())

	const setWalletMode = (mode: SimulationWalletMode) => {
		if (mode === walletMode) return
		const previousMode = walletMode
		const previousChainId = getReportedChainId()
		const previousAccounts = getAccounts()
		walletMode = mode
		const nextChainId = getReportedChainId()
		const nextAccounts = getAccounts()
		if (nextChainId !== previousChainId) emit('chainChanged', nextChainId)
		if (nextAccounts.length !== previousAccounts.length) emit('accountsChanged', nextAccounts)
		onWalletModeChange?.(mode, previousMode)
	}

	const switchChain = (params: unknown) => {
		const requestedChainId = readRequestedChainId(params)
		if (requestedChainId === undefined) throw createProviderRpcError(-32602, 'wallet_switchEthereumChain requires a chainId parameter')
		if (!sameChainId(requestedChainId, getChainId())) throw createProviderRpcError(UNRECOGNIZED_CHAIN_ERROR_CODE, `Unrecognized chain ID ${requestedChainId}. The simulated wallet only knows the simulation chain.`)
		// A cooperative wallet switches straight back to the simulation chain, so the app's switch-network control recovers from `wrong-chain` mode.
		if (walletMode === 'wrong-chain') setWalletMode('connected')
		return null
	}

	const request = (async (parameters: SimulationProviderRequest) => {
		if (parameters.method === 'eth_accounts') return getAccounts()
		if (parameters.method === 'eth_requestAccounts') {
			// A cooperative wallet approves the connection prompt, so the app's connect control recovers from `disconnected` mode.
			if (walletMode === 'disconnected') setWalletMode('connected')
			return getAccounts()
		}
		if (parameters.method === 'eth_chainId') return getReportedChainId()
		if (parameters.method === 'wallet_switchEthereumChain') return switchChain(parameters.params)
		await delayMilliseconds(getQueryDelayMilliseconds())
		return await requestRpc(normalizeTevmRequest(parameters))
	}) as InjectedEthereum['request']

	return {
		getWalletMode: () => walletMode,
		on: (eventName, handler) => {
			const eventHandlers = handlers.get(eventName) ?? new Set<ProviderEventHandler>()
			eventHandlers.add(handler)
			handlers.set(eventName, eventHandlers)
		},
		removeListener: (eventName, handler) => {
			handlers.get(eventName)?.delete(handler)
		},
		request,
		setWalletMode,
	}
}
