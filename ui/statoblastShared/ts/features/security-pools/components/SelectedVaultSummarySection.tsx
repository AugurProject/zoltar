import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import { getAssociatedRepPerCapacityBps } from '../lib/vaultHealth.js'
import type { SecurityVaultSectionProps } from '../../types.js'

type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolStatoblastSecurityMultiplierBps'> & {
	underwritingLimitAttoEth: bigint
	currentVaultIsHealthy?: boolean | undefined
	poolEnded?: boolean | undefined
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
}

export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, underwritingLimitAttoEth, currentVaultIsHealthy, poolEnded = false, securityVaultDetails, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount }: SelectedVaultSummarySectionProps) {
	const associatedRepPerCapacityBps = getAssociatedRepPerCapacityBps({ disputeStakedAttoRep: securityVaultDetails.disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth, vaultAttoRepBacking: securityVaultDetails.vaultAttoRepBacking })
	const gridContent = (
		<VaultMetricGrid
			openInterestAttoEth={securityVaultDetails.openInterestAttoEth}
			associatedRepPerCapacityBps={associatedRepPerCapacityBps}
			badDebtAttoEth={securityVaultDetails.badDebtAttoEth}
			layout='grid'
			disputeStakedAttoRep={securityVaultDetails.disputeStakedAttoRep}
			isCurrentlyHealthy={currentVaultIsHealthy}
			poolEnded={poolEnded}
			poolHeldRepPerCapacityBps={securityVaultDetails.poolHeldRepPerCapacityBps}
			vaultAttoRepBacking={securityVaultDetails.vaultAttoRepBacking}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
			underwritingLimitAttoEth={underwritingLimitAttoEth}
			claimableFeesAttoEth={securityVaultDetails.claimableFeesAttoEth}
		/>
	)
	return (
		<EntityCard badge={<Badge tone={selectedVaultIsOwnedByAccount ? 'ok' : 'muted'}>{selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel}</Badge>} surface='flat' title={selectedVaultIsOwnedByAccount ? workspaceCopy.myVault : workspaceCopy.vaultDetails} variant='record'>
			<span className='selected-vault-address'>
				<AddressValue address={securityVaultDetails.vaultAddress} responsiveAbbreviation />
			</span>
			{gridContent}
		</EntityCard>
	)
}
