import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useErc20AllowanceLoader, useErc20BalanceLoader } from './useErc20Loader.js'
import { useFormState } from './useFormState.js'
import type { Address } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadOracleManagerDetails, loadSecurityVaultDetails, queueOracleManagerOperation, redeemSecurityVaultFees, updateSecurityVaultFees } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultSecurityVaultFormState } from '../lib/marketForm.js'
import { getSelectedVaultAddress } from '../lib/securityVault.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import type { SecurityVaultFormState, WriteOperationsParameters } from '../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../types/contracts.js'

type UseSecurityVaultOperationsParameters = WriteOperationsParameters

export function useSecurityVaultOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityVaultOperationsParameters) {
	const loadingSecurityVault = useSignal(false)
	const securityVaultDetails = useSignal<SecurityVaultDetails | undefined>(undefined)
	const securityVaultError = useSignal<string | undefined>(undefined)
	const { state: securityVaultForm, setState: updateSecurityVaultForm } = useFormState<SecurityVaultFormState>(getDefaultSecurityVaultFormState())
	const repBalanceLoader = useErc20BalanceLoader()
	const repAllowanceLoader = useErc20AllowanceLoader()
	const securityVaultResult = useSignal<SecurityVaultActionResult | undefined>(undefined)

	const resolveSelectedVaultAddress = () => {
		const selectedVaultAddress = getSelectedVaultAddress(securityVaultForm.value.selectedVaultAddress, accountAddress)
		if (selectedVaultAddress === undefined) throw new Error('Connect a wallet before loading a security vault')
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
		securityVaultDetails.value = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
	}

	const refreshVaultFees = async (vaultAddress: Address, securityPoolAddress: Address) => {
		await updateSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, vaultAddress)
	}

	const loadSecurityVault = async (vaultAddressInput?: string) => {
		loadingSecurityVault.value = true
		securityVaultError.value = undefined
		try {
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
			if (accountAddress !== undefined && vaultAddress.toLowerCase() === accountAddress.toLowerCase()) {
				await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			} else {
				repBalanceLoader.signal.value = undefined
				repAllowanceLoader.signal.value = undefined
			}
		} catch (error) {
			securityVaultDetails.value = undefined
			repBalanceLoader.signal.value = undefined
			repAllowanceLoader.signal.value = undefined
			securityVaultError.value = getErrorMessage(error, 'Failed to load security vault')
		} finally {
			loadingSecurityVault.value = false
		}
	}

	const runVaultAction = async (action: (ethereumAddress: Address, securityPoolAddress: Address) => Promise<SecurityVaultActionResult>, errorFallback: string, onSuccess?: (result: SecurityVaultActionResult, securityPoolAddress: Address, walletAddress: Address) => Promise<void> | void) => {
		let securityPoolAddress: Address | undefined
		await runWriteAction(
			buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, securityVaultError, 'Connect a wallet before operating a security vault'),
			async walletAddress => {
				const currentForm = securityVaultForm.value
				securityPoolAddress = parseAddressInput(currentForm.securityPoolAddress, 'Security pool address')
				const selectedVaultAddress = resolveSelectedVaultAddress()
				if (selectedVaultAddress.toLowerCase() !== walletAddress.toLowerCase()) {
					throw new Error('Selected vault is read-only')
				}
				securityVaultError.value = undefined
				securityVaultResult.value = undefined
				return await action(selectedVaultAddress, securityPoolAddress)
			},
			errorFallback,
			async (result, walletAddress) => {
				if (securityPoolAddress === undefined) throw new Error('Security pool address is required')
				securityVaultResult.value = result
				await onSuccess?.(result, securityPoolAddress, walletAddress)
			},
		)
	}

	const approveRep = async (amount?: bigint) =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const details = securityVaultDetails.value ?? (await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress))
				const approvalAmount = amount ?? parseBigIntInput(securityVaultForm.value.depositAmount, 'REP deposit amount')
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
			async (vaultAddress, securityPoolAddress) => await depositRepToSecurityPool(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), securityPoolAddress, parseBigIntInput(securityVaultForm.value.depositAmount, 'REP deposit amount')),
			'Failed to deposit REP',
			async (_result, securityPoolAddress, vaultAddress) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress)
				const details = securityVaultDetails.value
				if (details === undefined) return
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			},
		)

	const setSecurityBondAllowance = async () =>
		await runVaultAction(
			async (vaultAddress, securityPoolAddress) => {
				const amount = parseBigIntInput(securityVaultForm.value.securityBondAllowanceAmount, 'Security bond allowance')
				if (amount <= 0n) throw new Error('Security bond allowance must be greater than zero')
				const details = securityVaultDetails.value ?? (await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress))
				const managerDetails = await loadOracleManagerDetails(createConnectedReadClient(), details.managerAddress)
				const result = await queueOracleManagerOperation(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), details.managerAddress, 'setSecurityBondsAllowance', vaultAddress, amount, managerDetails.requestPriceEthCost)
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
				const amount = parseBigIntInput(securityVaultForm.value.repWithdrawAmount, 'REP withdraw amount')
				if (amount <= 0n) throw new Error('REP withdraw amount must be greater than zero')

				const details = securityVaultDetails.value ?? (await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress))
				const managerDetails = await loadOracleManagerDetails(createConnectedReadClient(), details.managerAddress)
				const result = await queueOracleManagerOperation(createWalletWriteClient(vaultAddress, { onTransactionSubmitted }), details.managerAddress, 'withdrawRep', vaultAddress, amount, managerDetails.requestPriceEthCost)
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

		if (securityVaultDetails.value.vaultAddress.toLowerCase() !== selectedVaultAddress.toLowerCase() || selectedVaultAddress.toLowerCase() !== accountAddress.toLowerCase()) {
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
		loadingSecurityVault: loadingSecurityVault.value,
		redeemFees,
		setSecurityBondAllowance,
		withdrawRep,
		securityVaultRepAllowance: repAllowanceLoader.signal.value,
		securityVaultDetails: securityVaultDetails.value,
		securityVaultError: securityVaultError.value,
		securityVaultForm: securityVaultForm.value,
		securityVaultRepBalance: repBalanceLoader.signal.value,
		securityVaultResult: securityVaultResult.value,
		setSecurityVaultForm: (updater: (current: SecurityVaultFormState) => SecurityVaultFormState) => {
			updateSecurityVaultForm(updater)
		},
	}
}
