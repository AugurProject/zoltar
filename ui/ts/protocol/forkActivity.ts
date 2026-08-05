import type { ListedSecurityPool } from '../types/contracts.js'

type ForkActivitySource = Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRepAttoRep' | 'systemState' | 'truthAuctionStartedAt'>

export function deriveHasForkActivity(source: ForkActivitySource) {
	return source.systemState !== 'operational' || source.truthAuctionStartedAt > 0n || source.migratedRepAttoRep > 0n || source.forkOutcome !== 'none'
}
