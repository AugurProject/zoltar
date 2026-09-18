import { formatUnits, getAddress, encodeFunctionData, maxUint256 } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionPlanStep, TransactionRequestPreview, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createTransactionStepController, type TransactionStepDetails } from './transactionSteps.js'

const actionDescriptions: Record<string, { title: string; description: string }> = {
	'Transfer ETH': { title: 'Transfer ETH', description: 'Send ETH from your wallet to the recipient below.' },
	'Fund deterministic proxy deployer signer without surplus': { title: 'Fund proxy deployment', description: 'Provide ETH for deploying the shared proxy. Unused funding is returned in this transaction.' },
	'Broadcast deterministic proxy deployer transaction': { title: 'Deploy shared proxy', description: 'Broadcast the signed proxy deployment. If the signer needs ETH, this attempt sends nothing; fund it and retry in the following steps.' },
	deposit: { title: 'Wrap ETH into WETH', description: 'Convert ETH into WETH held in your wallet to fund the oracle report.' },
	requestPrice: { title: 'Request price', description: 'Fund and start an oracle price report using your approved REP and WETH.' },
	report: { title: 'Create oracle report', description: 'Deposit the approved tokens and start the oracle report.' },
	requestPriceIfNeededAndStageLiquidation: { title: 'Queue liquidation', description: 'Queue the liquidation and fund a price report if needed. Settlement may execute the queued liquidation.' },
	requestPriceIfNeededAndStageOperation: { title: 'Queue vault operation', description: 'Queue the vault change and fund a price report if needed. Settlement may execute the queued change.' },
}

async function describeTransaction(client: WriteClient, preview: TransactionRequestPreview & Pick<TransactionPlanStep, 'optional' | 'tokenFunding' | 'oracleOutcome'>, requiredApprovalAmount?: bigint): Promise<TransactionStepDetails> {
	const action = actionDescriptions[preview.functionName]
	const details: TransactionStepDetails = {
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
		title: action?.title ?? preview.functionName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, character => character.toUpperCase()),
		description: action?.description ?? `Submit this action to ${preview.contractLabel ?? preview.toLabel ?? 'the contract'}.`,
		contractAddress: preview.contractAddress ?? preview.to,
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
		details.amount = `${formatUnits(amount, Number(decimals))} ${symbol}`
		if (requiredApprovalAmount !== undefined) {
			const approvedAmount = await client.readContract({ address: preview.contractAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, details.spender] })
			details.approval = { requiredAmount: requiredApprovalAmount, approvedAmount, tokenSymbol: symbol, tokenUnits: Number(decimals) }
			details.amount = `${formatUnits(requiredApprovalAmount, Number(decimals))} ${symbol}`
		}
	} catch (error) {
		throw new Error('Could not read token details for approval. Retry before sending any transactions.', { cause: error })
	}
	return details
}

export function createReviewedClient(client: WriteClient, validate: () => Promise<void> = async () => undefined): WriteClient {
	const controller = createTransactionStepController()
	const environment = createActiveEnvironmentGuard()
	let preview: TransactionRequestPreview | undefined
	let plan: readonly TransactionPlanStep[] | undefined
	let stepIndex = 0
	let partialApproval = false
	const send = async (fallback: TransactionRequestPreview, execute: (approvalArgs?: readonly [ReturnType<typeof getAddress>, bigint]) => Promise<`0x${string}`>) => {
		let transaction = preview ?? fallback
		preview = undefined
		try {
			if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
			await validate()
			if (stepIndex === 0) {
				plan ??= [transaction]
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
			}
			const expected = plan?.[stepIndex]
			if (expected === undefined || expected.functionName !== transaction.functionName || (expected.value ?? 0n) !== (transaction.value ?? 0n) || (expected.contractAddress ?? expected.to) !== (transaction.contractAddress ?? transaction.to))
				throw new Error('The transaction plan changed. No further transactions were sent. Review the action again.')
			if (transaction.functionName === 'approve' && (expected.args?.[0] !== transaction.args?.[0] || expected.args?.[1] !== transaction.args?.[1])) throw new Error('The approval amount changed. Review the action again.')
			const selectedAmount = await controller.review()
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
			await validate()
			if (!environment.isCurrent()) throw new Error('The network changed. Review the action again.')
			client.onTransactionPrepared?.(transaction)
			const hash = await execute(approvalArgs)
			controller.submitted(hash)
			return hash
		} catch (error) {
			controller.failed(getErrorMessage(error, 'Transaction failed. Remaining steps were not sent.'))
			throw error
		}
	}
	return {
		...client,
		onTransactionPlan: steps => {
			if (stepIndex > 0) throw new Error('Cannot change a transaction plan after it has started.')
			plan = steps
		},
		onTransactionPrepared: next => {
			preview = next
		},
		sendTransaction: async parameters =>
			await send(
				{ account: client.account, args: undefined, chainName: client.chain.name, functionName: parameters.data === undefined ? 'Transfer ETH' : 'Contract transaction', to: parameters.to ?? undefined, value: parameters.value },
				async approvalArgs => await client.sendTransaction(approvalArgs === undefined ? parameters : { ...parameters, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs }) }),
			),
		sendRawTransaction: async parameters => await send({ account: undefined, args: undefined, chainName: client.chain.name, functionName: 'Deploy contract', value: undefined }, async () => await client.sendRawTransaction(parameters)),
		writeContract: async parameters =>
			await send({ account: client.account, args: parameters.args, chainName: client.chain.name, functionName: parameters.functionName, contractAddress: parameters.address, value: parameters.value }, async approvalArgs =>
				approvalArgs === undefined ? await client.writeContract(parameters) : await client.writeContract({ ...parameters, abi: ABIS.mainnet.erc20, functionName: 'approve', args: approvalArgs }),
			),
		waitForTransactionReceipt: async parameters => {
			let confirmedPartialApproval = false
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
				if (replaced) throw new Error('Transaction canceled or replaced. Remaining steps were not sent.')
				if (partialApproval && receipt.status === 'success') {
					confirmedPartialApproval = true
					const message = 'Approval confirmed, but it is below the report requirement. Review funding again to approve the required total before continuing.'
					controller.failed(message)
					throw new Error(message)
				}
				return receipt
			} catch (error) {
				if (!confirmedPartialApproval) controller.failed(getErrorMessage(error, 'Could not confirm the transaction. Check its status before retrying.'))
				throw error
			}
		},
	}
}
