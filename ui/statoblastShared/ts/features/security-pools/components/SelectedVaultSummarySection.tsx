import { getAssociatedRepPerCapacityBps, getVaultHealthTier } from '../lib/vaultHealth.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { VaultExposureValue } from './VaultExposureValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useRef } from 'preact/hooks'
import { AddressValue, FittedAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import type { SecurityVaultSectionProps } from '../../types.js'

type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolStatoblastSecurityMultiplierBps'> & {
	underwritingLimitAttoEth: bigint
	currentVaultIsHealthy?: boolean | undefined
	poolEnded?: boolean | undefined
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
	variant?: 'embedded' | 'record'
}

/** The full card width is the stable slot, so a shortened address keeps its copy glyph right after the visible text. */
function VaultCardAddress({ address }: { address: string }) {
	const slot = useRef<HTMLSpanElement>(null)
	return (
		<span className='selected-vault-address' ref={slot}>
			<FittedAddressValue address={address} slot={slot} />
		</span>
	)
}

export function SelectedVaultSummarySection({
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	underwritingLimitAttoEth,
	currentVaultIsHealthy,
	poolEnded = false,
	securityVaultDetails,
	selectedPoolStatoblastSecurityMultiplierBps,
	selectedVaultIsOwnedByAccount,
	variant = 'record',
}: SelectedVaultSummarySectionProps) {
	const associatedRepPerCapacityBps = getAssociatedRepPerCapacityBps({ disputeStakedAttoRep: securityVaultDetails.disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth, vaultAttoRepBacking: securityVaultDetails.vaultAttoRepBacking })
	const summaryTitle = <span>{securityPoolCopy.vaultSummary}</span>
	const repTokenSymbol = securityVaultDetails.repTokenSymbol ?? commonCopy.rep
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
						<span>{securityPoolCopy.commitmentLimit}</span>
						<strong>
							<VaultExposureValue capacity={underwritingLimitAttoEth} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.poolHeldVaultRepBackingAttoRep}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.vaultAttoRepBacking} suffix={repTokenSymbol} />
						</strong>
					</div>
					<div className='security-pool-browse-vault-row-kpi'>
						<span>{commonCopy.disputeStakedAttoRep}</span>
						<strong>
							<CurrencyValue value={securityVaultDetails.disputeStakedAttoRep} suffix={repTokenSymbol} />
						</strong>
					</div>
					{securityVaultDetails.badDebtAttoEth > 0n ? (
						<div className='security-pool-browse-vault-row-kpi'>
							<span>{securityPoolCopy.badDebt}</span>
							<strong>
								<CurrencyValue exactWhenRoundedToZero value={securityVaultDetails.badDebtAttoEth} suffix={commonCopy.eth} />
							</strong>
						</div>
					) : null}
				</div>
			</div>
		</div>
	)
	const gridContent = (
		<VaultMetricGrid
			openInterestAttoEth={securityVaultDetails.openInterestAttoEth}
			associatedRepPerCapacityBps={associatedRepPerCapacityBps}
			badDebtAttoEth={securityVaultDetails.badDebtAttoEth}
			layout='grid'
			disputeStakedAttoRep={securityVaultDetails.disputeStakedAttoRep}
			healthTier={getVaultHealthTier({ associatedRepPerCapacityBps, isCurrentlyHealthy: currentVaultIsHealthy, multiplierBps: selectedPoolStatoblastSecurityMultiplierBps })}
			poolEnded={poolEnded}
			poolHeldRepPerCapacityBps={securityVaultDetails.poolHeldRepPerCapacityBps}
			vaultAttoRepBacking={securityVaultDetails.vaultAttoRepBacking}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			underwritingLimitAttoEth={underwritingLimitAttoEth}
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
		<EntityCard badge={<Badge tone='muted'>{selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel}</Badge>} surface='flat' title={selectedVaultIsOwnedByAccount ? workspaceCopy.myVault : workspaceCopy.vaultDetails} variant='record'>
			<VaultCardAddress address={securityVaultDetails.vaultAddress} />
			{gridContent}
		</EntityCard>
	)
}
