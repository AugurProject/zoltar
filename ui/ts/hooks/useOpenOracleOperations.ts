import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { approveErc20, createOpenOracleReportInstance, getOpenOracleAddress, loadOpenOracleGameDetails, loadOpenOracleGames as readOpenOracleGames, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBooleanInput, parseBytes32Input, parseBytes4Input, parseReportIdInput } from '../lib/inputs.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleReportFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { OpenOracleCreateFormState, OpenOracleReportFormState } from '../types/app.js'
import type { OpenOracleActionResult, OpenOracleGameSummary } from '../types/contracts.js'
import { runWriteAction } from '../lib/writeAction.js'

type UseOpenOracleOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

async function readOpenOracleGame(reportId: bigint, cachedGames: OpenOracleGameSummary[]) {
	const cachedGame = cachedGames.find(game => game.reportId === reportId)
	if (cachedGame !== undefined) return cachedGame
	return await loadOpenOracleGameDetails(createConnectedReadClient(), reportId)
}

export function useOpenOracleOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters) {
	const loadingOpenOracleGames = useSignal(false)
	const openOracleCreateForm = useSignal<OpenOracleCreateFormState>(getDefaultOpenOracleCreateFormState())
	const openOracleError = useSignal<string | undefined>(undefined)
	const openOracleGames = useSignal<OpenOracleGameSummary[]>([])
	const openOracleNextReportId = useSignal<bigint | undefined>(undefined)
	const openOracleReportForm = useSignal<OpenOracleReportFormState>(getDefaultOpenOracleReportFormState())
	const openOracleResult = useSignal<OpenOracleActionResult | undefined>(undefined)

	const loadOpenOracleGames = async () => {
		loadingOpenOracleGames.value = true
		openOracleError.value = undefined
		try {
			const { games, nextReportId } = await readOpenOracleGames(createConnectedReadClient())
			openOracleGames.value = games
			openOracleNextReportId.value = nextReportId
		} catch (error) {
			openOracleError.value = getErrorMessage(error, 'Failed to load Open Oracle games')
		} finally {
			loadingOpenOracleGames.value = false
		}
	}

	const loadReportGame = async (reportId: bigint) => {
		openOracleError.value = undefined
		try {
			const game = await readOpenOracleGame(reportId, openOracleGames.value)
			openOracleReportForm.value = {
				...openOracleReportForm.value,
				amount1: game.exactToken1Report.toString(),
				amount2: game.currentAmount2.toString(),
				reportId: game.reportId.toString(),
				stateHash: game.stateHash,
			}
		} catch (error) {
			openOracleError.value = getErrorMessage(error, 'Failed to load Open Oracle game')
		}
	}

	const runOpenOracleAction = async (action: (walletAddress: Address) => Promise<OpenOracleActionResult>, errorFallback: string, refreshGames: boolean = false) =>
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before using Open Oracle',
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
				if (refreshGames) {
					await loadOpenOracleGames()
				}
			},
		)

	const createGame = async () =>
		await runOpenOracleAction(
			async walletAddress =>
				await createOpenOracleReportInstance(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), {
					callbackContract: parseAddressInput(openOracleCreateForm.value.callbackContract, 'Callback contract'),
					callbackGasLimit: Number(parseBigIntInput(openOracleCreateForm.value.callbackGasLimit, 'Callback gas limit')),
					callbackSelector: parseBytes4Input(openOracleCreateForm.value.callbackSelector, 'Callback selector'),
					disputeDelay: Number(parseBigIntInput(openOracleCreateForm.value.disputeDelay, 'Dispute delay')),
					escalationHalt: parseBigIntInput(openOracleCreateForm.value.escalationHalt, 'Escalation halt'),
					exactToken1Report: parseBigIntInput(openOracleCreateForm.value.exactToken1Report, 'Exact token1 report'),
					feePercentage: Number(parseBigIntInput(openOracleCreateForm.value.feePercentage, 'Fee percentage')),
					feeToken: parseBooleanInput(openOracleCreateForm.value.feeToken, 'Fee token'),
					keepFee: parseBooleanInput(openOracleCreateForm.value.keepFee, 'Keep fee'),
					multiplier: Number(parseBigIntInput(openOracleCreateForm.value.multiplier, 'Multiplier')),
					protocolFee: Number(parseBigIntInput(openOracleCreateForm.value.protocolFee, 'Protocol fee')),
					protocolFeeRecipient: parseAddressInput(openOracleCreateForm.value.protocolFeeRecipient, 'Protocol fee recipient'),
					settlementTime: Number(parseBigIntInput(openOracleCreateForm.value.settlementTime, 'Settlement time')),
					settlerReward: parseBigIntInput(openOracleCreateForm.value.settlerReward, 'Settler reward'),
					timeType: parseBooleanInput(openOracleCreateForm.value.timeType, 'Time type'),
					token1Address: parseAddressInput(openOracleCreateForm.value.token1Address, 'Token1 address'),
					token2Address: parseAddressInput(openOracleCreateForm.value.token2Address, 'Token2 address'),
					trackDisputes: parseBooleanInput(openOracleCreateForm.value.trackDisputes, 'Track disputes'),
					value: parseBigIntInput(openOracleCreateForm.value.transactionValue, 'Transaction value'),
				}),
			'Failed to create Open Oracle game',
			true,
		)

	const approveToken1 = async () =>
		await runOpenOracleAction(async walletAddress => {
			const reportId = parseReportIdInput(openOracleReportForm.value.reportId)
			const game = await readOpenOracleGame(reportId, openOracleGames.value)
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), game.token1, getOpenOracleAddress(), parseBigIntInput(openOracleReportForm.value.amount1, 'Token1 amount'), 'approveToken1')
		}, 'Failed to approve token1')

	const approveToken2 = async () =>
		await runOpenOracleAction(async walletAddress => {
			const reportId = parseReportIdInput(openOracleReportForm.value.reportId)
			const game = await readOpenOracleGame(reportId, openOracleGames.value)
			return await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), game.token2, getOpenOracleAddress(), parseBigIntInput(openOracleReportForm.value.amount2, 'Token2 amount'), 'approveToken2')
		}, 'Failed to approve token2')

	const submitInitialReport = async () =>
		await runOpenOracleAction(
			async walletAddress =>
				await submitInitialOracleReport(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					parseReportIdInput(openOracleReportForm.value.reportId),
					parseBigIntInput(openOracleReportForm.value.amount1, 'Token1 amount'),
					parseBigIntInput(openOracleReportForm.value.amount2, 'Token2 amount'),
					parseBytes32Input(openOracleReportForm.value.stateHash, 'State hash'),
				),
			'Failed to submit initial report',
			true,
		)

	const settleReport = async () => await runOpenOracleAction(async walletAddress => await settleOracleReport(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseReportIdInput(openOracleReportForm.value.reportId)), 'Failed to settle report', true)

	return {
		accountAddress,
		approveToken1,
		approveToken2,
		createGame,
		loadOpenOracleGames,
		loadReportGame,
		loadingOpenOracleGames: loadingOpenOracleGames.value,
		openOracleAddress: getOpenOracleAddress(),
		openOracleCreateForm: openOracleCreateForm.value,
		openOracleError: openOracleError.value,
		openOracleGames: openOracleGames.value,
		nextReportId: openOracleNextReportId.value,
		openOracleReportForm: openOracleReportForm.value,
		openOracleResult: openOracleResult.value,
		setOpenOracleCreateForm: (updater: (current: OpenOracleCreateFormState) => OpenOracleCreateFormState) => {
			openOracleCreateForm.value = updater(openOracleCreateForm.value)
		},
		setOpenOracleReportForm: (updater: (current: OpenOracleReportFormState) => OpenOracleReportFormState) => {
			openOracleReportForm.value = updater(openOracleReportForm.value)
		},
		settleReport,
		submitInitialReport,
	}
}
