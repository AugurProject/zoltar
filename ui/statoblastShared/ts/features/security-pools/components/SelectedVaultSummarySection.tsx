import { getVaultSummaryHealth } from '../lib/vaultHealth.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useRef } from 'preact/hooks'
import { FittedAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { VaultMetricGrid } from './VaultMetricGrid.js'
import type { SecurityVaultSectionProps } from '../../types.js'

type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'selectedPoolStatoblastSecurityMultiplierBps'> & {
	poolEnded?: boolean | undefined
	securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>
	selectedVaultIsOwnedByAccount: boolean
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

export function SelectedVaultSummarySection({ repPerEthPrice, poolEnded = false, securityVaultDetails, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount }: SelectedVaultSummarySectionProps) {
	// The same rule as the vault directory's rows; details still loading carry no verdict.
	const health = securityVaultDetails.openInterestAttoEth === undefined ? undefined : getVaultSummaryHealth({ multiplierBps: selectedPoolStatoblastSecurityMultiplierBps, poolEnded, repPerEthPrice, vault: securityVaultDetails })
	const gridContent = (
		<VaultMetricGrid
			openInterestAttoEth={securityVaultDetails.openInterestAttoEth}
			associatedRepPerCapacityBps={health?.associatedRepPerCapacityBps}
			badDebtAttoEth={securityVaultDetails.badDebtAttoEth}
			layout='grid'
			disputeStakedAttoRep={securityVaultDetails.disputeStakedAttoRep}
			healthTier={health?.tier ?? 'unknown'}
			poolEnded={poolEnded}
			vaultAttoRepBacking={securityVaultDetails.vaultAttoRepBacking}
			underwritingLimitAttoEth={securityVaultDetails.underwritingLimitAttoEth}
		/>
	)
	return (
		<EntityCard badge={<Badge tone='muted'>{selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel}</Badge>} surface='flat' title={selectedVaultIsOwnedByAccount ? workspaceCopy.myVault : workspaceCopy.vaultDetails} variant='record'>
			<VaultCardAddress address={securityVaultDetails.vaultAddress} />
			{gridContent}
		</EntityCard>
	)
}
