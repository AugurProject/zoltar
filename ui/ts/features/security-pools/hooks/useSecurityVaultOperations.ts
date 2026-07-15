import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useErc20AllowanceLoader, useErc20BalanceLoader } from '../../../hooks/useErc20Loader.js'
import { useFormState } from '../../../hooks/useFormState.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import type { Address } from '@zoltar/shared/ethereum'
import { addOpenOracleBountyBuffer } from '../../open-oracle/lib/openOracle.js'
import { approveErc20, depositRepToSecurityPool, loadCoordinatorInitialReportFundingRequirement, loadErc20Balance, loadOracleManagerDetails, loadSecurityVaultDetails, queueOracleManagerOperation, redeemRepFromSecurityPool, redeemSecurityVaultFees, updateSecurityVaultFees } from '../../../protocol/index.js'
import { assertNever } from '../../../lib/assert.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { normalizeAddress, sameAddress } from '../../../lib/address.js'
import { getErrorMessage, isRecoverableContractReadError } from '../../../lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { parseAddressInput } from '../../../lib/inputs.js'
import { getDefaultSecurityVaultFormState, parseBigIntInput, parseRepAmountInput } from '../../markets/lib/marketForm.js'
import { getOracleRequestEthGuardMessage, resolveOracleOperationEthFunding } from '../../open-oracle/lib/oracleRequestEth.js'
import { requireDefined } from '../../../lib/required.js'
import { doesLoadedSecurityVaultMatchSelection, getSelectedVaultAddress, getStagedOperationTimeoutSeconds, MIN_SECURITY_BOND_ALLOWANCE, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import { createSecurityVaultSuccessPresentation, createSecurityVaultTransactionIntent, createSecurityVaultWarningPresentation } from '../../transactionPresentations.js'
import { buildWriteActionConfig, runWriteAction } from '../../../lib/writeAction.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import type { SecurityVaultFormState, WriteOperationsParameters } from '../../../types/app.js'
import type { SecurityVaultActionResult, SecurityVaultDetails } from '../../../types/contracts.js'

type UseSecurityVaultOperationsParameters = WriteOperationsParameters & {
	enabled: boolean
	selectedSecurityPoolAddress?: string
}

type SecurityVaultReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
}

type SecurityVaultProductionWriteClient = ReturnType<typeof createWalletWriteClient>

type SecurityVaultQueueResult = Pick<SecurityVaultActionResult, 'hash' | 'queuedOperation' | 'stagedExecution'>

export type UseSecurityVaultOperationsDependencies<TWriteClient = SecurityVaultProductionWriteClient> = {
	approveErc20: (client: TWriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: 'approveRep') => Promise<SecurityVaultActionResult>
	createConnectedReadClient: () => SecurityVaultReadClient
	createWalletWriteClient: (walletAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	depositRepToSecurityPool: (client: TWriteClient, securityPoolAddress: Address, amount: bigint) => Promise<SecurityVaultActionResult>
	loadCoordinatorInitialReportFundingRequirement: (client: TWriteClient, managerAddress: Address, walletAddress: Address) => Promise<Awaited<ReturnType<typeof loadCoordinatorInitialReportFundingRequirement>>>
	loadErc20Balance: (tokenAddress: Address, accountAddress: Address) => Promise<bigint>
	loadOracleManagerDetails: (managerAddress: Address) => Promise<Awaited<ReturnType<typeof loadOracleManagerDetails>>>
	loadSecurityVaultDetails: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultDetails | undefined>
	queueOracleManagerOperation: (client: TWriteClient, managerAddress: Address, operation: 'setSecurityBondsAllowance' | 'withdrawRep', targetVault: Address, amount: bigint, validForSeconds: bigint) => Promise<SecurityVaultQueueResult>
	redeemRepFromSecurityPool: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultActionResult>
	redeemSecurityVaultFees: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultActionResult>
	updateSecurityVaultFees: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultActionResult>
}

const defaultUseSecurityVaultOperationsDependencies: UseSecurityVaultOperationsDependencies = {
	approveErc20: async (client, tokenAddress, spenderAddress, amount, action) => await approveErc20(client, tokenAddress, spenderAddress, amount, action),
	createConnectedReadClient: () => createConnectedReadClient(),
	createWalletWriteClient,
	depositRepToSecurityPool: async (client, securityPoolAddress, amount) => await depositRepToSecurityPool(client, securityPoolAddress, amount),
	loadCoordinatorInitialReportFundingRequirement: async (client, managerAddress, walletAddress) => await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, walletAddress),
	loadErc20Balance: async (tokenAddress, accountAddress) => await loadErc20Balance(createConnectedReadClient(), tokenAddress, accountAddress),
	loadOracleManagerDetails: async managerAddress => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
	loadSecurityVaultDetails: async (securityPoolAddress, vaultAddress) => await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress),
	queueOracleManagerOperation: async (client, managerAddress, operation, targetVault, amount, validForSeconds) => await queueOracleManagerOperation(client, managerAddress, operation, targetVault, amount, validForSeconds),
	redeemRepFromSecurityPool: async (client, securityPoolAddress, vaultAddress) => await redeemRepFromSecurityPool(client, securityPoolAddress, vaultAddress),
	redeemSecurityVaultFees: async (client, securityPoolAddress, vaultAddress) => await redeemSecurityVaultFees(client, securityPoolAddress, vaultAddress),
	updateSecurityVaultFees: async (client, securityPoolAddress, vaultAddress) => await updateSecurityVaultFees(client, securityPoolAddress, vaultAddress),
}

type SecurityVaultActionSnapshot = {
	effectiveSecurityPoolAddressInput: string | undefined
	effectiveVaultSelectionKey: string
	form: SecurityVaultFormState
}

function useSecurityVaultOperationsWithDependencies<TWriteClient>(
	{ accountAddress, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseSecurityVaultOperationsParameters,
	dependencies: UseSecurityVaultOperationsDependencies<TWriteClient>,
) {
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
	const createVaultActionSnapshot = (): SecurityVaultActionSnapshot => ({
		effectiveSecurityPoolAddressInput,
		effectiveVaultSelectionKey,
		form: { ...securityVaultForm.value },
	})
	const isVaultActionSnapshotCurrent = (snapshot: SecurityVaultActionSnapshot) => snapshot.effectiveVaultSelectionKey === lastEffectiveVaultSelectionKey.current
	const resolveSelectedVaultAddressFromSnapshot = (snapshot: SecurityVaultActionSnapshot) => {
		const selectedVaultAddress = requireDefined(getSelectedVaultAddress(snapshot.form.selectedVaultAddress, accountAddress), 'Enter a vault address or connect a wallet before loading a security vault')
		return parseAddressInput(selectedVaultAddress, 'Selected vault address')
	}
	const resolveSecurityVaultPoolAddressFromSnapshot = (snapshot: SecurityVaultActionSnapshot) => parseAddressInput(requireDefined(snapshot.effectiveSecurityPoolAddressInput, 'Security pool address is required'), 'Security pool address')
	const resolveSecurityVaultPoolAddress = () => parseAddressInput(effectiveSecurityPoolAddressInput, 'Security pool address')
	const resolveStagedOperationValidForSecondsFromSnapshot = (snapshot: SecurityVaultActionSnapshot) => {
		const timeoutMinutes = parseBigIntInput(snapshot.form.stagedOperationTimeoutMinutes ?? '', 'Staged operation timeout')
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
		const details = await dependencies.loadSecurityVaultDetails(securityPoolAddress, vaultAddress)
		if (isCurrentSelection !== undefined && !isCurrentSelection()) return undefined
		securityVaultDetails.value = details
		securityVaultMissing.value = details === undefined
		return details
	}

	const matchesLoadedSecurityVault = (details: SecurityVaultDetails | undefined, securityPoolAddress: Address, vaultAddress: Address) => details !== undefined && sameAddress(details.securityPoolAddress, securityPoolAddress) && sameAddress(details.vaultAddress, vaultAddress)

	const refreshVaultFees = async (vaultAddress: Address, securityPoolAddress: Address) => {
		await dependencies.updateSecurityVaultFees(dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, vaultAddress)
	}

	const assertFreshRequestFunding = async (writeClient: TWriteClient, managerAddress: Address, vaultAddress: Address, requiredEthCost: bigint, actionLabel: string, walletEthBalance: bigint | undefined) => {
		const fundingRequirement = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, vaultAddress)
		if (fundingRequirement.currentRepBalance < fundingRequirement.exactToken1Report) {
			throw new Error(`Need ${formatCurrencyBalance(fundingRequirement.exactToken1Report - fundingRequirement.currentRepBalance)} more REP in this wallet to fund the initial report.`)
		}
		const requiredEthWithWrap = addOpenOracleBountyBuffer(requiredEthCost) + fundingRequirement.wethShortfall
		if (walletEthBalance !== undefined && walletEthBalance < requiredEthWithWrap) {
			throw new Error(`Need ${formatCurrencyBalance(requiredEthWithWrap - walletEthBalance)} more ETH in this wallet to fund the initial report and ${actionLabel}.`)
		}
	}

	const loadExistingSecurityVaultDetails = async (securityPoolAddress: Address, vaultAddress: Address, missingPoolMessage: string, isCurrentSelection?: () => boolean) => {
		const details = matchesLoadedSecurityVault(securityVaultDetails.value, securityPoolAddress, vaultAddress) ? securityVaultDetails.value : await dependencies.loadSecurityVaultDetails(securityPoolAddress, vaultAddress)
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
				const details = await dependencies.loadSecurityVaultDetails(securityPoolAddress, vaultAddress)
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
		snapshot: SecurityVaultActionSnapshot,
		action: (ethereumAddress: Address, securityPoolAddress: Address, isCurrentSelection: () => boolean) => Promise<SecurityVaultActionResult | undefined>,
		errorFallback: string,
		onSuccess?: (result: SecurityVaultActionResult, securityPoolAddress: Address, walletAddress: Address, isCurrentSelection: () => boolean) => Promise<void> | void,
	) => {
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
						if (!isVaultActionSnapshotCurrent(snapshot)) return
						securityVaultFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = securityVaultResult.value
						if (result !== undefined) onTransactionPresented(createSecurityVaultWarningPresentation(result, message))
					},
					onWriteCanceled: () => {
						securityVaultFeedback.value = undefined
					},
					onWriteError: message => {
						if (!isVaultActionSnapshotCurrent(snapshot)) return
						securityVaultFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async walletAddress => {
					securityPoolAddress = resolveSecurityVaultPoolAddressFromSnapshot(snapshot)
					if (securityVaultMissing.value) throw new Error('Security pool does not exist')
					const selectedVaultAddress = resolveSelectedVaultAddressFromSnapshot(snapshot)
					if (!sameAddress(selectedVaultAddress, walletAddress)) throw new Error('Selected vault is read-only')
					securityVaultError.value = undefined
					securityVaultResult.value = undefined
					return await action(selectedVaultAddress, securityPoolAddress, isCurrentSelection)
				},
				errorFallback,
				async (result, walletAddress) => {
					if (!isVaultActionSnapshotCurrent(snapshot)) return
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

	const approveRep = async (amount?: bigint) => {
		const snapshot = createVaultActionSnapshot()
		await runVaultAction(
			'approveRep',
			snapshot,
			async (vaultAddress, securityPoolAddress, isCurrentSelection) => {
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const approvalAmount = amount ?? parseRepAmountInput(snapshot.form.depositAmount, 'REP collateral amount')
				if (!isCurrentSelection()) return undefined
				return await dependencies.approveErc20(dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), details.repToken, securityPoolAddress, approvalAmount, 'approveRep')
			},
			'Failed to approve REP',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				const details = await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
				if (details === undefined) return
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepAllowance(details.repToken, vaultAddress, securityPoolAddress)
			},
		)
	}

	const depositRep = async () => {
		const snapshot = createVaultActionSnapshot()
		await runVaultAction(
			'depositRep',
			snapshot,
			async (vaultAddress, securityPoolAddress, isCurrentSelection) => {
				const depositAmount = parseRepAmountInput(snapshot.form.depositAmount, 'REP collateral amount')
				if (depositAmount <= 0n) throw new Error('REP deposit amount must be greater than zero')
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const currentRepBalance = await dependencies.loadErc20Balance(details.repToken, vaultAddress)
				if (!isCurrentSelection()) return undefined
				repBalanceLoader.signal.value = currentRepBalance
				if (currentRepBalance < depositAmount) throw new Error(`Insufficient REP balance. Wallet balance is ${formatCurrencyBalance(currentRepBalance)} REP but the deposit amount is ${formatCurrencyBalance(depositAmount)} REP.`)
				return await dependencies.depositRepToSecurityPool(dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, depositAmount)
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
	}

	const setSecurityBondAllowance = async () => {
		const snapshot = createVaultActionSnapshot()
		await runVaultAction(
			'queueSetSecurityBondAllowance',
			snapshot,
			async (vaultAddress, securityPoolAddress, isCurrentSelection) => {
				const amount = parseRepAmountInput(snapshot.form.securityBondAllowanceAmount, 'Security bond allowance')
				if (amount < 0n) throw new Error('Security bond allowance must be zero or a positive amount')
				if (amount !== 0n && amount < MIN_SECURITY_BOND_ALLOWANCE) throw new Error(`Security bond allowance must be zero or at least ${formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)} ETH`)
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const managerDetails = await dependencies.loadOracleManagerDetails(details.managerAddress)
				const funding = resolveOracleOperationEthFunding({
					managerDetails,
				})
				const writeClient = dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted })
				const walletEthBalance = funding?.ethCost === undefined || funding.ethCost === 0n ? undefined : await dependencies.createConnectedReadClient().getBalance({ address: vaultAddress })
				if (funding?.ethCost !== undefined && funding.ethCost > 0n) {
					await assertFreshRequestFunding(writeClient, details.managerAddress, vaultAddress, funding.ethCost, 'queue this bond allowance update', walletEthBalance)
				}
				const setBondAllowanceGuardMessage = getOracleRequestEthGuardMessage({
					actionLabel: 'queue this bond allowance update',
					includeBuffer: funding?.includeBuffer === true,
					requiredEthCost: funding?.ethCost,
					walletEthBalance,
				})
				if (setBondAllowanceGuardMessage !== undefined) throw new Error(setBondAllowanceGuardMessage)
				if (!isCurrentSelection()) return undefined
				const result = await dependencies.queueOracleManagerOperation(writeClient, details.managerAddress, 'setSecurityBondsAllowance', vaultAddress, amount, resolveStagedOperationValidForSecondsFromSnapshot(snapshot))
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
	}

	const redeemFees = async () => {
		const snapshot = createVaultActionSnapshot()
		await runVaultAction(
			'redeemFees',
			snapshot,
			async (vaultAddress, securityPoolAddress, isCurrentSelection) => {
				if (!isCurrentSelection()) return undefined
				await refreshVaultFees(vaultAddress, securityPoolAddress)
				if (!isCurrentSelection()) return undefined
				return await dependencies.redeemSecurityVaultFees(dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, vaultAddress)
			},
			'Failed to redeem fees',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
			},
		)
	}

	const redeemRep = async () => {
		const snapshot = createVaultActionSnapshot()
		await runVaultAction(
			'redeemRep',
			snapshot,
			async (vaultAddress, securityPoolAddress, isCurrentSelection) => {
				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				if (!isCurrentSelection()) return undefined
				return await dependencies.redeemRepFromSecurityPool(dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted }), securityPoolAddress, vaultAddress)
			},
			'Failed to redeem REP',
			async (_result, securityPoolAddress, vaultAddress, isCurrentSelection) => {
				const details = await reloadSecurityVaultDetails(securityPoolAddress, vaultAddress, isCurrentSelection)
				if (details === undefined) return
				if (!isCurrentSelection()) return
				await reloadSecurityVaultRepBalance(details.repToken, vaultAddress)
			},
		)
	}

	const withdrawRep = async () => {
		const snapshot = createVaultActionSnapshot()
		await runVaultAction(
			'queueWithdrawRep',
			snapshot,
			async (vaultAddress, securityPoolAddress, isCurrentSelection) => {
				const amount = parseRepAmountInput(snapshot.form.repWithdrawAmount, 'REP withdraw amount')
				if (amount <= 0n) throw new Error('REP withdraw amount must be greater than zero')

				const details = await loadExistingSecurityVaultDetails(securityPoolAddress, vaultAddress, 'Security pool does not exist', isCurrentSelection)
				if (details === undefined) return undefined
				const managerDetails = await dependencies.loadOracleManagerDetails(details.managerAddress)
				const funding = resolveOracleOperationEthFunding({
					managerDetails,
				})
				const writeClient = dependencies.createWalletWriteClient(vaultAddress, { onTransactionPrepared, onTransactionSubmitted })
				const walletEthBalance = funding?.ethCost === undefined || funding.ethCost === 0n ? undefined : await dependencies.createConnectedReadClient().getBalance({ address: vaultAddress })
				if (funding?.ethCost !== undefined && funding.ethCost > 0n) {
					await assertFreshRequestFunding(writeClient, details.managerAddress, vaultAddress, funding.ethCost, 'queue this REP withdrawal', walletEthBalance)
				}
				const withdrawRepGuardMessage = getOracleRequestEthGuardMessage({
					actionLabel: 'queue this REP withdrawal',
					includeBuffer: funding?.includeBuffer === true,
					requiredEthCost: funding?.ethCost,
					walletEthBalance,
				})
				if (withdrawRepGuardMessage !== undefined) throw new Error(withdrawRepGuardMessage)
				if (!isCurrentSelection()) return undefined
				const result = await dependencies.queueOracleManagerOperation(writeClient, details.managerAddress, 'withdrawRep', vaultAddress, amount, resolveStagedOperationValidForSecondsFromSnapshot(snapshot))
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
	}

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

export function useSecurityVaultOperations(parameters: UseSecurityVaultOperationsParameters): ReturnType<typeof useSecurityVaultOperationsWithDependencies<SecurityVaultProductionWriteClient>>
export function useSecurityVaultOperations<TWriteClient>(parameters: UseSecurityVaultOperationsParameters, dependencies: UseSecurityVaultOperationsDependencies<TWriteClient>): ReturnType<typeof useSecurityVaultOperationsWithDependencies<TWriteClient>>
export function useSecurityVaultOperations<TWriteClient>(parameters: UseSecurityVaultOperationsParameters, dependencies?: UseSecurityVaultOperationsDependencies<TWriteClient>) {
	if (dependencies === undefined) return useSecurityVaultOperationsWithDependencies(parameters, defaultUseSecurityVaultOperationsDependencies)
	return useSecurityVaultOperationsWithDependencies(parameters, dependencies)
}
