import type { ComponentChildren } from 'preact'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { AddressValue } from './AddressValue.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary } from '../types/contracts.js'

type SecurityPoolVaultDirectoryProps = {
	emptyState: ComponentChildren
	pool: ListedSecurityPool | undefined
	renderActions?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	renderBadge?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	renderTitle?: (vault: SecurityPoolVaultSummary) => ComponentChildren
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'mock' | 'v3' | 'v4' | undefined
	repPerEthSourceUrl: string | undefined
}

export function SecurityPoolVaultDirectory({ emptyState, pool, renderActions, renderBadge, renderTitle, repPerEthPrice, repPerEthSource, repPerEthSourceUrl }: SecurityPoolVaultDirectoryProps) {
	if (pool === undefined || pool.vaults.length === 0) return <>{emptyState}</>

	return (
		<div className='vault-position-list'>
			{pool.vaults.map(vault => {
				const collateralizationPercent = getVaultCollateralizationPercent(vault.repDepositShare, vault.securityBondAllowance, repPerEthPrice)
				const collateralizationTarget = pool.securityMultiplier * 100n * 10n ** 18n
				return (
					<div className='vault-position-strip' key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}>
						<div className='vault-position-strip-head'>
							<div className='vault-position-strip-title'>
								<CollateralizationCircle collateralizationPercent={collateralizationPercent} className='vault-position-title-collateralization' size='small' targetCollateralizationPercent={collateralizationTarget} />
								<div className='vault-position-title-copy'>{renderTitle === undefined ? <AddressValue address={vault.vaultAddress} /> : renderTitle(vault)}</div>
							</div>
							<div className='vault-position-strip-meta'>{renderBadge === undefined ? null : renderBadge(vault)}</div>
						</div>
						<VaultMetricGrid
							className='workflow-vault-grid'
							layout='preview'
							lockedRepInEscalationGame={vault.lockedRepInEscalationGame}
							repDepositShare={vault.repDepositShare}
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							selectedPoolSecurityMultiplier={pool.securityMultiplier}
							securityBondAllowance={vault.securityBondAllowance}
							unpaidEthFees={vault.unpaidEthFees}
						/>
						<div className='vault-position-strip-actions'>{renderActions === undefined ? null : renderActions(vault)}</div>
					</div>
				)
			})}
		</div>
	)
}
