import { createPublicClient, createWalletClient, custom, EIP1193Provider, http, publicActions } from 'viem'
import 'viem/window'
import { addressString } from './bigint'
import { mainnet } from 'viem/chains'
import { AnvilWindowEthereum } from '../AnvilWindowEthereum'

const DEFAULT_HTTP = 'https://ethereum.dark.florist'

async function getChainId(ethereum: EIP1193Provider | AnvilWindowEthereum): Promise<number> {
	// For EIP1193Provider, try to get chainId
	if ('chainId' in ethereum && typeof ethereum.chainId === 'number') {
		return ethereum.chainId
	}
	if ('chainId' in ethereum && typeof ethereum.chainId === 'string') {
		return parseInt(ethereum.chainId, 16)
	}
	// For AnvilWindowEthereum or providers without chainId, try RPC call
	if ('request' in ethereum) {
		try {
			const result = await (ethereum as EIP1193Provider).request({ method: 'eth_chainId' })
			if (typeof result === 'string') {
				return parseInt(result, 16)
			}
			if (typeof result === 'number') {
				return result
			}
		} catch {
			// fall through
		}
	}
	// Default to mainnet
	return 1
}

export const createReadClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, cacheTime: number = 10_000) => {
	if (ethereum === undefined) return createPublicClient({ transport: http(DEFAULT_HTTP, { batch: { wait: 100 } }), cacheTime })
	return createWalletClient({ transport: custom(ethereum), cacheTime }).extend(publicActions)
}

export const createWriteClient = async (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, accountAddress: bigint, cacheTime: number = 10_000) => {
	if (ethereum === undefined) throw new Error('no window.ethereum injected')
	const chain = await getChainId(ethereum)
	return createWalletClient({ account: addressString(accountAddress), transport: custom(ethereum), cacheTime, chain }).extend(publicActions)
}

export type WriteClient = ReturnType<typeof createWriteClient>
export type ReadClient = ReturnType<typeof createReadClient> | ReturnType<typeof createWriteClient>
