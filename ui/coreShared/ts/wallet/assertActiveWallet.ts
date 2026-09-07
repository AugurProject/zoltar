import type { Address } from '@zoltar/shared/ethereum'
import { createActiveEnvironmentGuard, getActiveBackend } from './activeEnvironment.js'
import { sameAddress } from './address.js'
import { sameChainId } from './chainId.js'

export type ActiveWalletContext = {
	accountAddress: Address
	chainId: string
	isEnvironmentCurrent: () => boolean
}

export async function assertActiveWallet(accountAddress: Address) {
	const backend = getActiveBackend()
	const environmentGuard = createActiveEnvironmentGuard()
	if (!backend.hasWallet()) throw new Error('No wallet is available. Connect a wallet and try again.')
	const accounts = await backend.getAccounts()
	if (!environmentGuard.isCurrent()) throw new Error('The active environment changed. Review the action and try again.')
	const connectedAccount = accounts[0]
	if (connectedAccount === undefined) throw new Error('Wallet account is no longer connected. Reconnect your wallet and try again.')
	if (!sameAddress(connectedAccount, accountAddress)) throw new Error('Wallet account changed. Review the action with the connected account and try again.')
	const chainId = await backend.getChainId()
	if (!environmentGuard.isCurrent()) throw new Error('The active environment changed. Review the action and try again.')
	if (!sameChainId(chainId, backend.profile.chainIdHex)) throw new Error(`Wallet network changed. Switch to ${backend.profile.displayName} and try again.`)
	return {
		accountAddress: connectedAccount,
		chainId,
		isEnvironmentCurrent: environmentGuard.isCurrent,
	} satisfies ActiveWalletContext
}
