import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadSecurityVaultDetails, redeemSecurityVaultFees, redeemSecurityVaultRep, updateSecurityVaultFees } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultSecurityVaultFormState } from '../lib/marketForm.js'
import { runWriteAction } from '../lib/writeAction.js'
import type { SecurityVaultFormState } from '../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../types/contracts.js'

type UseSecurityVaultOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityVaultOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityVaultOperationsParameters) {
	const loadingSecurityVault = useSignal(false)
	const securityVaultDetails = useSignal<SecurityVaultDetails | undefined>(undefined)
	const securityVaultError = useSignal<string | undefined>(undefined)
	const securityVaultForm = useSignal<SecurityVaultFormState>(getDefaultSecurityVaultFormState())
	const securityVaultResult = useSignal<SecurityVaultActionResult | undefined>(undefined)
	const reloadSecurityVaultDetails = async (securityPoolAddress: Address, vaultAddress: Address) => {
		securityVaultDetails.value = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
	}

	const loadSecurityVault = async () => {
		if (accountAddress === undefined) {
			securityVaultError.value = 'Connect a wallet before loading a security vault'
			return
		}

		loadingSecurityVault.value = true
		securityVaultError.value = undefined
		try {
			const securityPoolAddress = parseAddressInput(securityVaultForm.value.securityPoolAddress, 'Security pool address')
			const details = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, accountAddress)
			securityVaultDetails.value = details
		} catch (error) {
			securityVaultDetails.value = undefined
			securityVaultError.value = getErrorMessage(error, 'Failed to load security vault')
		} finally {
			loadingSecurityVault.value = false
		}
	}

	const runVaultAction = async (action: (ethereumAddress: Address, securityPoolAddress: Address) => Promise<SecurityVaultActionResult>, errorFallback: string, onSuccess?: (result: SecurityVaultActionResult, securityPoolAddress: Address, walletAddress: Address) => Promise<void> | void) => {
		let securityPoolAddress: Address | undefined
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before operating a security vault',
				onTransaction,
				onTransactionFinished,
				onTransactionRequested,
				refreshState,
				setErrorMessage: message => {
					securityVaultError.value = message
				},
			},
			async walletAddress => {
				const currentForm = securityVaultForm.value
				securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				securityVaultError.value = undefined
				securityVaultResult.value = undefined
				return await action(walletAddress, securityPoolAddress)
			},
			errorFallback,
			async (result, walletAddress) => {
				if (securityPoolAddress === undefined) throw new Error('Security pool address is required')
				securityVaultResult.value = result
				await onSuccess?.(result, securityPoolAddress, walletAddress)
			},
		)
	}

	const approveRep = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const details = securityVaultDetails.value ?? (await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress))
				return await approveErc20(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), details.repToken, securityPoolAddress, parseBigIntInput(securityVaultForm.value.repApprovalAmount, 'REP approval amount'), 'approveRep')
			},
			'Failed to approve REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	const depositRep = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => await depositRepToSecurityPool(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, parseBigIntInput(securityVaultForm.value.depositAmount, 'REP deposit amount')),
			'Failed to deposit REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	const updateVaultFees = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => await updateSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, vaultAddress),
			'Failed to update vault fees',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	const redeemFees = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => await redeemSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, vaultAddress),
			'Failed to redeem fees',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	const redeemRep = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => await redeemSecurityVaultRep(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, vaultAddress),
			'Failed to redeem REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	return {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault: loadingSecurityVault.value,
		redeemFees,
		redeemRep,
		securityVaultDetails: securityVaultDetails.value,
		securityVaultError: securityVaultError.value,
		securityVaultForm: securityVaultForm.value,
		securityVaultResult: securityVaultResult.value,
		setSecurityVaultForm: (updater: (current: SecurityVaultFormState) => SecurityVaultFormState) => {
			securityVaultForm.value = updater(securityVaultForm.value)
		},
		updateVaultFees,
	}
}
