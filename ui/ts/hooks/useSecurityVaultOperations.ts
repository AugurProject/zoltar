import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useErc20AllowanceLoader, useErc20BalanceLoader } from './useErc20Loader.js'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadErc20Balance, loadOracleManagerDetails, loadSecurityVaultDetails, queueOracleManagerOperation, redeemRepFromSecurityPool, redeemSecurityVaultFees, updateSecurityVaultFees } from '../contracts.js'
import { assertNever } from '../lib/assert.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { getErrorMessage, isRecoverableContractReadError } from '../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { parseAddressInput } from '../lib/inputs.js'
import { getDefaultSecurityVaultFormState, parseBigIntInput, parseRepAmountInput } from '../lib/marketForm.js'
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js'
import { requireDefined } from '../lib/required.js'
import { doesLoadedSecurityVaultMatchSelection, getSelectedVaultAddress, getStagedOperationTimeoutSeconds, MIN_SECURITY_BOND_ALLOWANCE, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import { createSecurityVaultSuccessPresentation, createSecurityVaultTransactionIntent, createSecurityVaultWarningPresentation } from '../lib/transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { SecurityVaultFormState, WriteOperationsParameters } from '../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../types/contracts.js'

type UseSecurityVaultOperationsParameters = WriteOperationsParameters & {
	enabled: boolean
	selectedSecurityPoolAddress?: string
}

export function useSecurityVaultOperations({ accountAddress, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseSecurityVaultOperationsParameters) {
	const securityVaultLoad = useLoadController()
	const securityVaultDetails = useSignal<SecurityVaultDetails | undefined>(undefined)
	const securityVaultMissing = useSignal(false)
	const securityVaultError = useSignal<string | undefined>(undefined)
	const { state: securityVaultForm, setState: updateSecurityVaultForm } = useFormState<SecurityVaultFormState>(getDefaultSecurityVaultFormState())
	const repBalanceLoader = useErc20BalanceLoader()
	const repAllowanceLoader = useErc20AllowanceLoader()
	const securityVaultActiveAction = useSignal<SecurityVaultActionResult['action'] | undefined>(undefined)
	const securityVaultFeedback = useSignal<ActionFeedback<SecurityVaultActionResult['action']> | undefined>(undefined)
	const securityVaultResult = useSignal<SecurityVaultActionResult | undefined>(undefined)
	const nextSecurityVaultLoad = useRequestGuard()
	const lastEffectiveVaultSelectionKey = useRef<string | undefined>(undefined)
	const effectiveSelectedVaultAddress = getSelectedVaultAddress(securityVaultForm.value.selectedVaultAddress, accountAddress)
	const effectiveSecurityPoolAddressInput = selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? securityVaultForm.value.securityPoolAddress : selectedSecurityPoolAddress
	const effectiveVaultSelectionKey = `${normalizeAddress(effectiveSecurityPoolAddressInput) ?? ''}:${normalizeAddress(effectiveSelectedVaultAddress) ?? ''}`
	const currentVaultSelectionKeyRef = useRef(effectiveVaultSelectionKey)
	currentVaultSelectionKeyRef.current = effectiveVaultSelectionKey
	const getPendingTitle = (actionName: SecurityVaultActionResult['action']) => {
		switch (actionName) {
			case 'approveRep':
				return 'Approving REP'
			case 'depositRep':
				return 'Depositing REP'
			case 'queueSetSecurityBondAllowance':
				return 'Setting security bond allowance'
			case 'queueWithdrawRep':
				return 'Withdrawing REP'
			case 'redeemFees':
				return 'Claiming fees'
			case 'redeemRep':
				return 'Redeeming REP'
			case 'updateVaultFees':
				return 'Refreshing vault fees'
			default:
				return assertNever(actionName)
		}
	}
	const getSuccessTitle = (actionName: SecurityVaultActionResult['action']) => {
		switch (actionName) {
			case 'approveRep':
				return 'REP approved'
			case 'depositRep':
				return 'REP deposited'
			case 'queueSetSecurityBondAllowance':
				return 'Security bond allowance set'
			case 'queueWithdrawRep':
				return 'REP withdrawal queued'
			case 'redeemFees':
				return 'Fees claimed'
			case 'redeemRep':
				return 'REP redeemed'
			case 'updateVaultFees':
				return 'Vault fees refreshed'
			default:
				return assertNever(actionName)
		}
	}
	const getFailureTitle = (actionName: SecurityVaultActionResult['action']) => {
		switch (actionName) {
			case 'approveRep':
				return 'REP approval failed'
			case 'depositRep':
				return 'REP deposit failed'
			case 'queueSetSecurityBondAllowance':
				return 'Security bond allowance update failed'
			case 'queueWithdrawRep':
				return 'REP withdrawal failed'
			case 'redeemFees':
				return 'Fee claim failed'
			case 'redeemRep':
				return 'REP redemption failed'
			case 'updateVaultFees':
				return 'Vault fee refresh failed'
			default:
				return assertNever(actionName)
		}
	}
	const clearRepLoaders = () => {
		repBalanceLoader.invalidate()
		repBalanceLoader.signal.value = undefined
		repAllowanceLoader.invalidate()
		repAllowanceLoader.signal.value = {
			error: undefined,
			loading: false,
			value: undefined,
		}
	}
	const clearSelectedVaultState = () => {
		securityVaultDetails.value = undefined
		securityVaultMissing.value = false
		securityVaultError.value = undefined
		securityVaultResult.value = undefined
		clearRepLoaders()
	}
	const isVaultSelectionCurrent = (selectionKey: string) => currentVaultSelectionKeyRef.current === selectionKey

	const resolveSelectedVaultAddress = () => {
		const selectedVaultAddress = requireDefined(getSelectedVaultAddress(securityVaultForm.value.selectedVaultAddress, accountAddress), 'Enter a vault address or connect a wallet before loading a security vault')
		return parseAddressInput(selectedVaultAddress, 'Selected vault address')
	}
	const resolveSelectedVaultAddressFromForm = (form: SecurityVaultFormState) => {
		const selectedVaultAddress = requireDefined(getSelectedVaultAddress(form.selectedVaultAddress, accountAddress), 'Enter a vault address or connect a wallet before loading a security vault')
		return parseAddressInput(selectedVaultAddress, 'Selected vault address')
	}
	const resolveSecurityVaultPoolAddress = () => parseAddressInput(effectiveSecurityPoolAddressInput, 'Security pool address')
	const resolveStagedOperationValidForSecondsFromForm = (form: SecurityVaultFormState) => {
		const timeoutMinutes = parseBigIntInput(form.stagedOperationTimeoutMinutes ?? '', 'Staged operation timeout')
		if (timeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) throw new Error('Staged operation timeout must be at least 1 minute')
		const timeoutSeconds = getStagedOperationTimeoutSeconds(timeoutMinutes)
		if (timeoutSeconds === undefined) throw new Error('Staged operation timeout must be at least 1 minute')
		return timeoutSeconds
	}

	useEffect(() => {
		if (!enabled) {
			lastEffectiveVaultSelectionKey.current = undefined
			return
		}
		if (lastEffectiveVaultSelectionKey.current === effectiveVaultSelectionKey) return
		void nextSecurityVaultLoad()
		clearSelectedVaultState()
		lastEffectiveVaultSelectionKey.current = effectiveVaultSelectionKey
	}, [effectiveVaultSelectionKey, enabled])

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

	const reloadSecurityVaultDetails = async (securityPoolAddress: Address, vaultAddress: Address, isCurrentSelection?: () => boolean) => {
		const details = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
		if (isCurrentSelection !== undefined && !isCurrentSelection()) return undefined
		securityVaultDetails.value = details
		securityVaultMissing.value = details === undefined
		return details
	}

	const matchesLoadedSecurityVault = (details: SecurityVaultDetails | undefined, securityPoolAddress: Address, vaultAddress: Address) => details !== undefined && sameAddress(details.securityPoolAddress, securityPoolAddress) && sameAddress(details.vaultAddress, vaultAddress)

	const refreshVaultFees = async (vaultAddress: Address, securityPoolAddress: Address) => {
		await updateSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, vaultAddress)
	}

	const loadExistingSecurityVaultDetails = async (securityPoolAddress: Address, vaultAddress: Address, missingPoolMessage: string, isCurrentSelection?: () => boolean) => {
		const details = matchesLoadedSecurityVault(securityVaultDetails.value, securityPoolAddress, vaultAddress) ? securityVaultDetails.value : await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
		if (isCurrentSelection !== undefined && !isCurrentSelection()) return undefined
		if (details !== undefined) return details

		securityVaultDetails.value = undefined
		securityVaultMissing.value = true
		clearRepLoaders()
		securityVaultError.value = missingPoolMessage
		return undefined
	}

	const loadSecurityVault = async (vaultAddressInput?: string) => {
		const isCurrent = nextSecurityVaultLoad()
		await securityVaultLoad.run({
			onStart: () => {
				securityVaultError.value = undefined
				securityVaultMissing.value = false
			},
			load: async () => {
				const securityPoolAddress = resolveSecurityVaultPoolAddress()
				const vaultAddress = vaultAddressInput?.trim() === '' || vaultAddressInput === undefined ? resolveSelectedVaultAddress() : parseAddressInput(vaultAddressInput, 'Selected vault address')
				if (vaultAddressInput !== undefined)
					securityVaultForm.value = {
						...securityVaultForm.value,
						selectedVaultAddress: vaultAddress.toString(),
					}
				const details = await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress)
				if (!isCurrent()) return undefined
				securityVaultDetails.value = details
				securityVaultMissing.value = details === undefined
				if (details === undefined) {
					clearRepLoaders()
					return undefined
				}
				if (sameAddress(vaultAddress, accountAddress)) {
					await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
					await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
				} else {
					clearRepLoaders()
				}
				return details
			},
			onSuccess: () => undefined,
			onError: (error: unknown) => {
				if (!isCurrent()) return
				securityVaultDetails.value = undefined
				securityVaultMissing.value = false
				clearRepLoaders()
				securityVaultError.value = getErrorMessage(error, 'Failed to load security vault')
			},
		})
	}

	const runVaultAction = async (
		actionName: SecurityVaultActionResult['action'],
		action: (ethereumAddress: Address, securityPoolAddress: Address, currentForm: SecurityVaultFormState, isCurrentSelection: () => boolean) => Promise<SecurityVaultActionResult | undefined>,
		errorFallback: string,
		onSuccess?: (result: SecurityVaultActionResult, securityPoolAddress: Address, walletAddress: Address, isCurrentSelection: () => boolean) => Promise<void> | void,
	) => {
		const currentForm = securityVaultForm.value
		const actionSelectionKey = effectiveVaultSelectionKey
		const isCurrentSelection = () => isVaultSelectionCurrent(actionSelectionKey)
		let securityPoolAddress: Address | undefined
		try {
			securityVaultActiveAction.value = actionName
			securityVaultFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						securityVaultError,
						'Connect a wallet before operating a security vault',
						createSecurityVaultTransactionIntent(actionName),
					),
					onRefreshError: (message, hash) => {
						securityVaultFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = securityVaultResult.value
						if (result !== undefined) onTransactionPresented(createSecurityVaultWarningPresentation(result, message))
					},
					onWriteCanceled: () => {
						securityVaultFeedback.value = undefined
					},
					onWriteError: message => {
						securityVaultFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
				},
				async walletAddress => {
					securityPoolAddress = resolveSecurityVaultPoolAddress()
					if (securityVaultMissing.value) throw new Error('Security pool does not exist')
					const selectedVaultAddress = resolveSelectedVaultAddressFromForm(currentForm)
					if (!sameAddress(selectedVaultAddress, walletAddress)) throw new Error('Selected vault is read-only')
					securityVaultError.value = undefined
					securityVaultResult.value = undefined
					return await action(selectedVaultAddress, securityPoolAddress, currentForm, isCurrentSelection)
				},
				errorFallback,
				async (result, walletAddress) => {
					const resolvedSecurityPoolAddress = requireDefined(securityPoolAddress, 'Security pool address is required')
					securityVaultResult.value = result
					securityVaultFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createSecurityVaultSuccessPresentation(result))
					if (!isCurrentSelection()) return
					await onSuccess?.(result, resolvedSecurityPoolAddress, walletAddress, isCurrentSelection)
				},
			)
		} finally {
			securityVaultActiveAction.value = undefined
		}
	}

	const approveRep = async (amount?: bigint) =>
		await runVaultAction(
			'approveRep',
			async (vaultAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const approvalAmount = amount ?? parseRepAmountInput(currentForm.depositAmount, 'REP collateral amount')
				if (!isCurrentSelection()) return undefined
				return await approveErc20(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), details.repToken, securityPoolAddress, approvalAmount, 'approveRep')
			},
			'Failed to approve REP',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				const details = await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
				if (details === undefined) return
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			},
		)

	const depositRep = async () =>
		await runVaultAction(
			'depositRep',
			async (vaultAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				const depositAmount = parseRepAmountInput(currentForm.depositAmount, 'REP collateral amount')
				if (depositAmount <= 0n) throw new Error('REP deposit amount must be greater than zero')
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const currentRepBalance = await loadErc20Balance(createConnectedReadClient(), details.repToken, vaultAddress)
				if (!isCurrentSelection()) return undefined
				repBalanceLoader.signal.value = currentRepBalance
				if (currentRepBalance < depositAmount) throw new Error(`Insufficient REP balance. Wallet balance is ${formatCurrencyBalance(currentRepBalance)} REP but the deposit amount is ${formatCurrencyBalance(depositAmount)} REP.`)
				return await depositRepToSecurityPool(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, depositAmount)
			},
			'Failed to deposit REP',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				const details = await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
				if (details === undefined) return
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			},
		)

	const setSecurityBondAllowance = async () =>
		await runVaultAction(
			'queueSetSecurityBondAllowance',
			async (vaultAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				const amount = parseRepAmountInput(currentForm.securityBondAllowanceAmount, 'Security bond allowance')
				if (amount < 0n) throw new Error('Security bond allowance must be zero or a positive amount')
				if (amount !== 0n && amount < MIN_SECURITY_BOND_ALLOWANCE) throw new Error(`Security bond allowance must be zero or at least ${formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)} ETH`)
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const managerDetails = await loadOracleManagerDetails(createConnectedReadClient(), details.managerAddress)
				if (!managerDetails.isPriceValid) throw new Error('A valid oracle price is required before setting the security bond allowance')
				const walletEthBalance = await createConnectedReadClient().getBalance({ address: vaultAddress })
				const setBondAllowanceGuardMessage = getOracleRequestEthGuardMessage({
					actionLabel: 'queue this bond allowance update',
					requestPriceEthCost: managerDetails.requestPriceEthCost,
					walletEthBalance,
				})
				if (setBondAllowanceGuardMessage !== undefined) throw new Error(setBondAllowanceGuardMessage)
				if (!isCurrentSelection()) return undefined
				const result = await queueOracleManagerOperation(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), details.managerAddress, 'setSecurityBondsAllowance', vaultAddress, amount, resolveStagedOperationValidForSecondsFromForm(currentForm))
				return {
					action: 'queueSetSecurityBondAllowance',
					hash: result.hash,
					...(result.queuedOperation === undefined ? {} : { queuedOperation: result.queuedOperation }),
					...(result.stagedExecution === undefined ? {} : { stagedExecution: result.stagedExecution }),
				} satisfies SecurityVaultActionResult
			},
			'Failed to set security bond allowance',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
			},
		)

	const redeemFees = async () =>
		await runVaultAction(
			'redeemFees',
			async (vaultAddress, securityPoolAddress, _currentForm, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				await refreshVaultFees(vaultAddress, securityPoolAddress)
				if (!isCurrentSelection()) return undefined
				return await redeemSecurityVaultFees(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, vaultAddress)
			},
			'Failed to redeem fees',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
			},
		)

	const redeemRep = async () =>
		await runVaultAction(
			'redeemRep',
			async (vaultAddress, securityPoolAddress, _currentForm, isCurrentSelection) => {
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				if (!isCurrentSelection()) return undefined
				return await redeemRepFromSecurityPool(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, vaultAddress)
			},
			'Failed to redeem REP',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				const details = await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
				if (details === undefined) return
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
			},
		)

	const withdrawRep = async () =>
		await runVaultAction(
			'queueWithdrawRep',
			async (vaultAddress, securityPoolAddress, currentForm, isCurrentSelection) => {
				const amount = parseRepAmountInput(currentForm.repWithdrawAmount, 'REP withdraw amount')
				if (amount <= 0n) throw new Error('REP withdraw amount must be greater than zero')

				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const managerDetails = await loadOracleManagerDetails(createConnectedReadClient(), details.managerAddress)
				if (!managerDetails.isPriceValid) throw new Error('A valid oracle price is required before withdrawing REP')
				const walletEthBalance = await createConnectedReadClient().getBalance({ address: vaultAddress })
				const withdrawRepGuardMessage = getOracleRequestEthGuardMessage({
					actionLabel: 'queue this REP withdrawal',
					requestPriceEthCost: managerDetails.requestPriceEthCost,
					walletEthBalance,
				})
				if (withdrawRepGuardMessage !== undefined) throw new Error(withdrawRepGuardMessage)
				if (!isCurrentSelection()) return undefined
				const result = await queueOracleManagerOperation(createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), details.managerAddress, 'withdrawRep', vaultAddress, amount, resolveStagedOperationValidForSecondsFromForm(currentForm))
				return {
					action: 'queueWithdrawRep',
					hash: result.hash,
					...(result.queuedOperation === undefined ? {} : { queuedOperation: result.queuedOperation }),
					...(result.stagedExecution === undefined ? {} : { stagedExecution: result.stagedExecution }),
				} satisfies SecurityVaultActionResult
			},
			'Failed to withdraw REP',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				const details = await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
				if (details === undefined) return
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
			},
		)

	useEffect(() => {
		if (!enabled) return
		const selectedVaultAddress = securityVaultForm.value.selectedVaultAddress.trim()
		if (accountAddress === undefined || selectedVaultAddress === '') {
			clearRepLoaders()
			return
		}

		if (
			!doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress: securityVaultForm.value.securityPoolAddress,
				securityVaultDetails: securityVaultDetails.value,
				selectedVaultAddress,
			}) ||
			!sameAddress(selectedVaultAddress, accountAddress)
		) {
			clearRepLoaders()
			return
		}

		const currentSecurityVaultDetails = securityVaultDetails.value
		if (currentSecurityVaultDetails === undefined) {
			clearRepLoaders()
			return
		}

		void reloadSecurityVaultRepBalance(currentSecurityVaultDetails.repToken, accountAddress).catch(error => {
			if (!isRecoverableContractReadError(error)) throw error
		})
		void reloadSecurityVaultRepAllowance(currentSecurityVaultDetails.repToken, accountAddress, currentSecurityVaultDetails.securityPoolAddress).catch(error => {
			if (!isRecoverableContractReadError(error)) throw error
		})
	}, [accountAddress, enabled, securityVaultDetails.value?.repToken, securityVaultDetails.value?.securityPoolAddress, securityVaultForm.value.securityPoolAddress, securityVaultForm.value.selectedVaultAddress])

	return {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault: securityVaultLoad.isLoading.value,
		redeemFees,
		redeemRep,
		securityVaultActiveAction: securityVaultActiveAction.value,
		securityVaultFeedback: securityVaultFeedback.value,
		setSecurityBondAllowance,
		withdrawRep,
		securityVaultRepApproval: repAllowanceLoader.signal.value,
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
