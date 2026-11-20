import * as tokensCopy from '../copy/tokens.js'
import { abbreviateAddress } from './address.js'
import { escapeOnChainText } from './onChainText.js'

/**
 * Labels a token for display. Only a token the caller identified by address
 * shows its bare symbol; any other token carries its shortened address so a
 * look-alike symbol cannot pass for a known token. Hidden characters are escaped so a bidi
 * override in the symbol cannot reorder or hide the address beside it.
 */
export function tokenDisplayLabel({ address, symbol, verified }: { address: string; symbol: string | undefined; verified: boolean }) {
	const trimmedSymbol = symbol?.trim()
	const usableSymbol = trimmedSymbol === undefined ? undefined : escapeOnChainText(trimmedSymbol)
	const shortAddress = abbreviateAddress(address)
	if (usableSymbol === undefined || usableSymbol === '') return tokensCopy.formatUnnamedTokenLabel(shortAddress)
	return verified ? usableSymbol : tokensCopy.formatUnverifiedTokenLabel(usableSymbol, shortAddress)
}
