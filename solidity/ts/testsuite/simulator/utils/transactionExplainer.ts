import { Abi, decodeFunctionData, decodeFunctionResult, isAddress } from 'viem'
import { jsonStringify } from './utilities.js'
import { Deployment, printLogs } from './logExplaining.js'
import { SimulatedTransaction } from '../types/visualizerTypes.js'
import { SendTransactionParams } from '../types/jsonRpcTypes.js'
import { addressString, bytes32String, dataStringWith0xStart } from './bigint.js'

export function decodeOutput(abi: Abi, returnData: Uint8Array<ArrayBufferLike>, functionName: string, deployments: Deployment[]) {
	const output = jsonStringify(decodeFunctionResult({ abi, functionName: functionName, data: dataStringWith0xStart(returnData) }))
	if (isAddress(output)) {
		const matchingDeployment = deployments.find((deploymentItem) => deploymentItem.address.toLowerCase() === output.toLowerCase())
		if (matchingDeployment) return `${ matchingDeployment.deploymentName } (${ output })`
	}
	return output
}

export function decodeUnknownFunctionOutput(returnData: Uint8Array<ArrayBufferLike>, deployments: Deployment[]) {
	const output = dataStringWith0xStart(returnData)
	if (isAddress(output)) {
		const matchingDeployment = deployments.find((deploymentItem) => deploymentItem.address.toLowerCase() === output.toLowerCase())
		if (matchingDeployment) return `${ matchingDeployment.deploymentName } (${ output })`
	}
	return output
}

export function printDecodedFunction(contractName: string, data: `0x${ string }`, abi: Abi, returnData: Uint8Array<ArrayBufferLike>, deployments: Deployment[]): void {
	try {
		const decoded = decodeFunctionData({ abi, data })
		const functionName = decoded.functionName
		const functionArgs = decoded.args || []
		const functionAbi = abi.find((item) => item.type === 'function' && item.name === functionName)
		if (!functionAbi || !('inputs' in functionAbi)) {
			console.log(`${ functionName }(${ functionArgs.join(', ') })`)
			return
		}

		const formattedArgs = functionAbi.inputs
			.map((input: any, index: number) => {
				const paramName = input.name || `param${ index + 1 }`
				const paramValue = jsonStringify(functionArgs[index])
				return `${ paramName } = ${ paramValue }`
			}).join(', ')

		console.log(`> ${ contractName }.${ functionName }(${ formattedArgs }) -> ${ decodeOutput(abi, returnData, functionName, deployments) }`)
	} catch (error) {
		console.log(data)
		console.error('Error decoding function data:', error)
	}
}

export const createTransactionExplainer = (deployments: Deployment[]) => {
	return (request: SendTransactionParams, result: SimulatedTransaction) => {
		const contract = deployments.find((x) => BigInt(x.address) === request.params[0].to)
		if (contract === undefined) {
			console.log(`UNKNOWN CALL: ${ jsonStringify(request)} -> ${ decodeUnknownFunctionOutput(result.ethSimulateV1CallResult.returnData, deployments) }`)
		}
		else {
			const data = request.params[0].input === undefined ? request.params[0].data : request.params[0].input
			if (contract.abi === undefined) {
				console.log(`> ${ contract.deploymentName }.unknown(unknown args) (NO ABI) -> ${ decodeUnknownFunctionOutput(result.ethSimulateV1CallResult.returnData, deployments) }`)
			} else {
				printDecodedFunction(contract.deploymentName, data === undefined ? '0x0' : dataStringWith0xStart(data), contract.abi, result.ethSimulateV1CallResult.returnData, deployments)
			}
		}
		if (result.ethSimulateV1CallResult.status === 'success') {
			printLogs(result.ethSimulateV1CallResult.logs.map((event, logIndex) => ({
				removed: false,
				logIndex: logIndex,
				transactionIndex: 1,
				transactionHash: '0x1',
				blockHash: '0x1',
				blockNumber: 1n,
				address: addressString(event.address),
				data: dataStringWith0xStart(event.data),
				topics: event.topics.map((x) => bytes32String(x)) as [`0x${ string }`, ...`0x${ string }`[]]
			})), deployments)
		} else {
			console.log(`  Failed to error: ${ result.ethSimulateV1CallResult.error.message }`)
		}
	}
}
