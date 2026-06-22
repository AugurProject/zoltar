import type { Address } from 'viem'
import { getActiveBackend } from './activeEnvironment.js'
import { sameAddress } from './address.js'

export async function assertActiveWallet(accountAddress: Address) {
	const backend = getActiveBackend()
	if (!backend.hasWallet()) throw new Error('No wallet is available. Connect a wallet and try again.')
	const accounts = await backend.getAccounts()
	const connectedAccount = accounts[0]
	if (connectedAccount === undefined) throw new Error('Wallet account is no longer connected. Reconnect your wallet and try again.')
	if (!sameAddress(connectedAccount, accountAddress)) throw new Error('Wallet account changed. Review the action with the connected account and try again.')
	const chainId = await backend.getChainId()
	if (chainId !== backend.profile.chainIdHex) throw new Error(`Wallet network changed. Switch to ${backend.profile.displayName} and try again.`)
}
