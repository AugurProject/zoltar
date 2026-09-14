import { decodeEventLog, encodeFunctionData, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
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

function getOriginSecurityPoolShareTokenSalt(questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, 0n]))
}

function getOriginSecurityPoolShareTokenAddress(questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return getCreate2Address({
		from: getInfraContractAddresses().shareTokenFactory,
		salt: getOriginSecurityPoolShareTokenSalt(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas),
		bytecode: encodeDeployData({
			abi: statoblast_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${statoblast_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [getInfraContractAddresses().securityPoolFactory, getZoltarAddress(), questionId],
		}),
	})
}

export async function createSecurityPool(
	client: WriteClient,
	parameters: {
		initialReportPriorityFeeAttoEthPerGas: bigint
		questionId: bigint
		statoblastSecurityMultiplierBps: bigint
	},
	questionData?: QuestionData,
) {
	if (questionData !== undefined && getQuestionId(questionData, ['Yes', 'No']) !== parameters.questionId) throw new Error('Question ID does not match the binary question')
	const poolCall = {
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas],
	} as const
	const { hash: deployPoolHash, receipt } = await writeContractAndWaitForReceipt(client, () =>
		questionData === undefined
			? poolCall
			: {
					address: getMulticall3Address(),
					abi: statoblast_Multicall3_Multicall3.abi,
					functionName: 'aggregate3',
					args: [
						[
							{
								target: getDeploymentStepAddress('zoltarQuestionData'),
								allowFailure: false,
								callData: encodeFunctionData({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'createQuestion', args: [questionData, ['Yes', 'No']] }),
							},
							{
								target: poolCall.address,
								allowFailure: false,
								callData: encodeFunctionData(poolCall),
							},
						],
					],
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
