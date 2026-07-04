import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'

export type SelectedVaultView = 'browse-vaults' | 'selected-vault'

type UseSelectedVaultWorkflowStateParams = {
	accountAddress: Address | undefined
	hasLoadedCurrentVault: boolean
	initialVaultView: SelectedVaultView | undefined
	loadingSecurityVault: boolean
	onLoadSecurityVault: () => Promise<void> | void
	onSecurityVaultFormChange: (partialForm: { selectedVaultAddress: string }) => void
	selectedPoolAddress: string | undefined
	selectedVaultAddress: string
	selectedVaultAddressInput: string | undefined
	selectedVaultSecurityPoolAddress: string
	showSelectedPoolWorkflowDetails: boolean
	view: string
}

export function useSelectedVaultWorkflowState({
	accountAddress,
	hasLoadedCurrentVault,
	initialVaultView,
	loadingSecurityVault,
	onLoadSecurityVault,
	onSecurityVaultFormChange,
	selectedPoolAddress,
	selectedVaultAddress,
	selectedVaultAddressInput,
	selectedVaultSecurityPoolAddress,
	showSelectedPoolWorkflowDetails,
	view,
}: UseSelectedVaultWorkflowStateParams) {
	const [vaultView, setVaultView] = useState<SelectedVaultView>(initialVaultView ?? 'browse-vaults')
	const lastSelectedVaultAutoLoadKey = useRef<string | undefined>(undefined)
	const selectedPoolVaultDefaultKey = `${normalizeAddress(selectedPoolAddress) ?? ''}:${normalizeAddress(accountAddress) ?? ''}`
	const selectedVaultAutoLoadKey = `${normalizeAddress(selectedVaultAddress) ?? ''}:${normalizeAddress(selectedPoolAddress) ?? ''}`

	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPoolAddress)
		if (normalizedSelectedPoolAddress === undefined) return
		setVaultView('selected-vault')
		if (accountAddress === undefined) return
		if (isSelectedVaultOwnedByAccountHelper(selectedVaultAddressInput, accountAddress)) return
		onSecurityVaultFormChange({ selectedVaultAddress: accountAddress.toString() })
	}, [accountAddress, onSecurityVaultFormChange, selectedPoolAddress, selectedVaultAddressInput, selectedPoolVaultDefaultKey])

	useEffect(() => {
		if (!showSelectedPoolWorkflowDetails || view !== 'vaults') return
		if (accountAddress === undefined) return
		if (selectedPoolAddress === undefined || selectedVaultAddress === '') return
		if (!sameAddress(selectedVaultSecurityPoolAddress, selectedPoolAddress)) return
		if (hasLoadedCurrentVault || loadingSecurityVault) return
		if (lastSelectedVaultAutoLoadKey.current === selectedVaultAutoLoadKey) return
		lastSelectedVaultAutoLoadKey.current = selectedVaultAutoLoadKey
		void onLoadSecurityVault()
	}, [accountAddress, hasLoadedCurrentVault, loadingSecurityVault, onLoadSecurityVault, selectedPoolAddress, selectedVaultAddress, selectedVaultAutoLoadKey, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view])

	return {
		setVaultView,
		vaultView,
	}
}
