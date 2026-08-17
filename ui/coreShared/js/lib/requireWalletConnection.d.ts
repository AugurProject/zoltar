import type { Address } from '@zoltar/shared/ethereum';
/**
 * Guards a write action by checking that a wallet backend is present and
 * that the user has connected an account. Sets an error message and returns
 * false if either check fails.
 *
 * Usage:
 *   if (!requireWallet(accountAddress, setError, 'creating a pool')) return
 */
export declare function requireWallet(accountAddress: Address | undefined, setError: (message: string | undefined) => void, _actionLabel: string): accountAddress is Address;
//# sourceMappingURL=requireWalletConnection.d.ts.map