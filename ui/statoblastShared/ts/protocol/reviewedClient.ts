import { reviewErrors } from '../copy/protocolErrors.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import { getTransactionReviewSignal } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { decodeFunctionData, getAddress, encodeFunctionData, maxUint256, parseTransaction, recoverTransactionAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { TransactionPlanStep, TransactionRequestPreview, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage, isRecoverableContractReadError, transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getPreparedTransactionTechnicalRows, humanizeTransactionAction } from '@zoltar/ui-core-shared/transactions/transactionPreviewRows.js'
import { createTransactionStepController, type TransactionStepDetails } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { createTransactionFailure, createTransactionFailureError } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'
import * as reviewCopy from '../copy/app.js'
import { withStatoblastRequestTimeout } from './requestTimeout.js'

const checkedReviewClients = new WeakSet<WriteClient>()

export function checksTransactionReview(client: WriteClient) {
	return checkedReviewClients.has(client)
}

function retryReviewStatus(error: unknown) {
	if (error instanceof Error) {
		if (error.message === transactionCopy.currentStateCheckFailed) return 'failed'
		if (error.message === reviewCopy.changedSinceReview) return 'changed'
	}
	return undefined
}

async function describeTransaction(client: WriteClient, preview: TransactionRequestPreview & Pick<TransactionPlanStep, 'optional' | 'tokenFunding' | 'oracleOutcome' | 'approvalPurpose'>, requiredApprovalAmount?: bigint): Promise<TransactionStepDetails> {
	const action = transactionCopy.reviewedActions[preview.functionName]
	const details: TransactionStepDetails = {
		proposedRepPerEthPrice: preview.functionName === 'requestPrice' && typeof preview.args?.[0] === 'bigint' ? preview.args[0] : undefined,
		optional: preview.optional ?? false,
		oracleOutcome: preview.oracleOutcome,
		tokenFunding: await Promise.all(
			(preview.tokenFunding ?? []).map(async funding => {
				try {
					const [symbol, decimals] = await Promise.all([client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'symbol' }), client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'decimals' })])
					return { amount: funding.amount, tokenSymbol: symbol, tokenUnits: Number(decimals) }
				} catch (error) {
					throw new Error(reviewErrors.fundingEstimate, { cause: error })
				}
			}),
		),
		title: preview.reviewTitle ?? action?.title ?? humanizeTransactionAction(preview.functionName),
		description: preview.reviewDescription ?? action?.description,
		contractAddress: preview.contractAddress ?? preview.to,
		contractLabel: preview.contractLabel ?? preview.toLabel,
		spender: undefined,
		amount: undefined,
		ethValueAttoEth: preview.value,
	}
	if (preview.functionName === 'depositRepOnOutcome' || preview.functionName === 'depositRepOnOutcomeWithLead' || preview.functionName === 'depositWalletRepToEscalationGame' || preview.functionName === 'depositWalletRepToEscalationGameWithLead') {
		const [outcome, amount] = preview.args ?? []
		if (typeof amount !== 'bigint' || (outcome !== 0 && outcome !== 1 && outcome !== 2 && outcome !== 0n && outcome !== 1n && outcome !== 2n)) throw new Error(reviewErrors.reportingDeposit)
		let label = commonCopy.no
		if (outcome === 0 || outcome === 0n) label = commonCopy.invalid
		if (outcome === 1 || outcome === 1n) label = commonCopy.yes
		details.title = preview.reviewTitle ?? transactionCopy.reportingAction(label, formatCurrencyBalance(amount))
		details.amount = preview.reviewAmount ?? formatCurrencyBalanceWithUnit(amount, commonCopy.rep)
		details.paidFrom = transactionCopy.walletRep
	}
	if (preview.functionName === 'settle') details.title = transactionCopy.settleReportNumber(String(preview.args?.[0] ?? ''))
	if (preview.functionName === 'withdrawFromEscalationGame') details.title = preview.reviewTitle ?? transactionCopy.settleEscalationDeposits
	if (preview.functionName !== 'approve' || preview.contractAddress === undefined) return details
	const [spender, amount] = preview.args ?? []
	if (typeof spender !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(spender) || typeof amount !== 'bigint') throw new Error(reviewErrors.tokenApproval)
	details.spender = getAddress(spender)
	details.title = reviewCopy.approveSpendingTitle
	details.description = reviewCopy.approveSpendingDescription
	details.amount = reviewCopy.approvalInBaseUnits(amount)
	try {
		const [symbol, decimals] = await Promise.all([client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'symbol' }), client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'decimals' })])
		const formatApprovalAmount = (value: bigint) => (value === maxUint256 ? commonCopy.max : formatCurrencyBalance(value, Number(decimals)))
		details.title = commonCopy.formatApproveTokenAmount(formatApprovalAmount(amount), symbol)
		details.amount = formatValueWithUnit(formatApprovalAmount(amount), symbol)
		if (requiredApprovalAmount !== undefined) {
			const approvedAmount = await client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, details.spender] })
			details.approval = { purpose: preview.approvalPurpose, requiredAmount: requiredApprovalAmount, recommendedAmount: amount > requiredApprovalAmount ? amount : undefined, approvedAmount, tokenSymbol: symbol, tokenUnits: Number(decimals) }
			details.amount = formatValueWithUnit(formatApprovalAmount(requiredApprovalAmount), symbol)
		}
	} catch (error) {
		throw new Error(reviewErrors.tokenDetails, { cause: error })
	}
	return details
}

export function createReviewedClient(baseClient: WriteClient, validate: () => Promise<void> = async () => undefined, signal = getTransactionReviewSignal(), registerBeforeSubmit?: (assertActive: () => void) => void, alwaysReview = false): WriteClient {
	const client = alwaysReview ? withStatoblastRequestTimeout(baseClient, transactionCopy.currentStateCheckFailed) : baseClient
	let controller = createTransactionStepController(signal, false)
	const environment = createActiveEnvironmentGuard()
	// The injected backend can await wallet validation after our final review checks.
	// Close over the current controller because initialization replaces it.
	registerBeforeSubmit?.(() => {
		if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
		controller.assertActive()
	})
	const requiresReview = () => alwaysReview || (plan?.length ?? 0) > 1 || (plan?.some(step => step.requireReview) ?? false)
	let preview: TransactionRequestPreview | undefined
	let plan: readonly TransactionPlanStep[] | undefined
	let stepIndex = 0
	let partialApproval = false
	let initialized = false
	let selectedFunding: { index: number; amount: bigint | undefined } | undefined
	const initialize = async () => {
		if (!initialized) {
			if (plan === undefined) throw new Error(reviewErrors.planMissing)
			// Multi-transaction actions expose a separate control for every write, including the first funding step.
			controller = createTransactionStepController(signal, requiresReview(), alwaysReview)
			controller.setPlan(
				await Promise.all(
					plan.map(step =>
						describeTransaction(
							client,
							{ account: client.account, args: undefined, chainName: client.chain.name, value: undefined, ...step },
							step.requiredApprovalAmount ?? plan?.find(candidate => candidate.tokenFunding !== undefined && (candidate.fundingSpender ?? candidate.contractAddress) === step.args?.[0])?.tokenFunding?.find(funding => funding.tokenAddress === step.contractAddress)?.amount,
						),
					),
				),
			)
			initialized = true
		}
	}

	const checkTransaction = async (transaction: TransactionRequestPreview, step: TransactionPlanStep, gas: bigint | undefined, raw = false) => {
		await validate()
		await step.validateBeforeSubmit?.()
		controller.assertActive()
		if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
		if (!raw) return await client.call({ account: client.account, to: transaction.contractAddress ?? transaction.to, data: transaction.data, value: transaction.value, gas })
		if (transaction.data === undefined) throw new Error(reviewErrors.deploymentMissing)
		const signed = parseTransaction(transaction.data)
		const signer = await recoverTransactionAddress({ serializedTransaction: transaction.data })
		return await client.call({ account: signer, to: signed.to ?? undefined, data: signed.data, value: signed.value, gas: signed.gas })
	}
	const send = async (
		fallback: TransactionRequestPreview,
		execute: (approvalArgs?: readonly [ReturnType<typeof getAddress>, bigint], gas?: bigint, data?: TransactionRequestPreview['data']) => Promise<`0x${string}`>,
		requestedGas?: bigint,
		options?: { raw?: boolean; readReviewArgs?: (data: Hex) => readonly unknown[] | undefined },
	) => {
		const prepared = preview
		const funding = selectedFunding
		selectedFunding = undefined
		let transaction = prepared ?? fallback
		let gas = requestedGas
		preview = undefined
		try {
			if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
			controller.assertActive()
			if (!alwaysReview) await validate()
			plan ??= [transaction]
			if (prepared !== undefined && (prepared.data !== fallback.data || (prepared.contractAddress ?? prepared.to)?.toLowerCase() !== (fallback.contractAddress ?? fallback.to)?.toLowerCase() || (prepared.value ?? 0n) !== (fallback.value ?? 0n))) throw new Error(reviewErrors.preparedChanged)
			await initialize()
			const expected = plan?.[stepIndex]
			if (expected === undefined || expected.functionName !== transaction.functionName || (expected.value ?? 0n) !== (transaction.value ?? 0n) || (expected.contractAddress ?? expected.to) !== (transaction.contractAddress ?? transaction.to)) throw new Error(reviewErrors.planChanged)
			if (transaction.functionName === 'approve' && (expected.args?.[0] !== transaction.args?.[0] || expected.args?.[1] !== transaction.args?.[1])) throw new Error(reviewErrors.approvalChanged)
			const check = (candidate: TransactionRequestPreview) => checkTransaction(candidate, expected, gas, options?.raw)
			if (alwaysReview) controller.setTechnicalRows(stepIndex, [...getPreparedTransactionTechnicalRows(transaction), { label: appCopy.network, value: client.chain.name }])
			let reviewedRows: ReturnType<NonNullable<TransactionPlanStep['readReviewRows']>> | undefined
			let checkedAt = 0
			const readRows = () => {
				const rows = expected.readReviewRows?.()
				if (rows !== undefined) controller.setReviewRows(stepIndex, rows)
				return rows
			}
			let originalTransaction = transaction
			let approvalArgs: readonly [ReturnType<typeof getAddress>, bigint] | undefined
			const prepareToSend = async (selectedAmount: bigint | undefined) => {
				approvalArgs = undefined
				partialApproval = false
				transaction = originalTransaction
				gas = requestedGas
				if (selectedAmount !== undefined) {
					const [spender] = transaction.args ?? []
					if (transaction.functionName !== 'approve' || typeof spender !== 'string' || selectedAmount < 0n || selectedAmount > maxUint256) throw new Error(reviewErrors.approvalSelection)
					approvalArgs = [getAddress(spender), selectedAmount]
					const requiredAmount =
						expected.requiredApprovalAmount ??
						plan
							?.filter(step => (step.fundingSpender ?? step.contractAddress) === spender)
							.flatMap(step => step.tokenFunding ?? [])
							.find(funding => funding.tokenAddress === transaction.contractAddress)?.amount
					partialApproval = requiredAmount !== undefined && selectedAmount < requiredAmount
					transaction = { ...transaction, args: approvalArgs, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs }) }
				}
				controller.assertActive()
				await validate()
				if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
				if (transaction.functionName === 'requestPrice') {
					const gasPrice = await client.getGasPrice()
					const estimate = await client.estimateGas({ account: client.account, to: transaction.contractAddress, data: transaction.data, value: transaction.value, gasPrice: gasPrice > 0n ? gasPrice : 1n })
					// Reserve execution headroom for refunds and nested calls when an RPC returns gas spent instead of the minimum successful limit.
					const bufferedGas = (estimate * 150n + 99n) / 100n
					if (gas === undefined || gas < bufferedGas) gas = bufferedGas
					await validate()
					if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
					controller.assertActive()
				}
				const currentFunding = await expected.refreshFundingRequirements?.()
				for (const funding of currentFunding ?? expected.tokenFunding ?? []) {
					const spender = expected.fundingSpender ?? expected.contractAddress
					if (spender === undefined) throw new Error(reviewCopy.missingTokenSpender)
					const [balance, allowance] = await Promise.all([
						client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [client.account.address] }),
						client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, spender] }),
					])
					if (balance < funding.amount || allowance < funding.amount) throw new Error(reviewErrors.fundingChanged)
				}
				if (expected.tokenFunding !== undefined) await validate()
				if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
				controller.assertActive()
				if (alwaysReview && (approvalArgs !== undefined || funding !== undefined)) await check(transaction)
				else if (expected.validateBeforeSubmit !== undefined) {
					const validation = expected.validateBeforeSubmit()
					if (alwaysReview) await validation
					else await withTimeout(validation, 15_000, transactionCopy.currentStateCheckFailed)
				}
				if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
				controller.assertActive()
			}

			const review = (initialError?: Error) =>
				controller.review(stepIndex, {
					deferWallet: true,
					initialError,
					check: async retrying => {
						if (retrying && expected.refreshReviewData !== undefined) {
							const data = await expected.refreshReviewData()
							const args = options?.readReviewArgs === undefined ? originalTransaction.args : options.readReviewArgs(data)
							originalTransaction = { ...originalTransaction, args, data }
							controller.setTechnicalRows(stepIndex, [...getPreparedTransactionTechnicalRows(originalTransaction), { label: appCopy.network, value: client.chain.name }])
						}
						await check(originalTransaction)
						reviewedRows = readRows()
						checkedAt = performance.now()
					},
					recheck: async amount => {
						if (performance.now() - checkedAt > 30_000) {
							await check(originalTransaction)
							const currentRows = readRows()
							if (reviewedRows !== undefined && currentRows !== undefined && (reviewedRows.length !== currentRows.length || reviewedRows.some((row, index) => row.label !== currentRows[index]?.label || row.value !== currentRows[index]?.value))) throw new Error(reviewCopy.changedSinceReview)
						}
						await prepareToSend(amount)
					},
					retryStatus: retryReviewStatus,
				})
			if (alwaysReview) {
				if (funding === undefined) await review()
				else {
					try {
						await prepareToSend(funding.amount)
					} catch (error) {
						// This check runs before opening the wallet. A submitted transaction must never be retried here.
						if (!(error instanceof Error) || retryReviewStatus(error) === undefined) throw error
						await review(error)
					}
				}
			} else {
				let selectedAmount = funding?.amount
				if (funding === undefined) {
					readRows()
					selectedAmount = requiresReview() ? await controller.review(stepIndex) : controller.startWithoutReview(stepIndex)
				}
				await prepareToSend(selectedAmount)
			}
			stepIndex += 1
			controller.openWallet()
			client.onTransactionPrepared?.(transaction)
			const hash = await execute(approvalArgs, gas, transaction.data)
			controller.submitted(hash)
			return hash
		} catch (error) {
			controller.failed(createTransactionFailure(error, getErrorMessage(error, reviewErrors.transactionFailed)))
			throw error
		}
	}
	const reviewedClient: WriteClient = {
		...client,
		onTransactionPlan: steps => {
			if (initialized) throw new Error(reviewErrors.planStarted)
			plan = steps
		},
		runFundingTransaction: async (requiredIndices, execute) => {
			try {
				if (!environment.isCurrent()) throw new Error(reviewErrors.networkChanged)
				controller.assertActive()
				if (!alwaysReview) await validate()
				await initialize()
				let initialError: Error | undefined
				while (true) {
					selectedFunding = await controller.chooseFunding(
						requiredIndices,
						!requiresReview() && plan?.length === 1,
						alwaysReview
							? {
									deferWallet: true,
									initialError,
									retryStatus: retryReviewStatus,
									check: async () => {
										await Promise.all(
											requiredIndices.map(async index => {
												const step = plan?.[index]
												if (step === undefined) throw new Error(reviewErrors.fundingMissing)
												const transaction = { account: client.account, args: undefined, chainName: client.chain.name, value: undefined, ...step }
												controller.setTechnicalRows(index, [...getPreparedTransactionTechnicalRows(transaction), { label: appCopy.network, value: client.chain.name }])
												await checkTransaction(transaction, step, undefined)
												const rows = step.readReviewRows?.()
												if (rows !== undefined) controller.setReviewRows(index, rows)
											}),
										)
									},
								}
							: undefined,
					)
					stepIndex = selectedFunding?.index ?? (plan?.length ?? 1) - 1
					if (selectedFunding === undefined) return false
					try {
						await execute(selectedFunding.index)
					} catch (error) {
						// The selection is consumed as soon as send starts. Only retry work that failed before that point.
						if (!alwaysReview || selectedFunding === undefined || !(error instanceof Error) || retryReviewStatus(error) === undefined) throw error
						initialError = error
						selectedFunding = undefined
						preview = undefined
						continue
					}
					if (selectedFunding !== undefined) {
						selectedFunding = undefined
						controller.skipped()
					}
					return true
				}
			} catch (error) {
				selectedFunding = undefined
				controller.failed(createTransactionFailure(error, getErrorMessage(error, reviewErrors.fundingFailed)))
				throw error
			}
		},
		onTransactionPrepared: next => {
			preview = next
		},
		sendTransaction: async parameters =>
			await send(
				{ account: client.account, args: undefined, chainName: client.chain.name, data: parameters.data, functionName: parameters.data === undefined ? reviewCopy.transferEthTitle : reviewCopy.contractTransactionTitle, to: parameters.to ?? undefined, value: parameters.value },
				async (approvalArgs, gas, data) => await client.sendTransaction({ ...parameters, ...(gas === undefined ? {} : { gas }), ...(data === undefined ? {} : { data }), ...(approvalArgs === undefined ? {} : { data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs }) }) }),
				parameters.gas,
			),
		sendRawTransaction: async parameters => await send({ account: undefined, args: undefined, chainName: client.chain.name, functionName: reviewCopy.deployContractTitle, data: parameters.serializedTransaction, value: undefined }, async () => await client.sendRawTransaction(parameters), undefined, { raw: true }),
		writeContract: async parameters => {
			const encodedData = encodeFunctionData({ abi: parameters.abi, functionName: parameters.functionName, ...(parameters.args === undefined ? {} : { args: parameters.args }) })
			return await send(
				{
					account: client.account,
					args: parameters.args,
					chainName: client.chain.name,
					functionName: parameters.functionName,
					contractAddress: parameters.address,
					value: parameters.value,
					data: encodedData,
				},
				async (approvalArgs, gas, data) => {
					const call = { ...parameters, ...(gas === undefined ? {} : { gas }) }
					if (approvalArgs !== undefined) return await client.writeContract({ ...call, abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs })
					if (data !== undefined && data !== encodedData) return await client.sendTransaction({ account: parameters.account, to: parameters.address, data, value: parameters.value, gas })
					return await client.writeContract(call)
				},
				parameters.gas,
				{
					readReviewArgs: data => {
						const decoded = decodeFunctionData({ abi: parameters.abi, data })
						if (decoded.functionName !== parameters.functionName) throw new Error(reviewErrors.preparedChanged)
						return decoded.args
					},
				},
			)
		},
		waitForTransactionReceipt: async parameters => {
			let diagnosedReceiptFailure = false
			try {
				let replaced = false
				let confirmedHash = parameters.hash
				const receipt = await client.waitForTransactionReceipt({
					...parameters,
					onReplaced: replacement => {
						replaced = replacement.reason === 'cancelled' || replacement.reason === 'replaced'
						confirmedHash = replacement.transaction.hash
						controller.submitted(confirmedHash, replacement.reason === 'repriced')
						parameters.onReplaced?.(replacement)
					},
				})
				if (replaced) throw createTransactionFailureError('replaced', transactionErrorMessages.canceledOrReplaced)
				controller.receipt(confirmedHash, receipt.status)
				if (receipt.status === 'reverted') {
					let exhaustedGas = false
					try {
						const submitted = await client.getTransaction({ hash: confirmedHash })
						exhaustedGas = receipt.gasUsed >= submitted.gas
					} catch (error) {
						if (!isRecoverableContractReadError(error)) throw error
						// Keep the receipt failure and hash if the diagnostic read is unavailable.
					}
					if (exhaustedGas) {
						diagnosedReceiptFailure = true
						const message = transactionErrorMessages.fullGasLimit
						controller.failed({ kind: 'reverted', message })
						throw createTransactionFailureError('reverted', message)
					}
				}
				if (partialApproval && receipt.status === 'success') {
					diagnosedReceiptFailure = true
					const message = transactionErrorMessages.insufficientApproval
					controller.failed({ kind: 'error', message })
					throw new Error(message)
				}
				return receipt
			} catch (error) {
				if (!diagnosedReceiptFailure) controller.failed(createTransactionFailure(error, getErrorMessage(error, transactionErrorMessages.confirmationUnavailable)))
				throw error
			}
		},
	}
	if (alwaysReview) checkedReviewClients.add(reviewedClient)
	return reviewedClient
}
