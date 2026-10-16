import { useEffect, useRef } from 'preact/hooks'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isVaultHealthyAtFactor } from '../lib/liquidation.js'
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSelectedVaultOwner, isSelectedVaultOwnedByAccount } from '../lib/securityVault.js'
import type { SecurityVaultSectionProps } from '../../types.js'
import { SelectedVaultSummarySection } from './SelectedVaultSummarySection.js'
import { VaultAdditionalActions } from './SecurityVaultActionFields.js'

/** The selected vault's summary and the actions it offers beyond the vault operations panel, loading the vault when the selection changes. */
export function SecurityVaultSection({
	accountState,
	extraReadinessActions = [],
	loadingSecurityVault,
	onLoadSecurityVault,
	poolState,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityVaultDetails,
	securityVaultError,
	securityVaultForm,
	selectedPoolStatoblastSecurityMultiplierBps,
}: SecurityVaultSectionProps) {
	const selectedVaultOwner = getSelectedVaultOwner(securityVaultForm.selectedVaultOwner, accountState.address)
	const currentSelectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
		accountAddress: accountState.address,
		securityPoolAddress: securityVaultForm.securityPoolAddress,
		securityVaultDetails,
		selectedVaultOwner: securityVaultForm.selectedVaultOwner,
	})
		? securityVaultDetails
		: undefined
	const currentVaultIsHealthy =
		currentSelectedVaultDetails === undefined || currentSelectedVaultDetails.openInterestAttoEth === undefined || repPerEthPrice === undefined || selectedPoolStatoblastSecurityMultiplierBps === undefined
			? undefined
			: isVaultHealthyAtFactor({
					disputeStakedAttoRep: currentSelectedVaultDetails.disputeStakedAttoRep,
					healthFactorBps: 10_000n,
					underwritingLimitAttoEth: currentSelectedVaultDetails.underwritingLimitAttoEth,
					poolHeldVaultRepBackingAttoRep: currentSelectedVaultDetails.vaultAttoRepBacking,
					poolSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
					repPerEthPrice,
				})
	const autoLoadKey = `${normalizeAddress(selectedVaultOwner) ?? ''}:${normalizeAddress(securityVaultForm.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = currentSelectedVaultDetails !== undefined && sameAddress(currentSelectedVaultDetails.vaultAddress, selectedVaultOwner) && sameAddress(currentSelectedVaultDetails.securityPoolAddress, securityVaultForm.securityPoolAddress)
	const lastAutoLoadKey = useRef<string | undefined>(securityVaultError === undefined ? undefined : autoLoadKey)
	useEffect(() => {
		if (securityVaultForm.securityPoolAddress.trim() === '') return
		if (selectedVaultOwner === undefined || selectedVaultOwner === '') return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastAutoLoadKey.current === autoLoadKey) return
		lastAutoLoadKey.current = autoLoadKey
		void onLoadSecurityVault()
	}, [autoLoadKey, hasLoadedCurrentVault, loadingSecurityVault, onLoadSecurityVault, securityVaultForm.securityPoolAddress, selectedVaultOwner])

	const summarySection =
		currentSelectedVaultDetails !== undefined && doesSecurityVaultExistOnchain(currentSelectedVaultDetails) ? (
			<SelectedVaultSummarySection
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				currentVaultIsHealthy={currentVaultIsHealthy}
				poolEnded={poolState?.lifecycleState === 'ended'}
				selectedPoolStatoblastSecurityMultiplierBps={selectedPoolStatoblastSecurityMultiplierBps}
				selectedVaultIsOwnedByAccount={isSelectedVaultOwnedByAccount(selectedVaultOwner, accountState.address)}
				underwritingLimitAttoEth={currentSelectedVaultDetails.underwritingLimitAttoEth}
				securityVaultDetails={currentSelectedVaultDetails}
			/>
		) : undefined
	const vaultActions = <VaultAdditionalActions error={securityVaultError} additionalActions={extraReadinessActions} />
	if (summarySection !== undefined && extraReadinessActions.length > 0)
		return (
			<div className='vault-detail-layout'>
				{summarySection}
				<div className='vault-detail-actions'>{vaultActions}</div>
			</div>
		)
	return (
		<>
			{summarySection}
			{vaultActions}
		</>
	)
}
