import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useErc20AllowanceLoader, useErc20BalanceLoader } from './useErc20Loader.js'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadErc20Balance, loadSecurityVaultDetails, queueOracleManagerOperation, redeemSecurityVaultFees, updateSecurityVaultFees } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { sameAddress } from '../lib/address.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { getDefaultSecurityVaultFormState, parseRepAmountInput } from '../lib/marketForm.js'
import { requireDefined } from '../lib/required.js'
import { getSelectedVaultAddress } from '../lib/securityVault.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { SecurityVaultFormState, WriteOperationsParameters } from '../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../types/contracts.js'

type UseSecurityVaultOperationsParameters = WriteOperationsParameters

export function useSecurityVaultOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityVaultOperationsParameters) {
	const securityVaultLoad = useLoadController()
	const securityVaultDetails = useSignal<SecurityVaultDetails | undefined>(undefined)
	const securityVaultMissing = useSignal(false)
	const securityVaultError = useSignal<string | undefined>(undefined)
	const { state: securityVaultForm, setState: updateSecurityVaultForm } = useFormState<SecurityVaultFormState>(getDefaultSecurityVaultFormState())
	const repBalanceLoader = useErc20BalanceLoader()
	const repAllowanceLoader = useErc20AllowanceLoader()
	const securityVaultResult = useSignal<SecurityVaultActionResult | undefined>(undefined)

	const resolveSelectedVaultAddress = () => {
		const selectedVaultAddress = requireDefined(getSelectedVaultAddress(securityVaultForm.value.selectedVaultAddress, accountAddress), 'Connect a wallet before loading a security vault')
		return parseAddressInput(selectedVaultAddress, 'Selected vault address')
	}

	useEffect(() => {
		if (accountAddress === undefined) return
		if (securityVaultForm.value.selectedVaultAddress.trim() !== '') return
		securityVaultForm.value = {
			...securityVaultForm.value,
			selectedVaultAddress: accountAddress.toString(),
		}
	}, [accountAddress])

	const reloadSecurityVaultRepBalance = async (repToken: Address, vaultAddress: Address) => repBalanceLoader.reload(repToken, vaultAddress)

	const reloadSecurityVaultRepAllowance = async (repToken: Address, vaultAddress: Address, securityPoolAddress: Address) => repAllowanceLoader.reload(repToken, vaultAddress, securityPoolAddress)

	const reloadSecurityVaultDetails = async (securityPoolAddress: Address, vaultAddress: Address) => {
		const details = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
		securityVaultDetails.value = details
		securityVaultMissing.value = details === undefined
		return details
	}

	const refreshVaultFees = async (vaultAddress: Address, securityPoolAddress: Address) => {
		await updateSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, vaultAddress)
	}

	const loadExistingSecurityVaultDetails = async (securityPoolAddress: Address, vaultAddress: Address, missingPoolMessage: string) => {
		const details = securityVaultDetails.value ?? (await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress))
		if (details !== undefined) return details

		securityVaultDetails.value = undefined
		securityVaultMissing.value = true
		repBalanceLoader.signal.value = undefined
		repAllowanceLoader.signal.value = undefined
		securityVaultError.value = missingPoolMessage
		return undefined
	}

	const loadSecurityVault = async (vaultAddressInput?: string) => {
		await securityVaultLoad.run({
			onStart: () => {
				securityVaultError.value = undefined
				securityVaultMissing.value = false
			},
			load: async () => {
				const securityPoolAddress = parseAddressInput(securityVaultForm.value.securityPoolAddress, 'Security pool address')
				const vaultAddress = vaultAddressInput?.trim() === '' || vaultAddressInput === undefined ? resolveSelectedVaultAddress() : parseAddressInput(vaultAddressInput, 'Selected vault address')
				if (vaultAddressInput !== undefined) {
					securityVaultForm.value = {
						...securityVaultForm.value,
						selectedVaultAddress: vaultAddress.toString(),
					}
				}
				const details = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
				securityVaultDetails.value = details
				securityVaultMissing.value = details === undefined
				if (details === undefined) {
					repBalanceLoader.signal.value = undefined
					repAllowanceLoader.signal.value = undefined
					return undefined
				}
				if (sameAddress(vaultAddress, accountAddress)) {
					await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
					await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
				} else {
					repBalanceLoader.signal.value = undefined
					repAllowanceLoader.signal.value = undefined
				}
				return details
			},
			onSuccess: () => undefined,
			onError: error => {
				securityVaultDetails.value = undefined
				securityVaultMissing.value = false
				repBalanceLoader.signal.value = undefined
				repAllowanceLoader.signal.value = undefined
				securityVaultError.value = getErrorMessage(error, 'Failed to load security vault')
			},
		})
	}

	const runVaultAction = async (action: (ethereumAddress: Address, securityPoolAddress: Address) => Promise<SecurityVaultActionResult | undefined>, errorFallback: string, onSuccess?: (result: SecurityVaultActionResult, securityPoolAddress: Address, walletAddress: Address) => Promise<void> | void) => {
		let securityPoolAddress: Address | undefined
		await runWriteAction(
			buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, securityVaultError, 'Connect a wallet before operating a security vault'),
			async walletAddress => {
				const currentForm = securityVaultForm.value
				securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				if (securityVaultMissing.value) {
					securityVaultError.value = 'Security pool does not exist'
					return undefined
				}
				const selectedVaultAddress = resolveSelectedVaultAddress()
				if (!sameAddress(selectedVaultAddress, walletAddress)) {
					throw new Error('Selected vault is read-only')
				}
				securityVaultError.value = undefined
				securityVaultResult.value = undefined
				return await action(selectedVaultAddress, securityPoolAddress)
			},
			errorFallback,
			async (result, walletAddress) => {
				const resolvedSecurityPoolAddress = requireDefined(securityPoolAddress, 'Security pool address is required')
				securityVaultResult.value = result
				await onSuccess?.(result, resolvedSecurityPoolAddress, walletAddress)
			},
		)
	}

	const approveRep = async (amount?: bigint) =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist')
				if (details === undefined) return undefined
				const approvalAmount = amount ?? parseRepAmountInput(securityVaultForm.value.depositAmount, 'REP deposit amount')
				return await approveErc20(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), details.repToken, securityPoolAddress, approvalAmount, 'approveRep')
			},
			'Failed to approve REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
				const details = securityVaultDetails.value
				if (details === undefined) return
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			},
		)

	const depositRep = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const depositAmount = parseRepAmountInput(securityVaultForm.value.depositAmount, 'REP deposit amount')
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist')
				if (details === undefined) return undefined
				const currentRepBalance = await loadErc20Balance(createConnectedReadClient(), details.repToken, vaultAddress)
				repBalanceLoader.signal.value = currentRepBalance
				if (currentRepBalance < depositAmount) {
					throw new Error(`Insufficient REP balance. Wallet balance is ${formatCurrencyBalance(currentRepBalance)} REP but the deposit amount is ${formatCurrencyBalance(depositAmount)} REP.`)
				}
				return await depositRepToSecurityPool(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, depositAmount)
			},
			'Failed to deposit REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
				const details = securityVaultDetails.value
				if (details === undefined) return
				await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			},
		)

	const setSecurityBondAllowance = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const amount = parseRepAmountInput(securityVaultForm.value.securityBondAllowanceAmount, 'Security bond allowance')
				if (amount <= 0n) throw new Error('Security bond allowance must be greater than zero')
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist')
				if (details === undefined) return undefined
				const result = await queueOracleManagerOperation(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), details.managerAddress, 'setSecurityBondsAllowance', vaultAddress, amount)
				return {
					action: 'queueSetSecurityBondAllowance',
					hash: result.hash,
				} satisfies SecurityVaultActionResult
			},
			'Failed to set security bond allowance',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	const redeemFees = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				await refreshVaultFees(vaultAddress, securityPoolAddress)
				return await redeemSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, vaultAddress)
			},
			'Failed to redeem fees',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	const withdrawRep = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const amount = parseRepAmountInput(securityVaultForm.value.repWithdrawAmount, 'REP withdraw amount')
				if (amount <= 0n) throw new Error('REP withdraw amount must be greater than zero')

				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist')
				if (details === undefined) return undefined
				const result = await queueOracleManagerOperation(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), details.managerAddress, 'withdrawRep', vaultAddress, amount)
				return {
					action: 'queueWithdrawRep',
					hash: result.hash,
				} satisfies SecurityVaultActionResult
			},
			'Failed to withdraw REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
			},
		)

	useEffect(() => {
		const selectedVaultAddress = securityVaultForm.value.selectedVaultAddress.trim()
		if (accountAddress === undefined || securityVaultDetails.value === undefined || selectedVaultAddress === '') {
			repBalanceLoader.signal.value = undefined
			repAllowanceLoader.signal.value = undefined
			return
		}

		if (!sameAddress(securityVaultDetails.value.vaultAddress, selectedVaultAddress) || !sameAddress(selectedVaultAddress, accountAddress)) {
			repBalanceLoader.signal.value = undefined
			repAllowanceLoader.signal.value = undefined
			return
		}

		void reloadSecurityVaultRepBalance(securityVaultDetails.value.repToken, accountAddress).catch(() => undefined)
		void reloadSecurityVaultRepAllowance(securityVaultDetails.value.repToken, accountAddress, securityVaultDetails.value.securityPoolAddress).catch(() => undefined)
	}, [accountAddress, securityVaultDetails.value?.repToken, securityVaultDetails.value?.securityPoolAddress, securityVaultForm.value.selectedVaultAddress])

	return {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault: securityVaultLoad.isLoading.value,
		redeemFees,
		setSecurityBondAllowance,
		withdrawRep,
		securityVaultRepAllowance: repAllowanceLoader.signal.value,
		securityVaultDetails: securityVaultDetails.value,
		securityVaultError: securityVaultError.value,
		securityVaultForm: securityVaultForm.value,
		securityVaultMissing: securityVaultMissing.value,
		securityVaultRepBalance: repBalanceLoader.signal.value,
		securityVaultResult: securityVaultResult.value,
		setSecurityVaultForm: (updater: (current: SecurityVaultFormState) => SecurityVaultFormState) => {
			updateSecurityVaultForm(updater)
		},
	}
}
