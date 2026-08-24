import type { Address } from '@zoltar/shared/ethereum'
import type { InjectedEthereum } from '../injectedEthereum.js'

export type SimulationProviderRequest = {
	method: string
	params?: unknown
}

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

export function createSimulationProvider({
	getChainId,
	getQueryDelayMilliseconds = () => 0,
	getSelectedAccount,
	requestRpc,
}: {
	getChainId: () => string
	getQueryDelayMilliseconds?: () => number
	getSelectedAccount: () => Address
	requestRpc: (parameters: SimulationProviderRequest) => Promise<unknown>
}): InjectedEthereum {
	const request = (async (parameters: SimulationProviderRequest) => {
		if (parameters.method === 'eth_accounts' || parameters.method === 'eth_requestAccounts') return [getSelectedAccount()]
		if (parameters.method === 'eth_chainId') return getChainId()
		await delayMilliseconds(getQueryDelayMilliseconds())
		return await requestRpc(normalizeTevmRequest(parameters))
	}) as InjectedEthereum['request']

	return {
		on: () => undefined,
		removeListener: () => undefined,
		request,
	}
}
