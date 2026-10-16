import { useSignal, type ReadonlySignal } from '@preact/signals'
import type { MutableRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseAddressInput, tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'
import * as liquidationCopy from '../../../copy/liquidation.js'

type UseLiquidationVaultSummaryParameters = {
	copy: { invalidAddress: string; loadFailed: string; vaultLabel: string }
	latestEnvironmentRefreshKey: MutableRef<number>
	liquidationSecurityPoolAddress: ReadonlySignal<Address | undefined>
	loadSecurityPoolVaultSummary: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityPoolVaultSummary>
	vaultAddress: ReadonlySignal<string>
	waitForSecurityPoolReadBackend: () => Promise<void>
}

/** One liquidation party's vault-summary read, keyed by environment, pool, and vault so a superseded read never lands. */
export function useLiquidationVaultSummary({ copy, latestEnvironmentRefreshKey, liquidationSecurityPoolAddress, loadSecurityPoolVaultSummary, vaultAddress, waitForSecurityPoolReadBackend }: UseLiquidationVaultSummaryParameters) {
	const summary = useSignal<SecurityPoolVaultSummary | undefined>(undefined)
	const summaryError = useSignal<string | undefined>(undefined)
	const summaryResolvedKey = useSignal<string | undefined>(undefined)
	const summaryLoadingKey = useSignal<string | undefined>(undefined)
	const summaryLoad = useLoadController()
	const nextSummaryLoad = useRequestGuard()

	const getCurrentRequestKey = () => {
		const securityPoolAddress = liquidationSecurityPoolAddress.value
		if (securityPoolAddress === undefined) return undefined
		const vault = tryParseAddressInput(vaultAddress.value)
		if (vault === undefined) return undefined
		return `${latestEnvironmentRefreshKey.current}:${securityPoolAddress.toLowerCase()}:${vault.toLowerCase()}`
	}

	/** Cancels any in-flight summary read and clears the loaded summary state. */
	const reset = () => {
		nextSummaryLoad()
		summary.value = undefined
		summaryError.value = undefined
		summaryResolvedKey.value = undefined
		summaryLoadingKey.value = undefined
	}

	const load = async () => {
		const securityPoolAddress = liquidationSecurityPoolAddress.value
		if (securityPoolAddress === undefined) {
			summaryError.value = liquidationCopy.selectedPoolDetailsLoading
			return false
		}
		let vault: Address
		try {
			vault = parseAddressInput(vaultAddress.value, copy.vaultLabel)
		} catch (error) {
			summary.value = undefined
			summaryError.value = getErrorMessage(error, copy.invalidAddress)
			return false
		}
		const requestKey = `${latestEnvironmentRefreshKey.current}:${securityPoolAddress.toLowerCase()}:${vault.toLowerCase()}`
		const isCurrent = nextSummaryLoad()
		const result = await summaryLoad.run({
			isCurrent,
			onStart: () => {
				summary.value = undefined
				summaryError.value = undefined
				summaryResolvedKey.value = undefined
				summaryLoadingKey.value = requestKey
			},
			waitUntilReady: waitForSecurityPoolReadBackend,
			load: async () => await loadSecurityPoolVaultSummary(securityPoolAddress, vault),
			onSuccess: loadedSummary => {
				if (getCurrentRequestKey() !== requestKey) return
				summary.value = loadedSummary
				summaryResolvedKey.value = requestKey
			},
			onError: error => {
				if (getCurrentRequestKey() !== requestKey) return
				summaryError.value = getErrorMessage(error, copy.loadFailed)
			},
		})
		if (summaryLoadingKey.value === requestKey) summaryLoadingKey.value = undefined
		return result !== undefined && getCurrentRequestKey() === requestKey
	}

	const currentRequestKey = getCurrentRequestKey()
	const resolved = currentRequestKey !== undefined && summaryResolvedKey.value === currentRequestKey
	return {
		load,
		loading: currentRequestKey !== undefined && summaryLoadingKey.value === currentRequestKey && summaryLoad.isLoading.value,
		reset,
		resolved,
		summary: resolved ? summary.value : undefined,
		summaryError: summaryError.value,
	}
}
