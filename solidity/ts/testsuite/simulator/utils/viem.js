import { createPublicClient, createWalletClient, custom, http, publicActions } from 'viem'
import 'viem/window'
import { addressString } from './bigint'
import { mainnet } from 'viem/chains'
const DEFAULT_HTTP = 'https://ethereum.dark.florist'
export const createReadClient = (ethereum, cacheTime = 10_000) => {
	if (ethereum === undefined) return createPublicClient({ transport: http(DEFAULT_HTTP, { batch: { wait: 100 } }), cacheTime })
	return createWalletClient({ transport: custom(ethereum), cacheTime, chain: mainnet }).extend(publicActions)
}
export const createWriteClient = (ethereum, accountAddress, cacheTime = 10_000) => {
	if (ethereum === undefined) throw new Error('no window.ethereum injected')
	return createWalletClient({ account: addressString(accountAddress), transport: custom(ethereum), cacheTime, chain: mainnet }).extend(publicActions)
}
export const writeContractAndWait = async (client, execute) => {
	const hash = await execute()
	await client.waitForTransactionReceipt({ hash })
	return hash
}
//# sourceMappingURL=viem.js.map
