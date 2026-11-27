import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import { DEFAULT_SIMULATION_WALLET_MODE, SIMULATION_WRONG_CHAIN_ID_HEX, UNRECOGNIZED_CHAIN_ERROR_CODE, createProviderRpcError, type SimulationWalletMode } from './simulationWallet.js'
import { sameChainId } from '../wallet/chainId.js'
import { formatBlockOutsideActiveChain } from '../copy/simulation.js'

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

/** Where each state-reading method takes its EIP-1898 block selector. */
export const BLOCK_SELECTOR_INDEX_BY_METHOD: Readonly<Record<string, number>> = {
	eth_call: 1,
	eth_estimateGas: 1,
	eth_getBalance: 1,
	eth_getCode: 1,
	eth_getStorageAt: 2,
	eth_getTransactionCount: 1,
}

/** EIP-1898's error for a block hash the node does not know or that is not canonical. */
const INVALID_BLOCK_SELECTOR_ERROR_CODE = -32001

function readBlockHashSelector(selector: unknown) {
	if (typeof selector !== 'object' || selector === null || !('blockHash' in selector) || typeof selector.blockHash !== 'string') return undefined
	return { blockHash: selector.blockHash, requireCanonical: 'requireCanonical' in selector && selector.requireCanonical === true }
}

function readBlockField(block: unknown, field: 'hash' | 'number') {
	if (typeof block !== 'object' || block === null || !(field in block)) return undefined
	const value: unknown = Reflect.get(block, field)
	return typeof value === 'string' ? value : undefined
}

/**
 * TEVM reads state at a block number but not at an EIP-1898 block hash, so the hash is resolved to its number first.
 * An unknown hash, or one that is not canonical when `requireCanonical` asks, fails like on a node instead of reading
 * the latest state, which would silently answer a pinned read with different state.
 */
async function resolveBlockHashSelector(parameters: SimulationProviderRequest, requestRpc: (parameters: SimulationProviderRequest) => Promise<unknown>): Promise<SimulationProviderRequest> {
	const selectorIndex = BLOCK_SELECTOR_INDEX_BY_METHOD[parameters.method]
	if (selectorIndex === undefined || !Array.isArray(parameters.params) || parameters.params.length <= selectorIndex) return parameters
	const selector = readBlockHashSelector(parameters.params[selectorIndex])
	if (selector === undefined) return parameters
	const blockNumber = readBlockField(await requestRpc({ method: 'eth_getBlockByHash', params: [selector.blockHash, false] }), 'number')
	if (blockNumber === undefined) throw createProviderRpcError(INVALID_BLOCK_SELECTOR_ERROR_CODE, `Block ${selector.blockHash} not found`)
	if (selector.requireCanonical) {
		const canonicalHash = readBlockField(await requestRpc({ method: 'eth_getBlockByNumber', params: [blockNumber, false] }), 'hash')
		if (canonicalHash?.toLowerCase() !== selector.blockHash.toLowerCase()) throw createProviderRpcError(INVALID_BLOCK_SELECTOR_ERROR_CODE, formatBlockOutsideActiveChain(selector.blockHash))
	}
	return { ...parameters, params: parameters.params.map((parameter: unknown, index) => (index === selectorIndex ? blockNumber : parameter)) }
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
		return await requestRpc(await resolveBlockHashSelector(parameters, requestRpc))
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
