import path from 'node:path'
import { type AbiParameter, formatAbiItem, formatAbiParameter } from 'abitype'
import {
	type Abi,
	type AbiEvent,
	type AbiFunction,
	type Address,
	decodeEventLog,
	decodeFunctionData,
	formatUnits,
	getAddress,
	type Hex,
	isAddress,
	keccak256,
	parseAbi,
	stringToHex,
	toEventSelector,
	toFunctionSelector,
	zeroAddress,
} from './ethereum.ts'
import type { AbiCatalogEntry, ContractMetadata, DecodedRecord, SerializedArguments, TokenMetadata } from './types.ts'

type CatalogFile = {
	readonly sourceHash: string
	readonly contracts: Record<string, AbiCatalogEntry>
}

const catalogFile = (await Bun.file(path.resolve(import.meta.dir, '../config/abis.json')).json()) as CatalogFile

const kindToContractName: Readonly<Record<string, string>> = {
	ammFactory: 'TwoWayConstantProductFactory',
	ammPair: 'TwoWayConstantProductPair',
	deploymentStatusOracle: 'DeploymentStatusOracle',
	escalationGame: 'EscalationGame',
	escalationGameClaimDelegate: 'EscalationGameClaimDelegate',
	escalationGameFactory: 'EscalationGameFactory',
	escalationProofVerifier: 'EscalationGameProofVerifier',
	multicall3: 'Multicall3',
	liquidationApprovalRegistry: 'LiquidationApprovalRegistry',
	openOracle: 'OpenOracle',
	priceCoordinator: 'OpenOraclePriceCoordinator',
	priceCoordinatorFactory: 'PriceOracleManagerAndOperatorQueuerFactory',
	reputationToken: 'ReputationToken',
	scalarOutcomes: 'ScalarOutcomes',
	securityPool: 'SecurityPool',
	securityPoolFactory: 'SecurityPoolFactory',
	securityPoolForker: 'SecurityPoolForker',
	securityPoolUtils: 'SecurityPoolUtils',
	shareToken: 'ShareToken',
	shareTokenFactory: 'ShareTokenFactory',
	truthAuction: 'UniformPriceDualCapBatchAuction',
	truthAuctionFactory: 'UniformPriceDualCapBatchAuctionFactory',
	weth: 'WETH9',
	zoltar: 'Zoltar',
	zoltarQuestionData: 'ZoltarQuestionData',
}

const externalAbis: Readonly<Record<string, Abi>> = {
	uniswapV2Factory: parseAbi(['event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairIndex)']),
	uniswapV2Pair: parseAbi(['event Sync(uint112 reserve0,uint112 reserve1)']),
	uniswapV3Factory: parseAbi(['event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)']),
	uniswapV3Pool: parseAbi([
		'event Initialize(uint160 sqrtPriceX96,int24 tick)',
		'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
	]),
	uniswapV4PoolManager: parseAbi([
		'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
		'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
	]),
}

export const abiForKind = (kind: string): Abi | undefined => {
	const externalAbi = externalAbis[kind]
	if (externalAbi !== undefined) return externalAbi
	const name = kindToContractName[kind]
	const catalogAbi = name === undefined ? undefined : catalogFile.contracts[name]?.abi
	if (catalogAbi !== undefined) return catalogAbi
	// These deployed helper libraries expose no project ABI, but remain known contracts.
	if (kind === 'proxyDeployer' || kind === 'scalarOutcomes') return []
	return undefined
}

const eventByTopic = new Map<Hex, AbiEvent[]>()
for (const { abi } of Object.values(catalogFile.contracts)) {
	for (const item of abi) {
		if (item.type !== 'event') continue
		const topic = toEventSelector(item)
		const existing = eventByTopic.get(topic)
		if (existing?.some((candidate) => formatAbiItem(candidate) === formatAbiItem(item))) continue
		eventByTopic.set(topic, [...(existing ?? []), item])
	}
}

const serializeValue = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map(serializeValue)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]))
	return value
}

const serializeArguments = (value: unknown): SerializedArguments | undefined => {
	const serialized = serializeValue(value)
	if (serialized === undefined) return undefined
	if (Array.isArray(serialized)) return Object.fromEntries(serialized.map((item, index) => [String(index), item]))
	if (typeof serialized === 'object' && serialized !== null) return serialized as SerializedArguments
	return { value: serialized }
}

const exactUnits = (value: string, decimals: number): string => {
	const formatted = formatUnits(BigInt(value), decimals)
	return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted
}

type DecodeDisplayContext = { readonly nativeSymbol: string }

const defaultDisplayContext: DecodeDisplayContext = { nativeSymbol: 'ETH' }

const semanticUnit = (name: string, context: DecodeDisplayContext): { decimals: number; symbol: string } | undefined => {
	const lower = name.toLowerCase()
	if (lower.includes('attoethpergas')) return { decimals: 18, symbol: `${context.nativeSymbol}/gas` }
	if (lower.includes('attorep')) return { decimals: 18, symbol: 'REP' }
	if (lower.includes('attoeth')) return { decimals: 18, symbol: context.nativeSymbol }
	if (lower.includes('attoshares')) return { decimals: 18, symbol: 'shares' }
	return undefined
}

const protocolTokenUnit: Readonly<Record<string, { readonly decimals: number; readonly symbol: string }>> = {
	reputationToken: { decimals: 18, symbol: 'REP' },
	shareToken: { decimals: 18, symbol: 'shares' },
	weth: { decimals: 18, symbol: 'WETH' },
}

type TokenAmountRule = { readonly tokenPath: string; readonly amountPaths: readonly string[] }

const tokenAmountRules: Readonly<Record<string, readonly TokenAmountRule[]>> = {
	'openOracle.InternalApproval': [{ tokenPath: 'token', amountPaths: ['amount'] }],
	'openOracle.ReportDisputed': [
		{ tokenPath: 'token1', amountPaths: ['currentAmount1'] },
		{ tokenPath: 'token2', amountPaths: ['currentAmount2'] },
	],
	'openOracle.ReportSubmitted': [
		{ tokenPath: 'token1', amountPaths: ['currentAmount1'] },
		{ tokenPath: 'token2', amountPaths: ['currentAmount2'] },
	],
	'openOracle.approveInternal': [{ tokenPath: 'token', amountPaths: ['amount'] }],
	'openOracle.deposit': [{ tokenPath: 'token', amountPaths: ['amount'] }],
	'openOracle.depositFromPermit2': [{ tokenPath: 'permit.permitted.token', amountPaths: ['amount', 'permit.permitted.amount'] }],
	'openOracle.dispute': [
		{ tokenPath: 'params.token1', amountPaths: ['newAmount1', 'params.currentAmount1'] },
		{ tokenPath: 'params.token2', amountPaths: ['newAmount2', 'params.currentAmount2'] },
	],
	'openOracle.internalTransferFrom': [{ tokenPath: 'token', amountPaths: ['amount'] }],
	'openOracle.pushOrCredit': [{ tokenPath: 'token', amountPaths: ['amount'] }],
	'openOracle.report': [
		{ tokenPath: 'params.token1', amountPaths: ['params.currentAmount1'] },
		{ tokenPath: 'params.token2', amountPaths: ['params.currentAmount2'] },
	],
	'openOracle.withdraw': [{ tokenPath: 'tokenToGet', amountPaths: ['amount'] }],
	'openOracle.withdrawTo': [{ tokenPath: 'tokenToGet', amountPaths: ['amount'] }],
	'reputationToken.Approval': [{ tokenPath: '$emitter', amountPaths: ['value'] }],
	'reputationToken.Transfer': [{ tokenPath: '$emitter', amountPaths: ['value'] }],
	'reputationToken.approve': [{ tokenPath: '$emitter', amountPaths: ['amount', 'value'] }],
	'reputationToken.transfer': [{ tokenPath: '$emitter', amountPaths: ['amount', 'value'] }],
	'reputationToken.transferFrom': [{ tokenPath: '$emitter', amountPaths: ['amount', 'value'] }],
	'shareToken.TransferBatch': [{ tokenPath: '$emitter', amountPaths: ['values'] }],
	'shareToken.TransferSingle': [{ tokenPath: '$emitter', amountPaths: ['value'] }],
	'shareToken.safeBatchTransferFrom': [{ tokenPath: '$emitter', amountPaths: ['values'] }],
	'shareToken.safeTransferFrom': [{ tokenPath: '$emitter', amountPaths: ['value'] }],
	'weth.Approval': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.Deposit': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.Transfer': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.Withdrawal': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.approve': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.transfer': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.transferFrom': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
	'weth.withdraw': [{ tokenPath: '$emitter', amountPaths: ['wad'] }],
}

const fixedNativeAmountRules: Readonly<Record<string, readonly { readonly path: string; readonly decimals: number }[]>> = {
	'openOracle.dispute': [{ path: 'params.settlerReward', decimals: 18 }],
	'openOracle.report': [{ path: 'params.settlerReward', decimals: 18 }],
}

const displayValue = (name: string, value: unknown, labels: ReadonlyMap<string, string>, context: DecodeDisplayContext): unknown => {
	if (typeof value === 'string') {
		if (isAddress(value)) {
			const address = getAddress(value)
			const label = labels.get(address.toLowerCase())
			return label === undefined ? address : `${label} (${address})`
		}
		if (/^-?\d+$/.test(value)) {
			const unit = semanticUnit(name, context)
			if (unit !== undefined) return `${exactUnits(value, unit.decimals)} ${unit.symbol}`
		}
		return value
	}
	if (Array.isArray(value)) return value.map((item) => displayValue(name, item, labels, context))
	if (typeof value === 'object' && value !== null)
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayValue(key, item, labels, context)]))
	return value
}

const addressValues = (value: unknown): Address[] => {
	if (typeof value === 'string') return isAddress(value) && value.toLowerCase() !== zeroAddress ? [getAddress(value)] : []
	if (Array.isArray(value)) return value.flatMap(addressValues)
	return []
}

const addressesFromParameter = (parameter: AbiParameter, value: unknown): Address[] => {
	if (parameter.type === 'address' || parameter.type.startsWith('address[')) return addressValues(value)
	if (!('components' in parameter)) return []
	const tuples = parameter.type === 'tuple' ? [value] : Array.isArray(value) ? value : []
	return tuples.flatMap((tuple) => {
		if (typeof tuple !== 'object' || tuple === null) return []
		return parameter.components.flatMap((component, index) => {
			const componentValue = Array.isArray(tuple) ? tuple[index] : Object.entries(tuple).find(([key]) => key === (component.name || String(index)))?.[1]
			return addressesFromParameter(component, componentValue)
		})
	})
}

export const referencedAddressesFrom = (parameters: readonly AbiParameter[], values: SerializedArguments): readonly Address[] => [
	...new Map(
		parameters
			.flatMap((parameter, index) => addressesFromParameter(parameter, values[parameter.name || String(index)]))
			.map((address) => [address.toLowerCase(), address]),
	).values(),
]

const valueAtPath = (value: unknown, path: string): unknown => {
	let current = value
	for (const segment of path.split('.')) {
		if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
		current = (current as Record<string, unknown>)[segment]
	}
	return current
}

const setAtPath = (value: SerializedArguments, path: string, next: unknown): void => {
	const segments = path.split('.')
	let current: Record<string, unknown> = value
	for (const segment of segments.slice(0, -1)) {
		const child = current[segment]
		if (typeof child !== 'object' || child === null || Array.isArray(child)) return
		current = child as Record<string, unknown>
	}
	const final = segments.at(-1)
	if (final !== undefined && current[final] !== undefined) current[final] = next
}

const tokenAddress = (rule: TokenAmountRule, argumentsValue: SerializedArguments, emitterAddress?: string): Address | undefined => {
	const candidate = rule.tokenPath === '$emitter' ? emitterAddress : valueAtPath(argumentsValue, rule.tokenPath)
	return typeof candidate === 'string' && isAddress(candidate) ? getAddress(candidate) : undefined
}

const formattedTokenAmount = (
	value: unknown,
	address: string | undefined,
	kind: string | undefined,
	emitterAddress: string | undefined,
	tokenMetadata: ReadonlyMap<string, TokenMetadata>,
	contractKinds: ReadonlyMap<string, string>,
	context: DecodeDisplayContext,
): unknown => {
	if (Array.isArray(value)) return value.map((item) => formattedTokenAmount(item, address, kind, emitterAddress, tokenMetadata, contractKinds, context))
	if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return value
	if (address?.toLowerCase() === zeroAddress) return `${exactUnits(value, 18)} ${context.nativeSymbol}`
	const metadata = address === undefined ? undefined : tokenMetadata.get(address.toLowerCase())
	const referencedKind = address === undefined ? undefined : contractKinds.get(address.toLowerCase())
	const protocolUnit =
		(referencedKind === undefined ? undefined : protocolTokenUnit[referencedKind]) ??
		(address?.toLowerCase() === emitterAddress?.toLowerCase() && kind !== undefined ? protocolTokenUnit[kind] : undefined)
	const decimals = protocolUnit?.decimals ?? metadata?.decimals
	const symbol = protocolUnit?.symbol ?? metadata?.symbol ?? 'tokens'
	return decimals === undefined ? `${value} base units` : `${exactUnits(value, decimals)} ${symbol}`
}

const applyTokenFormats = (
	kind: string | undefined,
	name: string,
	argumentsValue: SerializedArguments,
	displayArguments: SerializedArguments,
	tokenMetadata: ReadonlyMap<string, TokenMetadata>,
	contractKinds: ReadonlyMap<string, string>,
	emitterAddress?: string,
	context: DecodeDisplayContext = defaultDisplayContext,
): void => {
	for (const rule of tokenAmountRules[`${kind}.${name}`] ?? []) {
		const address = tokenAddress(rule, argumentsValue, emitterAddress)
		for (const path of rule.amountPaths) {
			const value = valueAtPath(argumentsValue, path)
			if (value !== undefined)
				setAtPath(displayArguments, path, formattedTokenAmount(value, address, kind, emitterAddress, tokenMetadata, contractKinds, context))
		}
	}
	for (const rule of fixedNativeAmountRules[`${kind}.${name}`] ?? []) {
		const value = valueAtPath(argumentsValue, rule.path)
		if (typeof value === 'string' && /^-?\d+$/.test(value))
			setAtPath(displayArguments, rule.path, `${exactUnits(value, rule.decimals)} ${context.nativeSymbol}`)
	}
}

export const tokenAddressesFrom = (kind: string | undefined, decoded: DecodedRecord, emitterAddress?: string): readonly Address[] => {
	if (decoded.name === undefined || decoded.arguments === undefined) return []
	const addresses = (tokenAmountRules[`${kind}.${decoded.name}`] ?? []).flatMap((rule) => {
		const address = tokenAddress(rule, decoded.arguments ?? {}, emitterAddress)
		return address === undefined || address.toLowerCase() === zeroAddress ? [] : [address]
	})
	return [...new Set<Address>(addresses)]
}

const summaryFrom = (name: string, displayArguments?: SerializedArguments): string => {
	if (displayArguments === undefined || Object.keys(displayArguments).length === 0) return name
	const values = Object.entries(displayArguments)
		.slice(0, 3)
		.map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
	return `${name} · ${values.join(' · ')}`
}

const decodeWithEvents = (
	events: readonly AbiEvent[],
	kind: string | undefined,
	topics: readonly Hex[],
	data: Hex,
	labels: ReadonlyMap<string, string>,
	tokenMetadata: ReadonlyMap<string, TokenMetadata>,
	contractKinds: ReadonlyMap<string, string>,
	emitterAddress?: string,
	context: DecodeDisplayContext = defaultDisplayContext,
): DecodedRecord => {
	let lastError: unknown
	for (const event of events) {
		try {
			const result = decodeEventLog({ abi: [event], topics: topics as [Hex, ...Hex[]], data, strict: true })
			const argumentsValue = serializeArguments(result.args)
			const displayArguments = argumentsValue === undefined ? undefined : (displayValue('', argumentsValue, labels, context) as SerializedArguments)
			if (argumentsValue !== undefined && displayArguments !== undefined)
				applyTokenFormats(kind, result.eventName, argumentsValue, displayArguments, tokenMetadata, contractKinds, emitterAddress, context)
			return {
				name: result.eventName,
				signature: formatAbiItem(event),
				arguments: argumentsValue,
				displayArguments,
				argumentSchema: event.inputs.map((input, index) => ({
					index,
					name: input.name || String(index),
					type: formatAbiParameter(input),
					...(input.indexed ? { indexed: true } : {}),
				})),
				referencedAddresses: referencedAddressesFrom(event.inputs, argumentsValue ?? {}),
				status: 'decoded',
				summary: summaryFrom(result.eventName, displayArguments),
			}
		} catch (error) {
			lastError = error
		}
	}
	return { status: 'failed', error: lastError instanceof Error ? lastError.message : 'ABI decoding failed', summary: 'Undecodable event' }
}

const packedReportTopics = new Map<Hex, 'ReportSubmitted' | 'ReportDisputed'>([
	[keccak256(stringToHex('ReportSubmitted(uint256,bytes)')), 'ReportSubmitted'],
	[keccak256(stringToHex('ReportDisputed(uint256,bytes)')), 'ReportDisputed'],
])

const packedFields = [
	['currentAmount1', 16, 'uint'],
	['currentAmount2', 16, 'uint'],
	['currentReporter', 20, 'address'],
	['reportTimestamp', 6, 'uint'],
	['settlementTimestamp', 6, 'uint'],
	['token1', 20, 'address'],
	['lastReportOppoTime', 6, 'uint'],
	['settlementTime', 6, 'uint'],
	['escalationHalt', 16, 'uint'],
	['protocolFeeRecipient', 20, 'address'],
	['settlerRewardAttoEth', 12, 'uint'],
	['token2', 20, 'address'],
	['numReports', 3, 'uint'],
	['disputeDelay', 3, 'uint'],
	['feePercentage', 3, 'uint'],
	['multiplier', 2, 'uint'],
	['callbackContract', 20, 'address'],
	['callbackGasLimit', 4, 'uint'],
	['protocolFee', 3, 'uint'],
	['flags', 1, 'uint'],
	['creator', 20, 'address'],
	['blockTimestamp', 6, 'uint'],
	['blockNumber', 6, 'uint'],
] as const

const decodePackedReport = (
	name: 'ReportSubmitted' | 'ReportDisputed',
	topics: readonly Hex[],
	data: Hex,
	labels: ReadonlyMap<string, string>,
	tokenMetadata: ReadonlyMap<string, TokenMetadata>,
	contractKinds: ReadonlyMap<string, string>,
	context: DecodeDisplayContext = defaultDisplayContext,
): DecodedRecord => {
	if (topics.length !== 2) return { name, status: 'failed', error: `${name} requires exactly two topics`, summary: `Malformed ${name}` }
	const bytes = data.slice(2)
	if (bytes.length !== 235 * 2) return { name, status: 'failed', error: `${name} packed payload must be exactly 235 bytes`, summary: `Malformed ${name}` }
	const reportTopic = topics[1]
	if (reportTopic === undefined) return { name, status: 'failed', error: `${name} report identifier is missing`, summary: `Malformed ${name}` }
	const argumentsValue: SerializedArguments = { reportId: BigInt(reportTopic).toString() }
	let offset = 0
	for (const [field, width, type] of packedFields) {
		const encoded = bytes.slice(offset * 2, (offset + width) * 2)
		argumentsValue[field] = type === 'address' ? getAddress(`0x${encoded}`) : BigInt(`0x${encoded}`).toString()
		offset += width
	}
	const displayArguments = displayValue('', argumentsValue, labels, context) as SerializedArguments
	for (const [amountField, tokenField] of [
		['currentAmount1', 'token1'],
		['currentAmount2', 'token2'],
	] as const) {
		const tokenAddress = argumentsValue[tokenField]
		const amount = String(argumentsValue[amountField])
		displayArguments[amountField] = formattedTokenAmount(
			amount,
			typeof tokenAddress === 'string' ? tokenAddress : undefined,
			undefined,
			undefined,
			tokenMetadata,
			contractKinds,
			context,
		)
	}
	return {
		name,
		signature: `event ${name}(uint256 indexed reportId, bytes packed)`,
		arguments: argumentsValue,
		displayArguments,
		argumentSchema: [
			{ index: 0, name: 'reportId', type: 'uint256', indexed: true },
			...packedFields.map(([field, width, type], index) => ({ index: index + 1, name: field, type: type === 'address' ? 'address' : `uint${width * 8}` })),
		],
		referencedAddresses: packedFields.flatMap(([field, , type]) => (type === 'address' ? addressValues(argumentsValue[field]) : [])),
		status: 'decoded',
		summary: summaryFrom(name, displayArguments),
	}
}

export const decodeLogRecord = (
	kind: string | undefined,
	topics: readonly Hex[],
	data: Hex,
	labels: ReadonlyMap<string, string>,
	tokenMetadata: ReadonlyMap<string, TokenMetadata> = new Map(),
	emitterAddress?: string,
	contractKinds: ReadonlyMap<string, string> = new Map(),
	context: DecodeDisplayContext = defaultDisplayContext,
): DecodedRecord => {
	const topic = topics[0]
	if (topic === undefined) return { status: 'unknown', summary: 'Anonymous or empty log' }
	const packedName = kind === 'openOracle' ? packedReportTopics.get(topic) : undefined
	if (packedName !== undefined) return decodePackedReport(packedName, topics, data, labels, tokenMetadata, contractKinds, context)
	const kindAbi = kind === undefined ? undefined : abiForKind(kind)
	const kindEvents = kindAbi?.filter((item): item is AbiEvent => item.type === 'event' && toEventSelector(item) === topic) ?? []
	const candidates = kindEvents.length > 0 ? kindEvents : (eventByTopic.get(topic) ?? [])
	if (candidates.length === 0) return { status: 'unknown', summary: `Unknown event ${topic.slice(0, 10)}…` }
	return decodeWithEvents(candidates, kind, topics, data, labels, tokenMetadata, contractKinds, emitterAddress, context)
}

export const decodeAction = (
	contract: ContractMetadata | undefined,
	input: Hex,
	labels: ReadonlyMap<string, string>,
	tokenMetadata: ReadonlyMap<string, TokenMetadata> = new Map(),
	contractKinds: ReadonlyMap<string, string> = new Map(),
	context: DecodeDisplayContext = defaultDisplayContext,
): DecodedRecord => {
	if (input === '0x') return { status: 'decoded', name: 'receive', summary: `Native transfer to ${contract?.label ?? 'contract'}` }
	const abi = contract === undefined ? undefined : abiForKind(contract.kind)
	if (abi === undefined) return { status: 'unknown', summary: `Call ${input.slice(0, 10)}` }
	try {
		const result = decodeFunctionData({ abi, data: input })
		const selector = input.slice(0, 10)
		const functionItem = abi.find((item): item is AbiFunction => item.type === 'function' && toFunctionSelector(item) === selector)
		if (functionItem === undefined) throw new Error(`ABI function not found for ${selector}`)
		const decodedArguments = Array.isArray(result.args) ? result.args : []
		const argumentsValue = Object.fromEntries(
			functionItem.inputs.map((parameter, index) => [parameter.name || String(index), serializeValue(decodedArguments[index])]),
		)
		const displayArguments = Object.keys(argumentsValue).length === 0 ? undefined : (displayValue('', argumentsValue, labels, context) as SerializedArguments)
		if (displayArguments !== undefined)
			applyTokenFormats(contract?.kind, result.functionName, argumentsValue, displayArguments, tokenMetadata, contractKinds, contract?.address, context)
		return {
			name: result.functionName,
			signature: formatAbiItem(functionItem),
			arguments: argumentsValue,
			displayArguments,
			argumentSchema: functionItem.inputs.map((parameter, index) => ({
				index,
				name: parameter.name || String(index),
				type: formatAbiParameter(parameter),
			})),
			referencedAddresses: referencedAddressesFrom(functionItem.inputs, argumentsValue),
			status: 'decoded',
			summary: summaryFrom(result.functionName, displayArguments),
		}
	} catch (error) {
		return { status: 'failed', error: error instanceof Error ? error.message : 'Calldata decoding failed', summary: `Unknown call ${input.slice(0, 10)}` }
	}
}

type Discovery = { readonly argument: string; readonly kind: string; readonly label: string }
const discoveries: Readonly<Record<string, readonly Discovery[]>> = {
	PairCreated: [{ argument: 'pair', kind: 'ammPair', label: 'Augur AMM Pair' }],
	DeploySecurityPool: [
		{ argument: 'securityPool', kind: 'securityPool', label: 'Security Pool' },
		{ argument: 'truthAuction', kind: 'truthAuction', label: 'Truth Auction' },
		{ argument: 'priceOracleManagerAndOperatorQueuer', kind: 'priceCoordinator', label: 'Price Coordinator' },
		{ argument: 'shareToken', kind: 'shareToken', label: 'Share Token' },
	],
	DeployChild: [{ argument: 'childReputationToken', kind: 'reputationToken', label: 'Child REP' }],
	EscalationGameSet: [{ argument: 'escalationGame', kind: 'escalationGame', label: 'Escalation Game' }],
}

const isKnownRepWethPair = (decoded: DecodedRecord, contracts: ReadonlyMap<string, ContractMetadata>): boolean => {
	const token0 = decoded.arguments?.['token0']
	const token1 = decoded.arguments?.['token1']
	if (typeof token0 !== 'string' || !isAddress(token0) || typeof token1 !== 'string' || !isAddress(token1)) return false
	const kinds = [contracts.get(token0.toLowerCase())?.kind, contracts.get(token1.toLowerCase())?.kind]
	return kinds.includes('reputationToken') && kinds.includes('weth')
}

export const discoveriesFrom = (
	decoded: DecodedRecord,
	contracts: ReadonlyMap<string, ContractMetadata> = new Map(),
): readonly Omit<ContractMetadata, 'provenance'>[] => {
	if (decoded.name === undefined || decoded.arguments === undefined) return []
	if (decoded.name === 'PairCreated' && decoded.arguments['token0'] !== undefined) {
		const pair = decoded.arguments['pair']
		return isKnownRepWethPair(decoded, contracts) && typeof pair === 'string' && isAddress(pair)
			? [{ address: getAddress(pair), kind: 'uniswapV2Pair', label: 'Uniswap V2 REP / WETH Pair' }]
			: []
	}
	if (decoded.name === 'PoolCreated') {
		const pool = decoded.arguments['pool']
		return isKnownRepWethPair(decoded, contracts) && typeof pool === 'string' && isAddress(pool)
			? [{ address: getAddress(pool), kind: 'uniswapV3Pool', label: 'Uniswap V3 REP / WETH Pool' }]
			: []
	}
	return (discoveries[decoded.name] ?? []).flatMap((rule) => {
		const value = decoded.arguments?.[rule.argument]
		return typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress
			? [{ address: getAddress(value), kind: rule.kind, label: rule.label }]
			: []
	})
}
