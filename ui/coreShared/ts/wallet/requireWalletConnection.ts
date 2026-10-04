import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import * as commonCopy from '../copy/common.js'
import * as userMessagesCopy from '../copy/userMessages.js'

/**
 * Guards a write action by checking that a wallet backend is present and
 * that the user has connected an account. Sets an error message and returns
 * false if either check fails.
 *
 * Usage:
 *   if (!requireWallet(accountAddress, setError, 'creating a pool')) return
 */
export function requireWallet(accountAddress: Address | undefined, setError: (message: string | undefined) => void, _actionLabel: string): accountAddress is Address {
	if (!getActiveBackend().hasWallet()) {
		setError(userMessagesCopy.walletInstallationRequired)
		return false
	}
	if (accountAddress === undefined) {
		setError(commonCopy.walletConnectionRequired)
		return false
	}
	return true
}
