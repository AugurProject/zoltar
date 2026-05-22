import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
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
	if (pool === undefined || pool.vaults.length === 0) {
		return <>{emptyState}</>
	}

	return (
		<div className='entity-card-list'>
			{pool.vaults.map(vault => (
				<EntityCard
					key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}
					className='compact'
					title={renderTitle === undefined ? <AddressValue address={vault.vaultAddress} /> : renderTitle(vault)}
					variant='compact'
					badge={renderBadge === undefined ? undefined : renderBadge(vault)}
					actions={renderActions === undefined ? undefined : renderActions(vault)}
				>
					<VaultMetricGrid
						className='workflow-vault-grid'
						lockedRepInEscalationGame={vault.lockedRepInEscalationGame}
						repDepositShare={vault.repDepositShare}
						repPerEthPrice={repPerEthPrice}
						repPerEthSource={repPerEthSource}
						repPerEthSourceUrl={repPerEthSourceUrl}
						selectedPoolSecurityMultiplier={pool.securityMultiplier}
						securityBondAllowance={vault.securityBondAllowance}
						unpaidEthFees={vault.unpaidEthFees}
						variant='embedded'
					/>
				</EntityCard>
			))}
		</div>
	)
}
