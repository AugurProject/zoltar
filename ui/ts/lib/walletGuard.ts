import type { Address } from 'viem'
import { getRequiredInjectedEthereum } from './clients.js'

/**
 * Guards a write action by checking that an injected wallet is present and
 * that the user has connected an account. Sets an error message and returns
 * false if either check fails.
 *
 * Usage:
 *   if (!requireWallet(accountAddress, setError, 'creating a pool')) return
 */
export function requireWallet(accountAddress: Address | undefined, setError: (message: string | undefined) => void, actionLabel: string): accountAddress is Address {
	try {
		getRequiredInjectedEthereum()
	} catch {
		setError('No injected wallet found')
		return false
	}
	if (accountAddress === undefined) {
		setError(`Connect a wallet before ${actionLabel}`)
		return false
	}
	return true
}
