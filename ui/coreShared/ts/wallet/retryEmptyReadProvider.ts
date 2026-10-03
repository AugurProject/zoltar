import { createPublicClient, http, requestRpc } from '@zoltar/core-shared/evm/ethereum'
import { getErrorDetail, isWalletRejection } from '../lib/errors.js'
import { parseInjectedChainId, requestWalletRpc, type InjectedEthereum } from './injectedEthereum.js'
import { blockParameterIndex } from './confirmedReadTransport.js'
import type { NetworkProfile } from './networkProfile.js'

function numberedRead(parameters: Parameters<InjectedEthereum['request']>[0]) {
	const index = blockParameterIndex(parameters.method)
	const block = index === undefined || !Array.isArray(parameters.params) ? undefined : parameters.params[index]
	return typeof block === 'string' && /^0x[0-9a-f]+$/i.test(block)
}

/** Recover only MetaMask's exhausted numbered-block reads. Preserve the call and block; never forward wallet writes. */
export function createRetryEmptyReadProvider(provider: InjectedEthereum, profile: NetworkProfile, rpcUrl: string): InjectedEthereum {
	const transport = http(rpcUrl, { retryCount: 0 })
	const rpc = createPublicClient({ transport })
	return {
		request: async parameters => {
			try {
				return await requestWalletRpc(provider, parameters)
			} catch (error) {
				if (!numberedRead(parameters) || isWalletRejection(error) || !getErrorDetail(error)?.includes('RetryOnEmptyMiddleware - retries exhausted')) throw error
				const walletChain = parseInjectedChainId(await requestWalletRpc(provider, { method: 'eth_chainId', params: [] }))
				if (BigInt(walletChain) !== BigInt(profile.chain.id)) throw new Error(`Wallet network changed. Switch to ${profile.displayName} and try again.`)
				if ((await rpc.getChainId()) !== profile.chain.id) throw new Error(`Read RPC network does not match ${profile.displayName}.`)
				return await requestRpc(transport, parameters)
			}
		},
	}
}
