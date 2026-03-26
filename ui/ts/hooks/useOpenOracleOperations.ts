import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { approveErc20, loadOracleManagerDetails, queueOracleManagerOperation, requestOraclePrice, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBytes32Input, parseOracleQueueOperationInput, parseReportIdInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
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
		setSignalValue(loadingOracleManager, true)
		setSignalValue(openOracleError, undefined)
		try {
			const managerAddress = parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')
			const details = await loadOracleManagerDetails(createReadClient(), managerAddress)
			setSignalValue(oracleManagerDetails, details)
			updateSignalValue(openOracleForm, current => ({
				...current,
				amount1: details.exactToken1Report?.toString() ?? current.amount1,
				reportId: details.pendingReportId === 0n ? current.reportId : details.pendingReportId.toString(),
				stateHash: details.callbackStateHash ?? current.stateHash,
			}))
		} catch (error) {
			setSignalValue(oracleManagerDetails, undefined)
			setSignalValue(openOracleError, getErrorMessage(error, 'Failed to load oracle manager'))
		} finally {
			setSignalValue(loadingOracleManager, false)
		}
	}

	const runOracleAction = async (action: (walletAddress: Address) => Promise<OpenOracleActionResult>, errorFallback: string) => {
		if (accountAddress === undefined) {
			setSignalValue(openOracleError, 'Connect a wallet before operating open oracle')
			return
		}

		try {
			onTransactionRequested()
			setSignalValue(openOracleError, undefined)
			setSignalValue(openOracleResult, undefined)
			const result = await action(accountAddress)
			setSignalValue(openOracleResult, result)
			onTransaction(result.hash)
			await refreshState()
			if (openOracleForm.value.managerAddress.trim() !== '') {
				await loadOracleManager()
			}
		} catch (error) {
			setSignalValue(openOracleError, getErrorMessage(error, errorFallback))
		} finally {
			onTransactionFinished()
		}
	}

	const approveToken1 = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getRequiredInjectedEthereum()
			const details = oracleManagerDetails.value
			if (details?.token1 === undefined) throw new Error('Load an oracle report first')
			return await approveErc20(createWriteClient(ethereum, walletAddress, { onTransactionSubmitted }), details.token1, details.openOracleAddress, parseBigIntInput(openOracleForm.value.amount1, 'Token1 amount'), 'approveToken1')
		}, 'Failed to approve token1')

	const approveToken2 = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getRequiredInjectedEthereum()
			const details = oracleManagerDetails.value
			if (details?.token2 === undefined) throw new Error('Load an oracle report first')
			return await approveErc20(createWriteClient(ethereum, walletAddress, { onTransactionSubmitted }), details.token2, details.openOracleAddress, parseBigIntInput(openOracleForm.value.amount2, 'Token2 amount'), 'approveToken2')
		}, 'Failed to approve token2')

	const requestPrice = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getRequiredInjectedEthereum()
			const details = oracleManagerDetails.value ?? (await loadOracleManagerDetails(createReadClient(), parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')))
			return await requestOraclePrice(createWriteClient(ethereum, walletAddress, { onTransactionSubmitted }), details.managerAddress, details.requestPriceEthCost)
		}, 'Failed to request price')

	const queueOperation = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getRequiredInjectedEthereum()
			const details = oracleManagerDetails.value ?? (await loadOracleManagerDetails(createReadClient(), parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')))
			return await queueOracleManagerOperation(createWriteClient(ethereum, walletAddress, { onTransactionSubmitted }), details.managerAddress, parseOracleQueueOperationInput(openOracleForm.value.queuedOperation), parseAddressInput(openOracleForm.value.operationTargetVault, 'Operation target vault'), parseBigIntInput(openOracleForm.value.operationAmount, 'Operation amount'), details.requestPriceEthCost)
		}, 'Failed to queue oracle manager operation')

	const submitInitialReport = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getRequiredInjectedEthereum()
			return await submitInitialOracleReport(createWriteClient(ethereum, walletAddress, { onTransactionSubmitted }), parseReportIdInput(openOracleForm.value.reportId), parseBigIntInput(openOracleForm.value.amount1, 'Token1 amount'), parseBigIntInput(openOracleForm.value.amount2, 'Token2 amount'), parseBytes32Input(openOracleForm.value.stateHash, 'State hash'))
		}, 'Failed to submit initial report')

	const settleReport = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getRequiredInjectedEthereum()
			return await settleOracleReport(createWriteClient(ethereum, walletAddress, { onTransactionSubmitted }), parseReportIdInput(openOracleForm.value.reportId))
		}, 'Failed to settle report')

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
			updateSignalValue(openOracleForm, updater)
		},
		settleReport,
		submitInitialReport,
	}
}
