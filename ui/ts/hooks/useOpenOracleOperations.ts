import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { approveErc20, disputeOracleReport, loadOpenOracleReportDetails, loadOracleManagerDetails, queueOracleManagerOperation, requestOraclePrice, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput, parseBytes32Input, parseOracleQueueOperationInput, parseReportIdInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleActionResult, OpenOracleReportDetails, OracleManagerDetails } from '../types/contracts.js'

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
	const loadingOracleReport = useSignal(false)
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleForm = useSignal<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)
	const oracleManagerDetails = useSignal<OracleManagerDetails | undefined>(undefined)
	const openOracleReportDetails = useSignal<OpenOracleReportDetails | undefined>(undefined)

	const getOpenOracleAddress = () => {
		const addr = openOracleForm.value.openOracleAddress.trim()
		return addr !== '' ? parseAddressInput(addr, 'OpenOracle address') : undefined
	}

	const loadOracleManager = async () => {
		loadingOracleManager.value = true
		openOracleError.value = undefined
		try {
			const managerAddress = parseAddressInput(openOracleForm.value.managerAddress, 'Manager address')
			const openOracleAddress = getOpenOracleAddress()
			const details = await loadOracleManagerDetails(createConnectedReadClient(), managerAddress, openOracleAddress)
			oracleManagerDetails.value = details
			const current = openOracleForm.value
			openOracleForm.value = {
				...current,
				amount1: details.exactToken1Report?.toString() ?? current.amount1,
				openOracleAddress: details.openOracleAddress,
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

	const loadOracleReport = async () => {
		loadingOracleReport.value = true
		openOracleError.value = undefined
		try {
			const openOracleAddress = parseAddressInput(openOracleForm.value.openOracleAddress, 'OpenOracle address')
			const reportId = parseReportIdInput(openOracleForm.value.reportId)
			const details = await loadOpenOracleReportDetails(createConnectedReadClient(), openOracleAddress, reportId)
			openOracleReportDetails.value = details
			openOracleForm.value = {
				...openOracleForm.value,
				amount1: details.exactToken1Report.toString(),
				stateHash: details.stateHash,
			}
		} catch (error) {
			openOracleReportDetails.value = undefined
			openOracleError.value = getErrorMessage(error, 'Failed to load oracle report')
		} finally {
			loadingOracleReport.value = false
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
				if (openOracleForm.value.openOracleAddress.trim() !== '' && openOracleForm.value.reportId.trim() !== '') {
					await loadOracleReport()
				}
				if (openOracleForm.value.managerAddress.trim() !== '') {
					await loadOracleManager()
				}
			},
		)

	const resolveOpenOracleAddress = (): Address => {
		const fromForm = openOracleForm.value.openOracleAddress.trim()
		if (fromForm !== '') return parseAddressInput(fromForm, 'OpenOracle address')
		const fromManager = oracleManagerDetails.value?.openOracleAddress
		if (fromManager !== undefined) return fromManager
		throw new Error('Enter an OpenOracle address or load an oracle manager first')
	}

	const approveToken1 = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value ?? openOracleReportDetails.value
			const token1 = details !== undefined && 'token1' in details ? details.token1 : undefined
			if (token1 === undefined) throw new Error('Load an oracle report or manager first')
			const openOracleAddress = resolveOpenOracleAddress()
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), token1, openOracleAddress, parseBigIntInput(openOracleForm.value.amount1, 'Token1 amount'), 'approveToken1')
		}, 'Failed to approve token1')

	const approveToken2 = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value ?? openOracleReportDetails.value
			const token2 = details !== undefined && 'token2' in details ? details.token2 : undefined
			if (token2 === undefined) throw new Error('Load an oracle report or manager first')
			const openOracleAddress = resolveOpenOracleAddress()
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), token2, openOracleAddress, parseBigIntInput(openOracleForm.value.amount2, 'Token2 amount'), 'approveToken2')
		}, 'Failed to approve token2')

	const requestPrice = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value ?? (await loadOracleManagerDetails(createConnectedReadClient(), parseAddressInput(openOracleForm.value.managerAddress, 'Manager address'), getOpenOracleAddress()))
			return await requestOraclePrice(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.managerAddress, details.requestPriceEthCost)
		}, 'Failed to request price')

	const queueOperation = async () =>
		await runOracleAction(async walletAddress => {
			const details = oracleManagerDetails.value ?? (await loadOracleManagerDetails(createConnectedReadClient(), parseAddressInput(openOracleForm.value.managerAddress, 'Manager address'), getOpenOracleAddress()))
			return await queueOracleManagerOperation(
				createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
				details.managerAddress,
				parseOracleQueueOperationInput(openOracleForm.value.queuedOperation),
				parseAddressInput(openOracleForm.value.operationTargetVault, 'Operation target vault'),
				parseBigIntInput(openOracleForm.value.operationAmount, 'Operation amount'),
				details.requestPriceEthCost,
			)
		}, 'Failed to queue oracle manager operation')

	const submitInitialReport = async () =>
		await runOracleAction(
			async walletAddress =>
				await submitInitialOracleReport(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					resolveOpenOracleAddress(),
					parseReportIdInput(openOracleForm.value.reportId),
					parseBigIntInput(openOracleForm.value.amount1, 'Token1 amount'),
					parseBigIntInput(openOracleForm.value.amount2, 'Token2 amount'),
					parseBytes32Input(openOracleForm.value.stateHash, 'State hash'),
				),
			'Failed to submit initial report',
		)

	const settleReport = async () => await runOracleAction(async walletAddress => await settleOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), resolveOpenOracleAddress(), parseReportIdInput(openOracleForm.value.reportId)), 'Failed to settle report')

	const disputeReport = async () =>
		await runOracleAction(async walletAddress => {
			const reportDetails = openOracleReportDetails.value
			if (reportDetails === undefined) throw new Error('Load an oracle report first')
			const form = openOracleForm.value
			const tokenToSwap = form.disputeTokenToSwap === 'token1' ? reportDetails.token1 : reportDetails.token2
			return await disputeOracleReport(
				createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
				resolveOpenOracleAddress(),
				reportDetails.reportId,
				tokenToSwap,
				parseBigIntInput(form.disputeNewAmount1, 'New token1 amount'),
				parseBigIntInput(form.disputeNewAmount2, 'New token2 amount'),
				reportDetails.currentAmount2,
				reportDetails.stateHash,
			)
		}, 'Failed to dispute report')

	return {
		approveToken1,
		approveToken2,
		disputeReport,
		loadOracleManager,
		loadOracleReport,
		loadingOracleManager: loadingOracleManager.value,
		loadingOracleReport: loadingOracleReport.value,
		onRequestPrice: requestPrice,
		onQueueOperation: queueOperation,
		openOracleError: openOracleError.value,
		openOracleForm: openOracleForm.value,
		openOracleReportDetails: openOracleReportDetails.value,
		openOracleResult: openOracleResult.value,
		oracleManagerDetails: oracleManagerDetails.value,
		setOpenOracleForm: (updater: (current: OpenOracleFormState) => OpenOracleFormState) => {
			openOracleForm.value = updater(openOracleForm.value)
		},
		settleReport,
		submitInitialReport,
	}
}
