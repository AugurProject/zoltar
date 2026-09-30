import { useSignal, type ReadonlySignal } from '@preact/signals'
import { useEffect, useRef, type MutableRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseAddressInput, tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'

type UseLiquidationReceiverVaultParameters = {
	accountAddress: Address | undefined
	latestEnvironmentRefreshKey: MutableRef<number>
	liquidationSecurityPoolAddress: ReadonlySignal<Address | undefined>
	loadSecurityPoolVaultSummary: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityPoolVaultSummary>
	waitForSecurityPoolReadBackend: () => Promise<void>
}

/** Liquidation receiver vault input, its vault-summary read, and the wallet-follow default. */
export function useLiquidationReceiverVault({ accountAddress, latestEnvironmentRefreshKey, liquidationSecurityPoolAddress, loadSecurityPoolVaultSummary, waitForSecurityPoolReadBackend }: UseLiquidationReceiverVaultParameters) {
	const receiverVault = useSignal('')
	const summary = useSignal<SecurityPoolVaultSummary | undefined>(undefined)
	const summaryError = useSignal<string | undefined>(undefined)
	const summaryResolvedKey = useSignal<string | undefined>(undefined)
	const summaryLoadingKey = useSignal<string | undefined>(undefined)
	const summaryLoad = useLoadController()
	const nextSummaryLoad = useRequestGuard()

	const getCurrentRequestKey = () => {
		const securityPoolAddress = liquidationSecurityPoolAddress.value
		if (securityPoolAddress === undefined) return undefined
		const receiver = tryParseAddressInput(receiverVault.value)
		if (receiver === undefined) return undefined
		return `${latestEnvironmentRefreshKey.current}:${securityPoolAddress.toLowerCase()}:${receiver.toLowerCase()}`
	}

	/** Cancels any in-flight summary read and clears the loaded summary state. */
	const resetSummary = () => {
		nextSummaryLoad()
		summary.value = undefined
		summaryError.value = undefined
		summaryResolvedKey.value = undefined
		summaryLoadingKey.value = undefined
	}

	const loadReceiverVaultSummary = async () => {
		const securityPoolAddress = liquidationSecurityPoolAddress.value
		if (securityPoolAddress === undefined) {
			summaryError.value = 'Selected pool details are still loading.'
			return false
		}
		let receiver: Address
		try {
			receiver = parseAddressInput(receiverVault.value, 'Receiver vault')
		} catch (error) {
			summary.value = undefined
			summaryError.value = getErrorMessage(error, 'Enter a valid receiver vault')
			return false
		}
		const requestKey = `${latestEnvironmentRefreshKey.current}:${securityPoolAddress.toLowerCase()}:${receiver.toLowerCase()}`
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
			load: async () => await loadSecurityPoolVaultSummary(securityPoolAddress, receiver),
			onSuccess: loadedSummary => {
				if (getCurrentRequestKey() !== requestKey) return
				summary.value = loadedSummary
				summaryResolvedKey.value = requestKey
			},
			onError: error => {
				if (getCurrentRequestKey() !== requestKey) return
				summaryError.value = getErrorMessage(error, 'Failed to load receiver vault')
			},
		})
		if (summaryLoadingKey.value === requestKey) summaryLoadingKey.value = undefined
		return result !== undefined && getCurrentRequestKey() === requestKey
	}

	const changeReceiverVault = (value: string) => {
		resetSummary()
		receiverVault.value = value
	}

	// The receiver defaults to the connected wallet, so a wallet switch moves a receiver that still follows the previous wallet.
	const previousAccountAddress = useRef(accountAddress)
	useEffect(() => {
		const previous = previousAccountAddress.current
		previousAccountAddress.current = accountAddress
		if (previous?.toLowerCase() === accountAddress?.toLowerCase()) return
		const receiver = receiverVault.peek()
		const receiverFollowsWallet = previous === undefined ? receiver.trim() === '' : sameAddress(receiver, previous)
		if (receiverFollowsWallet) changeReceiverVault(accountAddress ?? '')
	}, [accountAddress])

	const currentRequestKey = getCurrentRequestKey()
	const resolved = currentRequestKey !== undefined && summaryResolvedKey.value === currentRequestKey
	return {
		changeReceiverVault,
		loadReceiverVaultSummary,
		loading: currentRequestKey !== undefined && summaryLoadingKey.value === currentRequestKey && summaryLoad.isLoading.value,
		receiverVault,
		resetSummary,
		resolved,
		summary: resolved ? summary.value : undefined,
		summaryError: summaryError.value,
	}
}
