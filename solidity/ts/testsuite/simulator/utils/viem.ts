import { createPublicClient, createWalletClient, custom, EIP1193Provider, http, publicActions } from 'viem'
import 'viem/window'
import { addressString } from './bigint'
import { mainnet } from 'viem/chains'
import { AnvilWindowEthereum } from '../AnvilWindowEthereum'

const DEFAULT_HTTP = 'https://ethereum.dark.florist'

export const createReadClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, cacheTime: number = 10_000) => {
	if (ethereum === undefined) return createPublicClient({ transport: http(DEFAULT_HTTP, { batch: { wait: 100 } }), cacheTime })
	return createWalletClient({ transport: custom(ethereum), cacheTime, chain: mainnet }).extend(publicActions)
}

export const createWriteClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, accountAddress: bigint, cacheTime: number = 10_000) => {
	if (ethereum === undefined) throw new Error('no window.ethereum injected')
	return createWalletClient({ account: addressString(accountAddress), transport: custom(ethereum), cacheTime, chain: mainnet }).extend(publicActions)
}

export type WriteClient = ReturnType<typeof createWriteClient>
export type ReadClient = ReturnType<typeof createReadClient> | ReturnType<typeof createWriteClient>
