import { defaultUseSecurityVaultOperationsDependencies } from './securityVaultOperationDependencies.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getDefaultSecurityVaultFormState } from '../../markets/lib/marketForm.js'
import { requireDefined } from '@zoltar/ui-core-shared/forms/required.js'
import { getSelectedVaultOwner } from '../lib/securityVault.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { SecurityVaultFormState } from '../../../types/app.js'
import type { SecurityVaultDetails } from '../../../types/contracts.js'

type UseSecurityVaultOperationsParameters = {
	accountAddress: Address | undefined
	enabled: boolean
	selectedSecurityPoolAddress?: string
}

export type UseSecurityVaultOperationsDependencies = {
	loadSecurityVaultDetails: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultDetails | undefined>
}

/** Selects and loads one vault of the selected pool; vault transactions go through the vault operations panel. */
function useSecurityVaultOperationsWithDependencies({ accountAddress, enabled, selectedSecurityPoolAddress }: UseSecurityVaultOperationsParameters, dependencies: UseSecurityVaultOperationsDependencies) {
	const securityVaultLoad = useLoadController()
	const securityVaultDetails = useSignal<SecurityVaultDetails | undefined>(undefined)
	const securityVaultMissing = useSignal(false)
	const securityVaultError = useSignal<string | undefined>(undefined)
	const { state: securityVaultForm, setState: updateSecurityVaultForm } = useFormState<SecurityVaultFormState>(getDefaultSecurityVaultFormState())
	const nextSecurityVaultLoad = useRequestGuard()
	const lastEffectiveVaultSelectionKey = useRef<string | undefined>(undefined)
	// The selection the latest load asked for, so a selection that becomes readable again can be reloaded.
	const lastRequestedVaultSelectionKey = useRef<string | undefined>(undefined)
	const effectiveSelectedVaultOwner = getSelectedVaultOwner(securityVaultForm.value.selectedVaultOwner, accountAddress)
	const effectiveSecurityPoolAddressInput = selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? securityVaultForm.value.securityPoolAddress : selectedSecurityPoolAddress
	const effectiveVaultSelectionKey = `${normalizeAddress(effectiveSecurityPoolAddressInput) ?? ''}:${normalizeAddress(effectiveSelectedVaultOwner) ?? ''}`

	const resolveSelectedVaultOwner = () => {
		const selectedVaultOwner = requireDefined(getSelectedVaultOwner(securityVaultForm.value.selectedVaultOwner, accountAddress), 'Enter a vault owner address or connect a wallet before selecting a security vault')
		return parseAddressInput(selectedVaultOwner, 'Selected vault owner address')
	}
	const resolveSecurityVaultPoolAddress = () => parseAddressInput(effectiveSecurityPoolAddressInput, 'Security pool address')

	useEffect(() => {
		if (!enabled) {
			lastEffectiveVaultSelectionKey.current = undefined
			return
		}
		if (lastEffectiveVaultSelectionKey.current === effectiveVaultSelectionKey) return
		void nextSecurityVaultLoad()
		securityVaultDetails.value = undefined
		securityVaultMissing.value = false
		securityVaultError.value = undefined
		lastEffectiveVaultSelectionKey.current = effectiveVaultSelectionKey
		// Reads pause briefly (for example while a confirmed transaction is revalidated), which cancels any load in flight.
		// When the same vault becomes readable again, nothing else reloads it, so reload it here.
		if (lastRequestedVaultSelectionKey.current === effectiveVaultSelectionKey) void loadSecurityVault()
	}, [effectiveVaultSelectionKey, enabled])

	// The owner follows the wallet while it is empty or still names the previously connected wallet; a typed-in owner stays.
	const lastConnectedAccountAddress = useRef<Address | undefined>(undefined)
	useEffect(() => {
		if (accountAddress === undefined) return
		const previousAccountAddress = lastConnectedAccountAddress.current
		lastConnectedAccountAddress.current = accountAddress
		const selectedVaultOwner = securityVaultForm.value.selectedVaultOwner.trim()
		const followsWallet = selectedVaultOwner === '' || (previousAccountAddress !== undefined && sameAddress(selectedVaultOwner, previousAccountAddress))
		if (!followsWallet || sameAddress(selectedVaultOwner, accountAddress)) return
		securityVaultForm.value = {
			...securityVaultForm.value,
			selectedVaultOwner: accountAddress.toString(),
		}
	}, [accountAddress])

	const loadSecurityVault = async (vaultAddressInput?: string) => {
		const isCurrent = nextSecurityVaultLoad()
		await securityVaultLoad.run({
			onStart: () => {
				securityVaultError.value = undefined
				securityVaultMissing.value = false
			},
			load: async () => {
				const securityPoolAddress = resolveSecurityVaultPoolAddress()
				const vaultAddress = vaultAddressInput?.trim() === '' || vaultAddressInput === undefined ? resolveSelectedVaultOwner() : parseAddressInput(vaultAddressInput, 'Selected vault owner address')
				lastRequestedVaultSelectionKey.current = `${normalizeAddress(securityPoolAddress) ?? ''}:${normalizeAddress(vaultAddress) ?? ''}`
				if (vaultAddressInput !== undefined)
					securityVaultForm.value = {
						...securityVaultForm.value,
						selectedVaultOwner: vaultAddress.toString(),
					}
				const details = await dependencies.loadSecurityVaultDetails(securityPoolAddress, vaultAddress)
				if (!isCurrent()) return undefined
				securityVaultDetails.value = details
				securityVaultMissing.value = details === undefined
				return details
			},
			onSuccess: () => undefined,
			onError: (error: unknown) => {
				if (!isCurrent()) return
				securityVaultDetails.value = undefined
				securityVaultMissing.value = false
				securityVaultError.value = getErrorMessage(error, 'Failed to load the vault.')
			},
		})
	}

	return {
		loadSecurityVault,
		loadingSecurityVault: securityVaultLoad.isLoading.value,
		securityVaultDetails: securityVaultDetails.value,
		securityVaultError: securityVaultError.value,
		securityVaultForm: securityVaultForm.value,
		securityVaultMissing: lastEffectiveVaultSelectionKey.current === effectiveVaultSelectionKey && securityVaultMissing.value,
		setSecurityVaultForm: (updater: (current: SecurityVaultFormState) => SecurityVaultFormState) => {
			updateSecurityVaultForm(updater)
		},
	}
}

export function useSecurityVaultOperations(parameters: UseSecurityVaultOperationsParameters, dependencies: UseSecurityVaultOperationsDependencies = defaultUseSecurityVaultOperationsDependencies) {
	return useSecurityVaultOperationsWithDependencies(parameters, dependencies)
}
