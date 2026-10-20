import { useSignal, type ReadonlySignal } from '@preact/signals'
import { useEffect, useRef, type MutableRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import { useLiquidationVaultSummary } from './useLiquidationVaultSummary.js'

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
	const summary = useLiquidationVaultSummary({
		copy: { invalidAddress: liquidationCopy.receiverVaultAddressInvalid, loadFailed: liquidationCopy.receiverVaultLoadFailed, vaultLabel: liquidationCopy.receiverVault },
		latestEnvironmentRefreshKey,
		liquidationSecurityPoolAddress,
		loadSecurityPoolVaultSummary,
		vaultAddress: receiverVault,
		waitForSecurityPoolReadBackend,
	})

	const changeReceiverVault = (value: string) => {
		summary.reset()
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

	return {
		changeReceiverVault,
		loadReceiverVaultSummary: summary.load,
		loading: summary.loading,
		receiverVault,
		resetSummary: summary.reset,
		resolved: summary.resolved,
		summary: summary.summary,
		summaryError: summary.summaryError,
	}
}
