import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { getVaultCollateralizationPercent } from '../../markets/lib/trading.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary } from '../../../types/contracts.js'

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
	const loadedVaultCount = BigInt(pool.vaults.length)
	const showingPartialDirectory = loadedVaultCount < pool.vaultCount

	return (
		<div className='vault-position-list'>
			{showingPartialDirectory ? <p className='detail'>{securityPoolCopy.formatVaultDirectorySummary(loadedVaultCount, pool.vaultCount)}</p> : null}
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
							escalationEscrowedRep={vault.escalationEscrowedRep}
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
