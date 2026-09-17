import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'

export type SelectedVaultView = 'browse-vaults' | 'selected-vault' | 'vault-by-address'

type UseSelectedVaultWorkflowStateParams = {
	accountAddress: Address | undefined
	hasLoadedCurrentVault: boolean
	selectedVaultExistsOnchain: boolean
	initialVaultView: SelectedVaultView | undefined
	loadingSecurityVault: boolean
	onLoadSecurityVault: () => Promise<void> | void
	onSecurityVaultFormChange: (partialForm: { selectedVaultOwner: string }) => void
	selectedPoolAddress: string | undefined
	selectedVaultOwner: string
	selectedVaultOwnerInput: string | undefined
	selectedVaultSecurityPoolAddress: string
	showSelectedPoolWorkflowDetails: boolean
	view: string
}

export function useSelectedVaultWorkflowState({
	accountAddress,
	hasLoadedCurrentVault,
	selectedVaultExistsOnchain,
	initialVaultView,
	loadingSecurityVault,
	onLoadSecurityVault,
	onSecurityVaultFormChange,
	selectedPoolAddress,
	selectedVaultOwner,
	selectedVaultOwnerInput,
	selectedVaultSecurityPoolAddress,
	showSelectedPoolWorkflowDetails,
	view,
}: UseSelectedVaultWorkflowStateParams) {
	const [vaultView, updateVaultView] = useState<SelectedVaultView>(initialVaultView ?? 'browse-vaults')
	const appliedDefaultKey = useRef<string | undefined>(undefined)
	const userSelectedView = useRef(false)
	const defaultResolved = useRef(false)
	const lastSelectedVaultAutoLoadKey = useRef<string | undefined>(undefined)
	const selectedPoolVaultDefaultKey = `${normalizeAddress(selectedPoolAddress) ?? ''}:${normalizeAddress(accountAddress) ?? ''}`
	const selectedVaultAutoLoadKey = `${normalizeAddress(selectedVaultOwner) ?? ''}:${normalizeAddress(selectedPoolAddress) ?? ''}`

	const setVaultView = (nextView: SelectedVaultView) => {
		userSelectedView.current = true
		updateVaultView(nextView)
	}
	useEffect(() => {
		if (selectedPoolAddress === undefined) return
		if (appliedDefaultKey.current !== selectedPoolVaultDefaultKey) {
			const hadPreviousScope = appliedDefaultKey.current !== undefined
			appliedDefaultKey.current = selectedPoolVaultDefaultKey
			userSelectedView.current = initialVaultView !== undefined
			defaultResolved.current = false
			updateVaultView(initialVaultView ?? (accountAddress === undefined ? 'browse-vaults' : 'selected-vault'))
			if (accountAddress !== undefined && (hadPreviousScope || selectedVaultOwnerInput === undefined || selectedVaultOwnerInput === '') && !sameAddress(selectedVaultOwnerInput, accountAddress)) {
				onSecurityVaultFormChange({ selectedVaultOwner: accountAddress })
				return
			}
		}
		if (vaultView === 'selected-vault' && selectedVaultOwnerInput !== undefined && selectedVaultOwnerInput !== '' && !sameAddress(selectedVaultOwnerInput, accountAddress)) {
			updateVaultView('vault-by-address')
			return
		}
		if (userSelectedView.current || defaultResolved.current) return
		if (!hasLoadedCurrentVault) return
		defaultResolved.current = true
		updateVaultView(accountAddress !== undefined && isSelectedVaultOwnedByAccountHelper(selectedVaultOwnerInput, accountAddress) && selectedVaultExistsOnchain ? 'selected-vault' : 'browse-vaults')
	}, [accountAddress, hasLoadedCurrentVault, initialVaultView, onSecurityVaultFormChange, selectedPoolAddress, selectedVaultExistsOnchain, selectedVaultOwnerInput, selectedPoolVaultDefaultKey, vaultView])

	useEffect(() => {
		if (!showSelectedPoolWorkflowDetails || view !== 'vaults') return
		if (accountAddress === undefined) return
		if (selectedPoolAddress === undefined || selectedVaultOwner === '') return
		if (!sameAddress(selectedVaultSecurityPoolAddress, selectedPoolAddress)) return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastSelectedVaultAutoLoadKey.current === selectedVaultAutoLoadKey) return
		lastSelectedVaultAutoLoadKey.current = selectedVaultAutoLoadKey
		void onLoadSecurityVault()
	}, [accountAddress, hasLoadedCurrentVault, loadingSecurityVault, onLoadSecurityVault, selectedPoolAddress, selectedVaultOwner, selectedVaultAutoLoadKey, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view])

	return {
		setVaultView,
		vaultView,
	}
}
