import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { getVaultHealthPresentation, VaultMetricGrid } from './VaultMetricGrid.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { getVaultSummaryHealth, sortByVaultHealthRisk } from '../lib/vaultHealth.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary } from '../../../types/contracts.js'

type SecurityPoolVaultDirectoryProps = {
	emptyState: ComponentChildren
	pool: ListedSecurityPool | undefined
	/** After resolution liquidation is closed, so rows carry no health verdict, edge, or risk ordering, as the selected vault drops its verdict. */
	poolEnded: boolean
	renderActions?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	renderBadge?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'mock' | 'v3' | 'v4' | 'open-oracle' | undefined
	repPerEthSourceUrl: string | undefined
}

/** Each vault is one compact row: its address and health verdict, its figures, then its actions. Riskier vaults come first, so liquidation candidates lead the list. */
export function SecurityPoolVaultDirectory({ emptyState, pool, poolEnded, renderActions, renderBadge, repPerEthPrice, repPerEthSource, repPerEthSourceUrl }: SecurityPoolVaultDirectoryProps) {
	if (pool === undefined) return <>{emptyState}</>
	const loadedVaultCount = BigInt(pool.vaults.length)
	const showingPartialDirectory = loadedVaultCount < pool.vaultCount
	// Health uses the same price as the selected vault's verdict, so opening a row never contradicts its badge.
	const rows = poolEnded
		? pool.vaults.map(vault => ({ health: { associatedRepPerCapacityBps: undefined, tier: 'unknown' as const }, vault }))
		: sortByVaultHealthRisk(
				pool.vaults.map(vault => ({ health: getVaultSummaryHealth({ multiplierBps: pool.statoblastSecurityMultiplierBps, repPerEthPrice, vault }), vault })),
				row => row.health.tier,
			)

	return (
		<div className='vault-position-list'>
			{pool.vaultScanCapped === true ? <UserMessage className='detail' tone='warning' detail={securityPoolCopy.vaultRegistryScanCapped} /> : null}
			{loadedVaultCount > 0n && showingPartialDirectory ? <p className='detail'>{securityPoolCopy.formatVaultDirectorySummary(loadedVaultCount, pool.vaultCount)}</p> : null}
			{pool.vaults.length === 0 ? emptyState : null}
			{rows.map(({ health, vault }) => {
				const healthPresentation = getVaultHealthPresentation(health.tier)
				return (
					<div className={`vault-position-strip is-${health.tier}`} key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}>
						<div className='vault-position-strip-head'>
							<div className='vault-position-strip-title'>
								<AddressValue abbreviated address={vault.vaultAddress} />
							</div>
							<div className='vault-position-strip-meta'>
								{healthPresentation.statusLabel === undefined ? undefined : (
									<Badge className='vault-health' tone={healthPresentation.badgeTone}>
										{healthPresentation.statusLabel}
									</Badge>
								)}
								{renderBadge === undefined ? null : renderBadge(vault)}
							</div>
						</div>
						<VaultMetricGrid
							associatedRepPerCapacityBps={health.associatedRepPerCapacityBps}
							badDebtAttoEth={vault.badDebtAttoEth}
							className='workflow-vault-grid'
							healthTier={health.tier}
							layout='preview'
							disputeStakedAttoRep={vault.disputeStakedAttoRep}
							vaultAttoRepBacking={vault.vaultAttoRepBacking}
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							underwritingLimitAttoEth={vault.underwritingLimitAttoEth}
							claimableFeesAttoEth={vault.claimableFeesAttoEth}
						/>
						<div className='vault-position-strip-actions'>{renderActions === undefined ? null : renderActions(vault)}</div>
					</div>
				)
			})}
		</div>
	)
}
