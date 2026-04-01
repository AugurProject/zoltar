import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { approveErc20, loadOracleManagerDetails, queueOracleManagerOperation, requestOraclePrice, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { createReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput, parseBytes32Input, parseOracleQueueOperationInput, parseReportIdInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleActionResult, OracleManagerDetails } from '../types/contracts.js'

type UseOpenOracleOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useOpenOracleOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters) {
	const loadingOracleManager = useSignal(false)
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleForm = useSignal<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const oracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)

	const loadOracleManager = async () => {
		loadingOracleManager.value = true
		openOracleError.value = undefined
		try {
			const managerAddress = parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')
			const details = await loadOracleManagerDetails(createReadClient(), managerAddress)
			oracleManagerDetails.value = details
			const current = openOracleForm.value
			openOracleForm.value = {
				...current,
				amount1: details.exactToken1Report?.toString() ?? current.amount1,
				reportId: details.pendingReportId === 0n ? current.reportId : details.pendingReportId.toString(),
				stateHash: details.callbackStateHash ?? current.stateHash,
			}
		} catch (error) {
			oracleManagerDetails.value = undefined
			openOracleError.value = getErrorMessage(error, 'Failed to load oracle manager')
		} finally {
			loadingOracleManager.value = false
		}
	}

	const runOracleAction = async (action: (walletAddress: Address) => Promise<OpenOracleActionResult>, errorFallback: string) =>
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before operating open oracle',
				onTransaction,
				onTransactionFinished,
				onTransactionRequested,
				refreshState,
				setErrorMessage: message => {
					openOracleError.value = message
				},
			},
			async walletAddress => {
				openOracleResult.value = undefined
				return await action(walletAddress)
			},
			errorFallback,
			async result => {
				openOracleResult.value = result
				if (openOracleForm.value.managerAddress.trim() !== '') {
					await loadOracleManager()
				}
			},
		)

	const approveToken1 = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value
			if (details?.token1 === undefined) throw new Error('Load an oracle report first')
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.token1, details.openOracleAddress, parseBigIntInput(openOracleForm.value.amount1, 'Token1 amount'), 'approveToken1')
		}, 'Failed to approve token1')

	const approveToken2 = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value
			if (details?.token2 === undefined) throw new Error('Load an oracle report first')
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.token2, details.openOracleAddress, parseBigIntInput(openOracleForm.value.amount2, 'Token2 amount'), 'approveToken2')
		}, 'Failed to approve token2')

	const requestPrice = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value ?? (await loadOracleManagerDetails(createReadClient(), parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')))
			return await requestOraclePrice(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.managerAddress, details.requestPriceEthCost)
		}, 'Failed to request price')

	const queueOperation = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value ?? (await loadOracleManagerDetails(createReadClient(), parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')))
			return await queueOracleManagerOperation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.managerAddress, parseOracleQueueOperationInput(openOracleForm.value.queuedOperation), parseAddressInput(openOracleForm.value.operationTargetVault, 'Operation target vault'), parseBigIntInput(openOracleForm.value.operationAmount, 'Operation amount'), details.requestPriceEthCost)
		}, 'Failed to queue oracle manager operation')

	const submitInitialReport = async () => await runOracleAction(async walletAddress => await submitInitialOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseReportIdInput(openOracleForm.value.reportId), parseBigIntInput(openOracleForm.value.amount1, 'Token1 amount'), parseBigIntInput(openOracleForm.value.amount2, 'Token2 amount'), parseBytes32Input(openOracleForm.value.stateHash, 'State hash')), 'Failed to submit initial report')

	const settleReport = async () => await runOracleAction(async walletAddress => await settleOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseReportIdInput(openOracleForm.value.reportId)), 'Failed to settle report')

	return {
		approveToken1,
		approveToken2,
		loadOracleManager,
		loadingOracleManager: loadingOracleManager.value,
		onRequestPrice: requestPrice,
		onQueueOperation: queueOperation,
		openOracleError: openOracleError.value,
		openOracleForm: openOracleForm.value,
		openOracleResult: openOracleResult.value,
		oracleManagerDetails: oracleManagerDetails.value,
		setOpenOracleForm: (updater: (current: OpenOracleFormState) => OpenOracleFormState) => {
			openOracleForm.value = updater(openOracleForm.value)
		},
		settleReport,
		submitInitialReport,
	}
}
