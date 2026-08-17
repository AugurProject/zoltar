import { getActiveBackend } from './activeEnvironment.js';
/**
 * Guards a write action by checking that a wallet backend is present and
 * that the user has connected an account. Sets an error message and returns
 * false if either check fails.
 *
 * Usage:
 *   if (!requireWallet(accountAddress, setError, 'creating a pool')) return
 */
export function requireWallet(accountAddress, setError, _actionLabel) {
    if (!getActiveBackend().hasWallet()) {
        setError('Connect wallet to continue.');
        return false;
    }
    if (accountAddress === undefined) {
        setError('Connect wallet to continue.');
        return false;
    }
    return true;
}
//# sourceMappingURL=requireWalletConnection.js.map