import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getTransactionReviewSignal } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { formatUnits, getAddress, encodeFunctionData, maxUint256 } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionPlanStep, TransactionRequestPreview, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage, isRecoverableContractReadError, transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { humanizeTransactionAction } from '@zoltar/ui-core-shared/transactions/transactionPresentations.js'
import { createTransactionStepController, type TransactionStepDetails } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'

const actionDescriptions: Record<string, { title: string; description: string }> = {
	'Transfer ETH': { title: 'Transfer ETH', description: 'Send ETH from your wallet to the recipient below.' },
	'Fund deterministic proxy deployer signer without surplus': { title: 'Fund proxy deployment', description: 'Provide ETH for deploying the shared proxy. Unused funding is returned in this transaction.' },
	'Broadcast deterministic proxy deployer transaction': { title: 'Deploy shared proxy', description: 'Broadcast the signed proxy deployment. If the signer needs ETH, this attempt sends nothing; fund it and retry in the following steps.' },
	deposit: { title: 'Wrap ETH into WETH', description: 'Convert ETH into WETH held in your wallet to fund the oracle report.' },
	requestPrice: { title: 'Request price', description: 'Fund and start an oracle price report using your approved REP and WETH.' },
	report: { title: 'Create oracle report', description: 'Deposit the approved tokens and start the oracle report.' },
	requestPriceIfNeededAndStageLiquidation: { title: 'Queue liquidation', description: 'Queue the liquidation and fund a price report if needed. Settlement may execute the queued liquidation.' },
	requestPriceIfNeededAndStageOperation: { title: 'Queue vault operation', description: 'Queue the vault change and fund a price report if needed. Settlement may execute the queued change.' },
	aggregate3: { title: 'Batched transaction', description: 'Run several contract calls in one transaction.' },
}

async function describeTransaction(client: WriteClient, preview: TransactionRequestPreview & Pick<TransactionPlanStep, 'optional' | 'tokenFunding' | 'oracleOutcome'>, requiredApprovalAmount?: bigint): Promise<TransactionStepDetails> {
	const action = actionDescriptions[preview.functionName]
	const details: TransactionStepDetails = {
		proposedRepPerEthPrice: preview.functionName === 'requestPrice' && typeof preview.args?.[0] === 'bigint' ? preview.args[0] : undefined,
		optional: preview.optional ?? false,
		oracleOutcome: preview.oracleOutcome,
		tokenFunding: await Promise.all(
			(preview.tokenFunding ?? []).map(async funding => {
				try {
					const [symbol, decimals] = await Promise.all([client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'symbol' }), client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'decimals' })])
					return { amount: `${formatUnits(funding.amount, Number(decimals))} ${symbol}`, limit: funding.limit === undefined ? undefined : `${formatUnits(funding.limit, Number(decimals))} ${symbol}` }
				} catch (error) {
					throw new Error('Could not calculate report funding amounts. Retry before sending any transactions.', { cause: error })
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
	if (preview.functionName === 'requestPriceIfNeededAndStageOperation') {
		const operation = preview.args?.[0]
		if (operation === 1 || operation === 1n) details.title = 'Queue REP withdrawal'
		if (operation === 2 || operation === 2n) details.title = 'Queue backing adjustment'
	}
	if (preview.functionName !== 'approve' || preview.contractAddress === undefined) return details
	const [spender, amount] = preview.args ?? []
	if (typeof spender !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(spender) || typeof amount !== 'bigint') throw new Error('Cannot review this token approval.')
	details.spender = getAddress(spender)
	details.title = 'Approve token spending'
	details.description = 'Authorize the listed spending limit; tokens stay in your wallet.'
	details.amount = `${amount} token base units`
	try {
		const [symbol, decimals] = await Promise.all([client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'symbol' }), client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'decimals' })])
		details.title = `Approve ${symbol} spending`
		details.amount = `${amount === maxUint256 ? commonCopy.max : formatUnits(amount, Number(decimals))} ${symbol}`
		if (requiredApprovalAmount !== undefined) {
			const approvedAmount = await client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, details.spender] })
			details.approval = { requiredAmount: requiredApprovalAmount, approvedAmount, tokenSymbol: symbol, tokenUnits: Number(decimals) }
			details.amount = `${requiredApprovalAmount === maxUint256 ? commonCopy.max : formatUnits(requiredApprovalAmount, Number(decimals))} ${symbol}`
		}
	} catch (error) {
		throw new Error('Could not read token details for approval. Retry before sending any transactions.', { cause: error })
	}
	return details
}

export function createReviewedClient(client: WriteClient, validate: () => Promise<void> = async () => undefined, signal = getTransactionReviewSignal(), skipAppReview = false): WriteClient {
	const controller = createTransactionStepController(signal)
	const environment = createActiveEnvironmentGuard()
	let preview: TransactionRequestPreview | undefined
	let plan: readonly TransactionPlanStep[] | undefined
	let stepIndex = 0
	let partialApproval = false
	let initialized = false
	let selectedFunding: { index: number; amount: bigint | undefined } | undefined
	const initialize = async () => {
		if (!initialized) {
			if (plan === undefined) throw new Error('Missing transaction plan.')
			controller.setPlan(
				await Promise.all(
					plan.map(step =>
						describeTransaction(
							client,
							{ account: client.account, args: undefined, chainName: client.chain.name, value: undefined, ...step },
							plan?.find(candidate => candidate.tokenFunding !== undefined && candidate.contractAddress === step.args?.[0])?.tokenFunding?.find(funding => funding.tokenAddress === step.contractAddress)?.amount,
						),
					),
				),
			)
			initialized = true
		}
	}

	const send = async (fallback: TransactionRequestPreview, execute: (approvalArgs?: readonly [ReturnType<typeof getAddress>, bigint]) => Promise<`0x${string}`>) => {
		const prepared = preview
		let transaction = prepared ?? fallback
		preview = undefined
		try {
			if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
			controller.assertActive()
			await validate()
			plan ??= [transaction]
			if (skipAppReview) {
				if (prepared?.data === undefined || fallback.data === undefined) throw new Error('Wallet-only transactions must be prepared.')
				if (prepared.data !== fallback.data || (prepared.contractAddress ?? prepared.to)?.toLowerCase() !== (fallback.contractAddress ?? fallback.to)?.toLowerCase() || (prepared.value ?? 0n) !== (fallback.value ?? 0n)) throw new Error('The prepared transaction changed.')
				if (transaction.functionName === 'approve' || transaction.data?.slice(0, 10).toLowerCase() === '0x095ea7b3') throw new Error('Token approvals require app review.')
			}
			await initialize()
			const expected = plan?.[stepIndex]
			if (expected === undefined || expected.functionName !== transaction.functionName || (expected.value ?? 0n) !== (transaction.value ?? 0n) || (expected.contractAddress ?? expected.to) !== (transaction.contractAddress ?? transaction.to))
				throw new Error('The transaction plan changed. No further transactions were sent. Review the action again.')
			if (transaction.functionName === 'approve' && (expected.args?.[0] !== transaction.args?.[0] || expected.args?.[1] !== transaction.args?.[1])) throw new Error('The approval amount changed. Review the action again.')
			let selectedAmount = selectedFunding?.amount
			if (selectedFunding === undefined) {
				if (skipAppReview) controller.startWithoutReview(stepIndex)
				else selectedAmount = await controller.review(stepIndex)
			}
			selectedFunding = undefined
			let approvalArgs: readonly [ReturnType<typeof getAddress>, bigint] | undefined
			if (selectedAmount !== undefined) {
				const [spender] = transaction.args ?? []
				if (transaction.functionName !== 'approve' || typeof spender !== 'string' || selectedAmount < 0n || selectedAmount > maxUint256) throw new Error('Invalid token approval selection.')
				approvalArgs = [getAddress(spender), selectedAmount]
				const requiredAmount = plan?.flatMap(step => step.tokenFunding ?? []).find(funding => funding.tokenAddress === transaction.contractAddress)?.amount
				partialApproval = requiredAmount !== undefined && selectedAmount < requiredAmount
				transaction = { ...transaction, args: approvalArgs, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs }) }
			}
			stepIndex += 1
			controller.assertActive()
			await validate()
			if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
			const currentFunding = await expected.refreshFundingRequirements?.()
			for (const funding of currentFunding ?? expected.tokenFunding ?? []) {
				const spender = expected.contractAddress
				if (spender === undefined) throw new Error('Missing funding recipient.')
				const [balance, allowance] = await Promise.all([
					client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [client.account.address] }),
					client.readContract({ address: funding.tokenAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, spender] }),
				])
				if (balance < funding.amount || allowance < funding.amount) throw new Error('Funding requirements changed. Review balances and approvals again before sending.')
			}
			if (expected.tokenFunding !== undefined) await validate()
			if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
			controller.assertActive()
			if (transaction.functionName === 'requestPrice') {
				await client.estimateGas({ account: client.account, to: transaction.contractAddress, data: transaction.data, value: transaction.value })
				// This validates the direct call; the wallet must estimate any delegation wrapper itself.
				await validate()
				if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
				controller.assertActive()
			}
			client.onTransactionPrepared?.(transaction)
			const hash = await execute(approvalArgs)
			controller.submitted(hash)
			return hash
		} catch (error) {
			controller.failed(getErrorMessage(error, 'Transaction failed.'))
			throw error
		}
	}
	return {
		...client,
		onTransactionPlan: steps => {
			if (initialized) throw new Error('Cannot change a transaction plan after it has started.')
			plan = steps
		},
		runFundingTransaction: async (requiredIndices, execute) => {
			try {
				if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
				controller.assertActive()
				await validate()
				await initialize()
				selectedFunding = await controller.chooseFunding(requiredIndices)
				stepIndex = selectedFunding?.index ?? (plan?.length ?? 1) - 1
				if (selectedFunding === undefined) return false
				await execute(selectedFunding.index)
				if (selectedFunding !== undefined) {
					selectedFunding = undefined
					controller.skipped()
				}
				return true
			} catch (error) {
				controller.failed(getErrorMessage(error, 'Funding failed. Remaining transactions were not sent.'))
				throw error
			}
		},
		onTransactionPrepared: next => {
			preview = next
		},
		sendTransaction: async parameters =>
			await send(
				{ account: client.account, args: undefined, chainName: client.chain.name, data: parameters.data, functionName: parameters.data === undefined ? 'Transfer ETH' : 'Contract transaction', to: parameters.to ?? undefined, value: parameters.value },
				async approvalArgs => await client.sendTransaction(approvalArgs === undefined ? parameters : { ...parameters, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs }) }),
			),
		sendRawTransaction: async parameters => await send({ account: undefined, args: undefined, chainName: client.chain.name, functionName: 'Deploy contract', value: undefined }, async () => await client.sendRawTransaction(parameters)),
		writeContract: async parameters =>
			await send(
				{
					account: client.account,
					args: parameters.args,
					chainName: client.chain.name,
					functionName: parameters.functionName,
					contractAddress: parameters.address,
					value: parameters.value,
					data: encodeFunctionData({ abi: parameters.abi, functionName: parameters.functionName, ...(parameters.args === undefined ? {} : { args: parameters.args }) }),
				},
				async approvalArgs => (approvalArgs === undefined ? await client.writeContract(parameters) : await client.writeContract({ ...parameters, abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs })),
			),
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
						controller.submitted(confirmedHash)
						parameters.onReplaced?.(replacement)
					},
				})
				controller.receipt(confirmedHash, replaced ? 'reverted' : receipt.status)
				if (replaced) throw new Error(transactionErrorMessages.canceledOrReplaced)
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
						controller.failed(message)
						throw new Error(message)
					}
				}
				if (partialApproval && receipt.status === 'success') {
					diagnosedReceiptFailure = true
					const message = transactionErrorMessages.insufficientApproval
					controller.failed(message)
					throw new Error(message)
				}
				return receipt
			} catch (error) {
				if (!diagnosedReceiptFailure) controller.failed(getErrorMessage(error, transactionErrorMessages.confirmationUnavailable))
				throw error
			}
		},
	}
}
