import type { EcosystemSnapshot } from '../operations/types.ts'
import type { DurableRetirementState } from '../state/retirement.ts'

export function recordCanonicalRecoveredBalances(retirement: DurableRetirementState, snapshot: EcosystemSnapshot) {
	const observed = Object.fromEntries([
		['ETH', snapshot.wallet.ethBalanceAttoEth],
		...snapshot.wallet.tokens.map(token => [token.address, token.balance] as const),
		...snapshot.wallet.lpTokens.map(token => [`LP:${token.pair}`, token.balance] as const),
		...snapshot.wallet.shares.flatMap(shares => [[`${shares.shareToken}:INVALID`, shares.invalid] as const, [`${shares.shareToken}:YES`, shares.yes] as const, [`${shares.shareToken}:NO`, shares.no] as const]),
	])
	for (const [asset, balance] of Object.entries(observed)) {
		const previous = retirement.lastObservedBalances[asset]
		if (previous !== undefined && BigInt(balance) > BigInt(previous)) {
			retirement.recoveredBalances[asset] = (BigInt(retirement.recoveredBalances[asset] ?? '0') + BigInt(balance) - BigInt(previous)).toString()
		}
		retirement.lastObservedBalances[asset] = balance
	}
}
