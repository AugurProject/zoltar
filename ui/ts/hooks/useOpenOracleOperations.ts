import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { approveErc20, loadOracleManagerDetails, requestOraclePrice, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, createWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBytes32Input, parseReportIdInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleActionResult, OracleManagerDetails } from '../types/contracts.js'

type UseOpenOracleOperationsParameters = {
	accountAddress: Address | null
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useOpenOracleOperations({ accountAddress, onTransaction, refreshState }: UseOpenOracleOperationsParameters) {
	const [loadingOracleManager, setLoadingOracleManager] = useState(false)
	const [openOracleError, setOpenOracleError] = useState<string | null>(null)
	const [openOracleForm, setOpenOracleForm] = useState<OpenOracleFormState>(() => getDefaultOpenOracleFormState())
	const [openOracleResult, setOpenOracleResult] = useState<OpenOracleActionResult | null>(null)
	const [oracleManagerDetails, setOracleManagerDetails] = useState<OracleManagerDetails | null>(null)

	const loadOracleManager = async () => {
		setLoadingOracleManager(true)
		setOpenOracleError(null)
		try {
			const managerAddress = parseAddressInput(openOracleForm.managerAddress, 'Manager address')
			const details = await loadOracleManagerDetails(createReadClient(), managerAddress)
			setOracleManagerDetails(details)
			setOpenOracleForm(current => ({
				...current,
				amount1: details.exactToken1Report?.toString() ?? current.amount1,
				reportId: details.pendingReportId === 0n ? current.reportId : details.pendingReportId.toString(),
				stateHash: details.callbackStateHash ?? current.stateHash,
			}))
		} catch (error) {
			setOracleManagerDetails(null)
			setOpenOracleError(getErrorMessage(error, 'Failed to load oracle manager'))
		} finally {
			setLoadingOracleManager(false)
		}
	}

	const runOracleAction = async (action: (walletAddress: Address) => Promise<OpenOracleActionResult>, errorFallback: string) => {
		if (accountAddress === null) {
			setOpenOracleError('Connect a wallet before operating open oracle')
			return
		}

		try {
			setOpenOracleError(null)
			setOpenOracleResult(null)
			const result = await action(accountAddress)
			setOpenOracleResult(result)
			onTransaction(result.hash)
			await refreshState()
			if (openOracleForm.managerAddress.trim() !== '') {
				await loadOracleManager()
			}
		} catch (error) {
			setOpenOracleError(getErrorMessage(error, errorFallback))
		}
	}

	const approveToken1 = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getInjectedEthereum()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			const details = oracleManagerDetails
			if (details?.token1 === null || details?.token1 === undefined) throw new Error('Load an oracle report first')
			return await approveErc20(createWriteClient(ethereum, walletAddress), details.token1, details.openOracleAddress, parseBigIntInput(openOracleForm.amount1, 'Token1 amount'), 'approveToken1')
		}, 'Failed to approve token1')

	const approveToken2 = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getInjectedEthereum()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			const details = oracleManagerDetails
			if (details?.token2 === null || details?.token2 === undefined) throw new Error('Load an oracle report first')
			return await approveErc20(createWriteClient(ethereum, walletAddress), details.token2, details.openOracleAddress, parseBigIntInput(openOracleForm.amount2, 'Token2 amount'), 'approveToken2')
		}, 'Failed to approve token2')

	const requestPrice = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getInjectedEthereum()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			const details = oracleManagerDetails ?? (await loadOracleManagerDetails(createReadClient(), parseAddressInput(openOracleForm.managerAddress, 'Manager address')))
			return await requestOraclePrice(createWriteClient(ethereum, walletAddress), details.managerAddress, details.requestPriceEthCost)
		}, 'Failed to request price')

	const submitInitialReport = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getInjectedEthereum()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			return await submitInitialOracleReport(createWriteClient(ethereum, walletAddress), parseReportIdInput(openOracleForm.reportId), parseBigIntInput(openOracleForm.amount1, 'Token1 amount'), parseBigIntInput(openOracleForm.amount2, 'Token2 amount'), parseBytes32Input(openOracleForm.stateHash, 'State hash'))
		}, 'Failed to submit initial report')

	const settleReport = async () =>
		await runOracleAction(async walletAddress => {
			const ethereum = getInjectedEthereum()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			return await settleOracleReport(createWriteClient(ethereum, walletAddress), parseReportIdInput(openOracleForm.reportId))
		}, 'Failed to settle report')

	return {
		approveToken1,
		approveToken2,
		loadOracleManager,
		loadingOracleManager,
		onRequestPrice: requestPrice,
		openOracleError,
		openOracleForm,
		openOracleResult,
		oracleManagerDetails,
		setOpenOracleForm,
		settleReport,
		submitInitialReport,
	}
}
