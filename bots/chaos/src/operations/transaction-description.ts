import { decodeFunctionData, type Abi, type JsonValue } from '@zoltar/bot-shared/ethereum'
import * as contractAbis from '@zoltar/bot-shared/contracts/abi'
import type { OperationPlan } from './types.ts'

function jsonValue(value: unknown): JsonValue {
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || value === null) return value
	if (Array.isArray(value)) return value.map(jsonValue)
	if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]))
	return ''
}

const previewAbis: readonly Abi[] = [
	contractAbis.genesisReputationTokenAbi,
	contractAbis.genesisUniswapV3FactoryAbi,
	contractAbis.genesisUniswapV3PoolStateAbi,
	contractAbis.genesisUniswapV3SeederAbi,
	contractAbis.erc1155Abi,
	contractAbis.shareTokenAbi,
	contractAbis.zoltarAbi,
	contractAbis.zoltarQuestionDataAbi,
	contractAbis.securityPoolFactoryAbi,
	contractAbis.securityPoolAbi,
	contractAbis.liquidationApprovalRegistryAbi,
	contractAbis.openOraclePriceCoordinatorAbi,
	contractAbis.securityPoolForkerAbi,
	contractAbis.escalationGameAbi,
	contractAbis.uniformPriceDualCapBatchAuctionAbi,
	contractAbis.openOracleAbi,
	contractAbis.weth9Abi,
	contractAbis.twoWayConstantProductFactoryAbi,
	contractAbis.twoWayConstantProductPairAbi,
	contractAbis.twoWayConstantProductRouterAbi,
]

export function readableTransaction(step: OperationPlan['steps'][number]) {
	for (const abi of previewAbis) {
		try {
			const decoded = decodeFunctionData({ abi, data: step.data })
			return { label: step.label, to: step.to, value: step.value ?? '0', method: decoded.functionName, arguments: JSON.stringify(jsonValue(decoded.args), undefined, 2) ?? '[]' }
		} catch (error) {
			if (!(error instanceof Error) || error.message !== 'Function selector was not found in the ABI') throw error
			// Try the next canonical ABI; deployment bytecode has no function selector.
		}
	}
	return { label: step.label, to: step.to, value: step.value ?? '0', method: 'Deployment', arguments: step.data }
}

export function decodedTransaction(step: OperationPlan['steps'][number]) {
	for (const abi of previewAbis) {
		try {
			const decoded = decodeFunctionData({ abi, data: step.data })
			return { method: decoded.functionName, args: decoded.args, value: step.value ?? '0' }
		} catch (error) {
			if (!(error instanceof Error) || error.message !== 'Function selector was not found in the ABI') throw error
			/* Try the next canonical ABI. */
		}
	}
	return undefined
}
