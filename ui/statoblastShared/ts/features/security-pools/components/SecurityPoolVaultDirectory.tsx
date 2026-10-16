import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { getVaultHealthPresentation, getVaultSummaryHealthStatus } from '../lib/vaultHealth.js'

type SecurityPoolVaultDirectoryProps = {
	emptyState: ComponentChildren
	pool: ListedSecurityPool | undefined
	/** After resolution liquidation is closed, so rows show no health verdict, like the vault details view. */
	poolEnded?: boolean | undefined
	renderActions?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	renderBadge?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	renderTitle?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'mock' | 'v3' | 'v4' | 'open-oracle' | undefined
	repPerEthSourceUrl: string | undefined
}

export function SecurityPoolVaultDirectory({ emptyState, pool, poolEnded = false, renderActions, renderBadge, renderTitle, repPerEthPrice, repPerEthSource, repPerEthSourceUrl }: SecurityPoolVaultDirectoryProps) {
	if (pool === undefined) return <>{emptyState}</>
	const loadedVaultCount = BigInt(pool.vaults.length)
	const showingPartialDirectory = loadedVaultCount < pool.vaultCount

	return (
		<div className='vault-position-list'>
			{pool.vaultScanCapped === true ? <UserMessage className='detail' tone='warning' detail={securityPoolCopy.vaultRegistryScanCapped} /> : null}
			{loadedVaultCount > 0n && showingPartialDirectory ? <p className='detail'>{securityPoolCopy.formatVaultDirectorySummary(loadedVaultCount, pool.vaultCount)}</p> : null}
			{pool.vaults.length === 0 ? emptyState : null}
			{pool.vaults.map(vault => {
				// Each row states its health in words and tone at the same REP price as the vault details view.
				const health = poolEnded ? undefined : getVaultHealthPresentation(getVaultSummaryHealthStatus({ repPerEthPrice, statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps, vault }))
				return (
					<div className='vault-position-strip' key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}>
						<div className='vault-position-strip-head'>
							<div className='vault-position-strip-title'>
								<div className='vault-position-title-copy'>{renderTitle === undefined ? <AddressValue address={vault.vaultAddress} /> : renderTitle(vault)}</div>
							</div>
							<div className='vault-position-strip-meta'>
								{health === undefined ? null : <Badge tone={health.tone}>{health.label}</Badge>}
								{renderBadge === undefined ? null : renderBadge(vault)}
							</div>
						</div>
						<VaultMetricGrid
							badDebtAttoEth={vault.badDebtAttoEth}
							className='workflow-vault-grid'
							layout='preview'
							disputeStakedAttoRep={vault.disputeStakedAttoRep}
							vaultAttoRepBacking={vault.vaultAttoRepBacking}
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							selectedPoolStatoblastSecurityMultiplierBps={pool.statoblastSecurityMultiplierBps}
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
