import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { createActiveEnvironmentGuard, getActiveBackend } from '../lib/activeEnvironment.js'
import { sameAddress } from '../lib/address.js'
import { sameChainId } from './chainId.js'
import { createUserFacingError } from '../lib/errors.js'
import { walletAddressChanged, walletDisconnected } from '../copy/userMessages.js'

export type ActiveWalletContext = {
	accountAddress: Address
	chainId: string
	isEnvironmentCurrent: () => boolean
}

export async function assertActiveWallet(accountAddress: Address) {
	const backend = getActiveBackend()
	const environmentGuard = createActiveEnvironmentGuard()
	if (!backend.hasWallet()) throw createUserFacingError('No wallet is available. Connect a wallet and try again.')
	const accounts = await backend.getAccounts()
	if (!environmentGuard.isCurrent()) throw createUserFacingError('The active network or simulation changed. Review the action and try again.')
	const connectedAccount = accounts[0]
	if (connectedAccount === undefined) throw createUserFacingError(walletDisconnected)
	if (!sameAddress(connectedAccount, accountAddress)) throw createUserFacingError(walletAddressChanged)
	const chainId = await backend.getChainId()
	if (!environmentGuard.isCurrent()) throw createUserFacingError('The active network or simulation changed. Review the action and try again.')
	if (!sameChainId(chainId, backend.profile.chainIdHex)) throw createUserFacingError(`Wallet network changed. Switch to ${backend.profile.displayName} and try again.`)
	return {
		accountAddress: connectedAccount,
		chainId,
		isEnvironmentCurrent: environmentGuard.isCurrent,
	} satisfies ActiveWalletContext
}
