import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'

type ForkActivitySource = Pick<ListedSecurityPool, 'forkOutcome' | 'migratedAttoRep' | 'systemState' | 'truthAuctionStartedAt'>

export function deriveHasForkActivity(source: ForkActivitySource) {
	return source.systemState !== 'operational' || source.truthAuctionStartedAt > 0n || source.migratedAttoRep > 0n || source.forkOutcome !== 'none'
}
