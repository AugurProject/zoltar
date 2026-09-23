import { decodeEventLog, encodeFunctionData, encodeAbiParameters, encodeDeployData, getCreate2Address, hexToBytes, keccak256, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import { statoblast_Multicall3_Multicall3, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { QuestionData, SecurityPoolCreationResult, WriteClient, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getQuestionId, getQuestionIdHex } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { getDeploymentSteps } from './deployment.js'
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js'

function getDeploymentStepAddress(id: 'securityPoolFactory' | 'zoltarQuestionData') {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step.address
}

function getSecurityPoolAddressFromReceipt(receipt: TransactionReceipt) {
	const securityPoolFactory = getInfraContractAddresses().securityPoolFactory
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, securityPoolFactory)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'DeploySecurityPool') continue
			const securityPoolAddress = decodedLog.args.securityPool
			if (securityPoolAddress === undefined) throw new Error('Deployment event missing security pool address')
			return securityPoolAddress
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}

	throw new Error('Security pool deployment transaction succeeded without a DeploySecurityPool event')
}

function getQuestionCreatedAtFromReceipt(receipt: TransactionReceipt, questionId: bigint) {
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, getDeploymentStepAddress('zoltarQuestionData'))) continue
		try {
			const decoded = decodeEventLog({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, data: log.data, topics: log.topics })
			if (decoded.eventName === 'QuestionCreated' && decoded.args.questionId === questionId) return decoded.args.createdTimestamp
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
		}
	}
	throw new Error('Question creation transaction succeeded without a QuestionCreated event')
}

function getOriginSecurityPoolId(questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, 0n]))
}

function getOriginSecurityPoolShareTokenAddress(questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return getCreate2Address({
		from: getInfraContractAddresses().shareTokenFactory,
		salt: getOriginSecurityPoolId(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas),
		bytecode: encodeDeployData({
			abi: statoblast_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${statoblast_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [getInfraContractAddresses().securityPoolFactory, getZoltarAddress(), questionId],
		}),
	})
}

type SecurityPoolCreationReview = {
	description?: string
	title: string
}

const ERROR_STRING_SELECTOR = '0x08c379a0'

function decodeRevertReason(returnData: Hex) {
	if (!returnData.startsWith(ERROR_STRING_SELECTOR)) return undefined
	const encoded = returnData.slice(ERROR_STRING_SELECTOR.length)
	if (encoded.length < 128) return undefined
	const length = Number.parseInt(encoded.slice(64, 128), 16)
	if (!Number.isSafeInteger(length) || length === 0 || length > 4096 || encoded.length < 128 + length * 2) return undefined
	return new TextDecoder().decode(hexToBytes(`0x${encoded.slice(128, 128 + length * 2)}`))
}

type BatchedCall = { target: `0x${string}`; allowFailure: boolean; callData: Hex }

/**
 * Multicall3 reports every inner revert as "Multicall3: call failed", which hides the actual reason and leaves the
 * wallet unable to explain why it refused the transaction. Simulate the batch with failures allowed first so the
 * failing step and its revert string reach the user before anything is sent.
 */
async function assertBatchedCallsSucceed(client: WriteClient, calls: readonly BatchedCall[], labels: readonly string[]) {
	const { result: results } = await client.simulateContract({
		abi: statoblast_Multicall3_Multicall3.abi,
		account: client.account,
		address: getMulticall3Address(),
		args: [calls.map(call => ({ ...call, allowFailure: true }))],
		functionName: 'aggregate3',
	})
	for (const [index, result] of results.entries()) {
		if (result.success) continue
		const label = labels[index] ?? `Step ${(index + 1).toString()}`
		const reason = decodeRevertReason(result.returnData)
		throw new Error(reason === undefined ? `${label} would revert.` : `${label} would revert: ${reason}`)
	}
}

export async function createSecurityPool(
	client: WriteClient,
	parameters: {
		initialReportPriorityFeeAttoEthPerGas: bigint
		questionId: bigint
		statoblastSecurityMultiplierBps: bigint
	},
	questionData?: QuestionData,
	review?: SecurityPoolCreationReview,
) {
	if (questionData !== undefined && getQuestionId(questionData, ['Yes', 'No']) !== parameters.questionId) throw new Error('Question ID does not match the binary question')
	const poolCall = {
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		contractLabel: 'Security Pool Factory',
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas],
	} as const
	// The review labels name the whole action so the wallet review does not fall back to the Multicall3 function name.
	const reviewLabels = review === undefined ? {} : { ...(review.description === undefined ? {} : { reviewDescription: review.description }), reviewTitle: review.title }
	const batchedCalls: BatchedCall[] | undefined =
		questionData === undefined
			? undefined
			: [
					{
						target: getDeploymentStepAddress('zoltarQuestionData'),
						allowFailure: false,
						callData: encodeFunctionData({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'createQuestion', args: [questionData, ['Yes', 'No']] }),
					},
					{ target: poolCall.address, allowFailure: false, callData: encodeFunctionData(poolCall) },
				]
	if (batchedCalls !== undefined) await assertBatchedCallsSucceed(client, batchedCalls, ['Question creation', 'Security pool deployment'])
	const { hash: deployPoolHash, receipt } = await writeContractAndWaitForReceipt(client, () =>
		batchedCalls === undefined
			? { ...poolCall, ...reviewLabels }
			: {
					...reviewLabels,
					address: getMulticall3Address(),
					abi: statoblast_Multicall3_Multicall3.abi,
					functionName: 'aggregate3',
					args: [batchedCalls],
				},
	)

	return {
		...(questionData === undefined ? {} : { questionCreatedAt: getQuestionCreatedAtFromReceipt(receipt, parameters.questionId) }),
		deployPoolHash,
		initialReportPriorityFeeAttoEthPerGas: parameters.initialReportPriorityFeeAttoEthPerGas,
		questionId: getQuestionIdHex(parameters.questionId),
		securityPoolAddress: getSecurityPoolAddressFromReceipt(receipt),
		statoblastSecurityMultiplierBps: parameters.statoblastSecurityMultiplierBps,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult & { questionCreatedAt?: bigint }
}

export async function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
	const code = await client.getCode({ address: shareTokenAddress })
	return code !== undefined && code !== '0x'
}

export async function getOriginSecurityPoolAddress(client: Pick<ReadClient, 'readContract'>, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint): Promise<Address | undefined> {
	const originId = getOriginSecurityPoolId(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
	const address = await client.readContract({ abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'getSecurityPool', args: [originId, 0n] })
	return address === zeroAddress ? undefined : address
}
