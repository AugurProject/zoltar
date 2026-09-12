import type { Abi, AbiParameter } from '@zoltar/bot-shared/ethereum'
import * as abis from '@zoltar/bot-shared/contracts/abi'
import { operationInputSchema } from './input-schema.ts'
import type { OperationDefinition } from './types.ts'

const bindings: Record<string, Abi> = {
	ZoltarQuestionData: abis.zoltarQuestionDataAbi,
	Zoltar: abis.zoltarAbi,
	ReputationToken: abis.genesisReputationTokenAbi,
	SecurityPoolFactory: abis.securityPoolFactoryAbi,
	SecurityPool: abis.securityPoolAbi,
	OpenOraclePriceCoordinator: abis.openOraclePriceCoordinatorAbi,
	SecurityPoolForker: abis.securityPoolForkerAbi,
	UniformPriceDualCapBatchAuction: abis.uniformPriceDualCapBatchAuctionAbi,
	EscalationGame: abis.escalationGameAbi,
	OpenOracle: abis.openOracleAbi,
	WETH9: abis.weth9Abi,
	ShareToken: abis.shareTokenAbi,
	TwoWayConstantProductFactory: abis.twoWayConstantProductFactoryAbi,
	TwoWayConstantProductPair: abis.twoWayConstantProductPairAbi,
	TwoWayConstantProductRouter: abis.twoWayConstantProductRouterAbi,
	GenesisUniswapV3Seeder: abis.genesisUniswapV3SeederAbi,
	UniswapV3Factory: abis.genesisUniswapV3FactoryAbi,
	UniswapV3Pool: abis.genesisUniswapV3PoolStateAbi,
}

// Fields read from durable metadata still own these transaction arguments.
const metadataArguments: Record<string, Record<string, string>> = {
	'statoblast.vault.deposit-rep': { 'args.0': 'amount' },
	'statoblast.auction.bid': { 'args.0': 'tick', value: 'amount' },
	'statoblast.complete-set.create': { value: 'amount' },
	'statoblast.complete-set.redeem': { 'args.0': 'amount' },
	'open-oracle.deposit': { 'args.0': 'token', 'args.1': 'amount' },
	'open-oracle.withdraw': { 'args.0': 'token' },
	'open-oracle.withdraw-to': { 'args.0': 'token' },
	'open-oracle.push-or-credit': { 'args.0': 'token' },
	'open-oracle.report': { 'args.0.currentAmount1': 'amount1', 'args.0.currentAmount2': 'amount2' },
	'zoltar.migration.add': { 'args.0': 'universeId' },
	'zoltar.rep.burn': { 'args.0': 'universeId' },
	'trading.pair.initialize-shares': { 'args.0': 'amount', 'args.1': 'amount', 'args.2': 'minimumLiquidity' },
	'trading.liquidity.add-shares': { 'args.0': 'amount', 'args.1': 'amount', 'args.2': 'minimumLiquidity' },
	'trading.swap.exact-input': { 'args.0': 'direction', 'args.1': 'amount', 'args.2': 'minimumOutput' },
	'trading.swap.exact-output': { 'args.0': 'direction', 'args.1': 'outputAmount', 'args.2': 'maximumInput' },
	'trading.liquidity.remove': { 'args.0': 'amount', 'args.1': 'minimumYes', 'args.2': 'minimumNo' },
}

function derivedReason(name: string, definition: Pick<OperationDefinition, 'classification' | 'id'>) {
	if (definition.classification === 'prerequisite') return 'Linked to the parent operation’s exact spend and spender.'
	if (definition.classification === 'excluded-dangerous') return 'This operation is excluded from execution.'
	if (/proof|siblings|preimage|witness|root/i.test(name)) return 'Rebuilt from verified chain history; manual changes would invalidate the proof.'
	if (definition.classification === 'lifecycle-obligation') return 'Fixed by the selected lifecycle candidate and its recorded on-chain obligation.'
	if (name === 'to' && definition.id.startsWith('trading.')) return 'Uses the router that handles this workflow’s incoming shares.'
	if (definition.id.startsWith('zoltar.question.create-')) return 'Fixed by the selected question kind and its protocol encoding.'
	if (/recipient|beneficiary|owner|reporter|^to$|^from$/i.test(name)) return 'Uses the configured signer so inventory, receipts, and recovery track the same owner.'
	if (/spender|operator/i.test(name)) return 'Uses the discovered contract required by this workflow’s approvals.'
	if (/data|request/i.test(name)) return 'Encoded from the selected route and inputs, including its receiver protocol.'
	if (/deadline|timing|timestamp|time|delay/i.test(name)) return 'Computed or fixed by the planner’s protocol timing and recovery rules.'
	if (/amount|liquidity|price|tick|fee|halt|multiplier|reward|factor/i.test(name)) return 'Computed or fixed by the planner’s quoting, funding, and protocol policy.'
	return 'Selected from canonical discovery and the operation’s protocol rules.'
}

export function operationInputCoverage(definition: Pick<OperationDefinition, 'id' | 'contract' | 'method' | 'classification'>) {
	const fields = operationInputSchema(definition.id)
	const result: Array<{ label: string; type: string; source: string; reason: string }> = []
	function add(label: string, type: string, path: string) {
		const key = metadataArguments[definition.id]?.[path]
		const field = fields.find(field => field.key === key || field.path.join('.') === path)
		result.push({ label, type, source: field?.key ?? 'derived', reason: field === undefined ? derivedReason(label, definition) : `Uses ${field.label.toLowerCase()}.` })
	}
	function visit(parameter: AbiParameter, path: string, prefix: string) {
		const label = `${prefix}${parameter.name || path}`
		if (parameter.type === 'tuple' && 'components' in parameter) {
			for (const component of parameter.components) visit(component, `${path}.${component.name}`, `${label}.`)
		} else add(label, parameter.type, path)
	}
	const methods = (bindings[definition.contract] ?? []).filter(entry => entry.type === 'function' && entry.name === definition.method)
	if (methods.length === 0 && definition.method !== 'fallback') throw new Error(`Missing canonical argument coverage for ${definition.id}`)
	for (const method of methods)
		if (method.type === 'function') {
			;(method.inputs ?? []).forEach((parameter, index) => visit(parameter, `args.${index}`, ''))
			if (method.stateMutability === 'payable') add('ETH value', 'uint256', 'value')
		}
	if (definition.method === 'fallback') result.push({ label: 'Deployment bytecode and constructor', type: 'bytes', source: 'derived', reason: 'Uses the verified build and configured deployment dependencies.' })
	const target = fields.find(field => ['pool', 'pair', 'auction', 'target'].includes(field.key))
	result.push({ label: 'Contract / route', type: 'address', source: target?.key ?? 'derived', reason: target === undefined ? 'Uses the configured deployment or selected lifecycle candidate.' : `Uses ${target.label.toLowerCase()}.` })
	return result.filter((item, index) => result.findIndex(other => other.label === item.label && other.type === item.type) === index)
}
