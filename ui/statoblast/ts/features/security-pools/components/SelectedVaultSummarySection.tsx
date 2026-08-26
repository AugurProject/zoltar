import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import type { SecurityVaultSectionProps } from '../../types.js'

type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolStatoblastSecurityMultiplierBps'> & {
	capacityOwnershipAttoRep: bigint
	currentVaultIsHealthy?: boolean | undefined
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
	variant?: 'embedded' | 'record'
}

export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, capacityOwnershipAttoRep, currentVaultIsHealthy, securityVaultDetails, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount, variant = 'record' }: SelectedVaultSummarySectionProps) {
	const summaryTitle = <span>{securityPoolCopy.vaultSummary}</span>
	const embeddedContent = (
		<div className='security-pool-selected-vault-summary security-pool-browse-vault-list'>
			<div className='security-pool-browse-vault-row'>
				<div className={`security-pool-browse-vault-row-top security-pool-browse-vault-row-top-compact${securityVaultDetails.badDebtAttoEth > 0n ? ' with-bad-debt' : ''}`}>
					<div className='security-pool-browse-vault-row-title'>
						<div className='security-pool-browse-vault-row-id'>
							<strong>
								<AddressValue address={securityVaultDetails.vaultAddress} />
							</strong>
						</div>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{securityPoolCopy.currentCapacityOwnershipAttoRep}</span>
						<strong>
							<CurrencyValue value={capacityOwnershipAttoRep} suffix={commonCopy.rep} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.poolHeldVaultRepBackingAttoRep}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.vaultAttoRepBacking} suffix={commonCopy.rep} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.disputeStakedAttoRep}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.disputeStakedAttoRep} suffix={commonCopy.rep} />
						</strong>
					</div>
					{securityVaultDetails.badDebtAttoEth > 0n ? (
						<div className='security-pool-browse-vault-row-kpi'>
							<span>{securityPoolCopy.badDebt}</span>
							<strong>
								<CurrencyValue value={securityVaultDetails.badDebtAttoEth} suffix={commonCopy.eth} />
							</strong>
						</div>
					) : null}
				</div>
			</div>
		</div>
	)
	const gridContent = (
		<VaultMetricGrid
			associatedRepPerCapacityBps={securityVaultDetails.associatedRepPerCapacityBps}
			badDebtAttoEth={securityVaultDetails.badDebtAttoEth}
			layout='grid'
			disputeStakedAttoRep={securityVaultDetails.disputeStakedAttoRep}
			isCurrentlyHealthy={currentVaultIsHealthy}
			poolHeldRepPerCapacityBps={securityVaultDetails.poolHeldRepPerCapacityBps}
			vaultAttoRepBacking={securityVaultDetails.vaultAttoRepBacking}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
			capacityOwnershipAttoRep={capacityOwnershipAttoRep}
			claimableFeesAttoEth={securityVaultDetails.claimableFeesAttoEth}
		/>
	)
	if (variant === 'embedded')
		return (
			<SectionBlock density='compact' headingLevel={4} title={summaryTitle} variant='embedded'>
				{embeddedContent}
			</SectionBlock>
		)
	return (
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel}</Badge>} surface='flat' title={securityPoolCopy.selectedVault} variant='record'>
			{gridContent}
		</EntityCard>
	)
}
