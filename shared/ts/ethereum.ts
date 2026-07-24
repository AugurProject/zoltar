import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex as nobleBytesToHex, concatBytes, hexToBytes as nobleHexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { addr, amounts, eip191Signer, Transaction } from 'micro-eth-signer'
import { Decoder, createContract, deployContract, events } from 'micro-eth-signer/advanced/abi.js'

export type Hex = `0x${string}`
export type Address = Hex
export type Hash = Hex
export type AbiParameter = {
	readonly anonymous?: boolean
	readonly components?: readonly AbiParameter[]
	readonly internalType?: string
	readonly indexed?: boolean
	readonly inputs?: readonly AbiParameter[]
	readonly name?: string
	readonly outputs?: readonly AbiParameter[]
	readonly stateMutability?: string
	readonly type: string
}
export type Abi = readonly AbiParameter[]

type FixedArrayValue<TValue, TLength extends number, TAccumulator extends readonly unknown[] = readonly []> = TAccumulator['length'] extends TLength ? TAccumulator : FixedArrayValue<TValue, TLength, readonly [...TAccumulator, TValue]>

type TupleComponentName<TComponent extends AbiParameter> = TComponent['name']
type AbiValueKind = 'input' | 'output'

type TupleComponentsAllNamed<TComponents extends readonly AbiParameter[]> = TComponents extends readonly [] ? false : Extract<TupleComponentName<TComponents[number]>, undefined | ''> extends never ? true : false

type TupleComponentsObject<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = {
	readonly [TComponent in TComponents[number] as TComponent['name'] extends string ? TComponent['name'] : never]: AbiParameterValue<TComponent, TKind>
}

type TupleComponentsArray<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = Readonly<{
	[TIndex in keyof TComponents]: TComponents[TIndex] extends AbiParameter ? AbiParameterValue<TComponents[TIndex], TKind> : never
}>

type TupleValue<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = TKind extends 'input'
	? TupleComponentsAllNamed<TComponents> extends true
		? TupleComponentsArray<TComponents, TKind> | TupleComponentsObject<TComponents, TKind>
		: TupleComponentsArray<TComponents, TKind>
	: TupleComponentsArray<TComponents, TKind> & (TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsObject<TComponents, TKind> : {})

type RebasedAbiParameter<TParameter extends AbiParameter, TType extends string> = {
	readonly anonymous?: boolean
	readonly components?: Exclude<TParameter['components'], undefined>
	readonly internalType?: Exclude<TParameter['internalType'], undefined>
	readonly indexed?: boolean
	readonly inputs?: Exclude<TParameter['inputs'], undefined>
	readonly name?: Exclude<TParameter['name'], undefined>
	readonly outputs?: Exclude<TParameter['outputs'], undefined>
	readonly stateMutability?: Exclude<TParameter['stateMutability'], undefined>
	readonly type: TType
}

type ArrayElementValue<TParameter extends AbiParameter, TElementType extends string, TKind extends AbiValueKind> = TElementType extends 'tuple'
	? TParameter['components'] extends readonly AbiParameter[]
		? TKind extends 'input'
			? TupleValue<TParameter['components'], TKind>
			: TupleComponentsAllNamed<TParameter['components']> extends true
				? TupleComponentsObject<TParameter['components'], TKind>
				: TupleComponentsArray<TParameter['components'], TKind>
		: unknown
	: AbiParameterValue<RebasedAbiParameter<TParameter, TElementType>, TKind>

type AbiParameterValue<TParameter extends AbiParameter, TKind extends AbiValueKind> = string extends TParameter['type']
	? unknown
	: TParameter['type'] extends `${infer TElementType}[${infer TSize}]`
		? TSize extends `${infer TLength extends number}`
			? FixedArrayValue<ArrayElementValue<TParameter, TElementType, TKind>, TLength>
			: readonly ArrayElementValue<TParameter, TElementType, TKind>[]
		: TParameter['type'] extends 'tuple'
			? TupleValue<TParameter['components'] extends readonly AbiParameter[] ? TParameter['components'] : readonly [], TKind>
			: TParameter['type'] extends 'address'
				? Address
				: TParameter['type'] extends 'bool'
					? boolean
					: TParameter['type'] extends 'bytes' | `bytes${number}`
						? Hex
						: TParameter['type'] extends 'function'
							? Hex
							: TParameter['type'] extends 'int' | 'uint' | `${'int' | 'uint'}${number}`
								? TKind extends 'input'
									? bigint | number
									: bigint
								: TParameter['type'] extends 'string'
									? string
									: unknown

type AbiParametersToValues<TParameters extends readonly AbiParameter[] | undefined, TKind extends AbiValueKind> = TParameters extends readonly AbiParameter[] ? TupleComponentsArray<TParameters, TKind> : readonly unknown[]

type KnownAbiFunctions<TAbi extends Abi> = Extract<TAbi[number], { name: string; type: 'function' }>

type ContractFunctionName<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never] ? string : Extract<KnownAbiFunctions<TAbi>['name'], string>

type ContractFunctionDefinition<TAbi extends Abi, TFunctionName extends string> = [KnownAbiFunctions<TAbi>] extends [never]
	? {
			inputs?: readonly AbiParameter[]
			outputs?: readonly AbiParameter[]
		}
	: Extract<KnownAbiFunctions<TAbi>, { name: TFunctionName }> extends infer TFunction
		? [TFunction] extends [never]
			? {
					inputs?: readonly AbiParameter[]
					outputs?: readonly AbiParameter[]
				}
			: TFunction
		: never

type ContractFunctionInputs<TAbi extends Abi, TFunctionName extends string> = ContractFunctionDefinition<TAbi, TFunctionName> extends {
	inputs?: infer TInputs extends readonly AbiParameter[]
}
	? TInputs
	: readonly AbiParameter[] | undefined

type ContractFunctionOutputs<TAbi extends Abi, TFunctionName extends string> = ContractFunctionDefinition<TAbi, TFunctionName> extends {
	outputs?: infer TOutputs extends readonly AbiParameter[]
}
	? TOutputs
	: readonly AbiParameter[] | undefined

type ContractFunctionResult<TAbi extends Abi, TFunctionName extends string> = ContractFunctionOutputs<TAbi, TFunctionName> extends infer TOutputs extends readonly AbiParameter[] | undefined
	? TOutputs extends readonly []
		? undefined
		: TOutputs extends readonly [infer TOutput extends AbiParameter]
			? AbiParameterValue<TOutput, 'output'>
			: TOutputs extends readonly AbiParameter[]
				? TupleValue<TOutputs, 'output'>
				: unknown
	: unknown

type KnownAbiEvents<TAbi extends Abi> = Extract<TAbi[number], { name: string; type: 'event' }>

type ContractEventName<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never] ? string : Extract<KnownAbiEvents<TAbi>['name'], string>

type ContractEventDefinition<TAbi extends Abi, TEventName extends string> = [KnownAbiEvents<TAbi>] extends [never]
	? {
			inputs?: readonly AbiParameter[]
		}
	: Extract<KnownAbiEvents<TAbi>, { name: TEventName }>

type ContractEventArgs<TAbi extends Abi, TEventName extends string> = TupleValue<ContractEventDefinition<TAbi, TEventName>['inputs'] extends readonly AbiParameter[] ? ContractEventDefinition<TAbi, TEventName>['inputs'] : readonly [], 'output'>

type DecodedFunctionData<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never]
	? {
			args: readonly unknown[]
			functionName: string
		}
	: {
			[TFunctionName in ContractFunctionName<TAbi>]: {
				args: AbiParametersToValues<ContractFunctionInputs<TAbi, TFunctionName>, 'output'>
				functionName: TFunctionName
			}
		}[ContractFunctionName<TAbi>]

type DecodedEventLog<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never]
	? {
			args: TupleValue<readonly AbiParameter[], 'output'>
			eventName: string
		}
	: {
			[TEventName in ContractEventName<TAbi>]: {
				args: ContractEventArgs<TAbi, TEventName>
				eventName: TEventName
			}
		}[ContractEventName<TAbi>]

type RpcLogForEvent<TEvent extends AbiParameter | undefined> = TEvent extends AbiParameter ? RpcLog<TEvent['inputs'] extends readonly AbiParameter[] ? TupleValue<TEvent['inputs'], 'output'> : TupleValue<readonly AbiParameter[], 'output'>, TEvent['name'] extends string ? TEvent['name'] : string> : RpcLog

type ContractReadParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	blockTag?: BlockTag | undefined
	gas?: bigint | undefined
	value?: bigint | undefined
}

type ContractSimulateParameters<TAbi extends Abi, TFunctionName extends string> = ContractReadParameters<TAbi, TFunctionName> & {
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
}

type ContractWriteParameters<TAbi extends Abi, TFunctionName extends string> = ContractSimulateParameters<TAbi, TFunctionName>

type EstimateContractGasParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	value?: bigint | undefined
}

type MulticallContractResult<TContract> = TContract extends ContractFunctionParameters<infer TAbi, infer TFunctionName> ? ContractFunctionResult<TAbi, TFunctionName> : unknown

export type ContractFunctionParameters<TAbi extends Abi = Abi, TFunctionName extends string = string> = {
	abi: TAbi
	address: Address
	args?: AbiParametersToValues<ContractFunctionInputs<TAbi, TFunctionName>, 'input'> | undefined
	functionName: TFunctionName
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
}

export type Chain = {
	id: number
	name: string
	nativeCurrency: {
		decimals: number
		name: string
		symbol: string
	}
	rpcUrls: {
		default: {
			http: readonly string[]
		}
	}
	readonly [key: string]: unknown
}

export type EIP1193Provider = {
	request: (parameters: { method: string; params?: unknown }) => Promise<unknown>
}

export type TransactionLog = {
	address: Address
	blockHash?: Hash | undefined
	blockNumber?: bigint | undefined
	data: Hex
	logIndex?: bigint | undefined
	removed?: boolean | undefined
	topics: readonly Hex[]
	transactionHash?: Hash | undefined
	transactionIndex?: bigint | undefined
}

export type TransactionReceipt = {
	blockHash: Hash
	blockNumber: bigint
	contractAddress?: Address | null | undefined
	cumulativeGasUsed: bigint
	effectiveGasPrice?: bigint | undefined
	from: Address
	gasUsed: bigint
	logs: TransactionLog[]
	logsBloom?: Hex | undefined
	status: 'reverted' | 'success'
	to?: Address | null | undefined
	transactionHash: Hash
	transactionIndex: bigint
	type?: string | undefined
}

export type ReplacementReason = 'cancelled' | 'replaced' | 'repriced'

export type TransactionReplacement = {
	reason: ReplacementReason
	replacedTransaction: Pick<BlockTransaction, 'hash'>
	transaction: Pick<BlockTransaction, 'hash'>
	transactionReceipt: TransactionReceipt
}

type WaitForTransactionReceiptParameters = {
	hash: Hash
	onReplaced?: ((replacement: TransactionReplacement) => void) | undefined
	pollingInterval?: number | undefined
	transaction?: BlockTransaction | undefined
	timeout?: number | undefined
}

export type BlockTransaction = {
	blockNumber?: bigint | undefined
	from: Address
	gas: bigint
	gasPrice?: bigint | undefined
	hash: Hash
	input: Hex
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce: bigint
	to?: Address | null | undefined
	transactionIndex?: bigint | undefined
	type?: string | undefined
	value: bigint
}

export type Block = {
	baseFeePerGas?: bigint | undefined
	hash?: Hash | undefined
	number?: bigint | undefined
	parentHash?: Hash | undefined
	readonly transactions: readonly unknown[]
	timestamp: bigint
}

export type RpcLog<TArgs = unknown, TEventName extends string = string> = TransactionLog & {
	args?: TArgs
	eventName?: TEventName | undefined
}

export type Account = {
	address: Address
	signMessage?: (message: string | Uint8Array) => Promise<Hex>
	signTransaction?: (parameters: SignTransactionParameters) => Promise<Hex>
	type: 'json-rpc' | 'local' | string
}

export type SignTransactionParameters = {
	chainId?: bigint | number | undefined
	data?: Hex | undefined
	gas?: bigint | number | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | number | undefined
	to?: Address | undefined
	value?: bigint | undefined
}

export type ParsedTransaction = {
	chainId?: bigint | undefined
	data?: Hex | undefined
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | undefined
	to?: Address | undefined
	type?: string | undefined
	value?: bigint | undefined
}

type TypedTransport =
	| {
			kind: 'custom'
			provider: EIP1193Provider
	  }
	| {
			kind: 'http'
			url: string
	  }

export type Transport = TypedTransport

export type MulticallSuccessResult<TValue> = {
	result: TValue
	status: 'success'
}

export type MulticallFailureResult = {
	error: Error
	status: 'failure'
}

export type MulticallReturnType<TContracts extends readonly unknown[], TAllowFailure extends boolean> = Readonly<{
	[TIndex in keyof TContracts]: TContracts[TIndex] extends ContractFunctionParameters
		? TAllowFailure extends true
			? MulticallSuccessResult<MulticallContractResult<TContracts[TIndex]>> | MulticallFailureResult
			: MulticallContractResult<TContracts[TIndex]>
		: TAllowFailure extends true
			? MulticallSuccessResult<unknown> | MulticallFailureResult
			: unknown
}>

export class RpcError extends Error {
	code?: number | string | undefined
	override cause?: unknown
	shortMessage?: string | undefined

	constructor(message: string, options: { cause?: unknown; code?: number | string | undefined; shortMessage?: string | undefined } = {}) {
		super(message)
		this.name = 'RpcError'
		this.code = options.code
		this.cause = options.cause
		this.shortMessage = options.shortMessage
	}
}

export const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')
export const zeroHash = `0x${'00'.repeat(32)}` satisfies Hash
export const maxUint256 = amounts.maxUint256

type ClientRequestParameters = {
	method: string
	params?: unknown
}

type BlockTag = 'earliest' | 'latest' | 'pending'
type LogTopicFilter = Hex | readonly Hex[] | null

type PublicClientShape<TTransport extends Transport, TChain extends Chain | undefined> = {
	chain: TChain
	extend: <TExtension extends object>(extension: (client: PublicClientShape<TTransport, TChain>) => TExtension) => PublicClientShape<TTransport, TChain> & TExtension
	estimateContractGas: <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) => Promise<bigint>
	getBalance: (parameters: { address: Address; blockTag?: BlockTag | undefined }) => Promise<bigint>
	getBlock: (parameters?: { blockNumber?: bigint | undefined; includeTransactions?: boolean | undefined }) => Promise<Block>
	getBlockNumber: () => Promise<bigint>
	getChainId: () => Promise<number>
	getCode: (parameters: { address: Address; blockTag?: BlockTag | undefined }) => Promise<Hex | undefined>
	getLogs: <TEvent extends AbiParameter | undefined>(parameters: { address?: Address | undefined; event?: TEvent; fromBlock?: bigint | undefined; toBlock?: bigint | undefined; topics?: readonly LogTopicFilter[] | undefined }) => Promise<readonly RpcLogForEvent<TEvent>[]>
	getTransaction: (parameters: { hash: Hash }) => Promise<BlockTransaction>
	getTransactionCount: (parameters: { address: Address; blockTag?: BlockTag | undefined }) => Promise<bigint>
	getTransactionReceipt: (parameters: { hash: Hash }) => Promise<TransactionReceipt>
	multicall: <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: { allowFailure: TAllowFailure; contracts: TContracts; multicallAddress: Address }) => Promise<MulticallReturnType<TContracts, TAllowFailure>>
	readContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractFunctionParameters<TAbi, TFunctionName>) => Promise<ContractFunctionResult<TAbi, TFunctionName>>
	simulateContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => Promise<{ result: ContractFunctionResult<TAbi, TFunctionName> }>
	transport: TTransport
	waitForTransactionReceipt: (parameters: WaitForTransactionReceiptParameters) => Promise<TransactionReceipt>
}

type PublicClientActions = Omit<PublicClientShape<Transport, Chain | undefined>, 'chain' | 'extend' | 'transport'>

type WalletClientShape<TTransport extends Transport, TChain extends Chain | undefined, TAccount extends Account | undefined> = Omit<PublicClientShape<TTransport, TChain>, 'extend'> & {
	account: TAccount
	call: (parameters: { account?: Account | Address | undefined; data?: Hex | undefined; gas?: bigint | undefined; gasPrice?: bigint | undefined; maxFeePerGas?: bigint | undefined; maxPriorityFeePerGas?: bigint | undefined; to?: Address | undefined; value?: bigint | undefined }) => Promise<{ data: Hex | undefined }>
	extend: <TExtension extends object>(extension: (client: WalletClientShape<TTransport, TChain, TAccount>) => TExtension) => WalletClientShape<TTransport, TChain, TAccount> & TExtension
	sendRawTransaction: (parameters: { serializedTransaction: Hex }) => Promise<Hash>
	sendTransaction: (parameters: {
		account?: Account | Address | undefined
		amount?: bigint | undefined
		data?: Hex | undefined
		gas?: bigint | undefined
		gasPrice?: bigint | undefined
		maxFeePerGas?: bigint | undefined
		maxPriorityFeePerGas?: bigint | undefined
		nonce?: bigint | number | undefined
		to?: Address | null | undefined
		value?: bigint | undefined
	}) => Promise<Hash>
	writeContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractWriteParameters<TAbi, TFunctionName>) => Promise<Hash>
}

export type PublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined> = PublicClientShape<TTransport, TChain>

export type WalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined, TAccount extends Account | undefined = Account | undefined> = WalletClientShape<TTransport, TChain, TAccount>

export type PublicActions<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined> = Omit<PublicClient<TTransport, TChain>, 'chain' | 'extend' | 'transport'>

const MAINNET_CHAIN = {
	id: 1,
	name: 'Ethereum',
	nativeCurrency: {
		decimals: 18,
		name: 'Ether',
		symbol: 'ETH',
	},
	rpcUrls: {
		default: {
			http: ['https://ethereum-rpc.publicnode.com'],
		},
	},
} satisfies Chain

const MULTICALL3_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
				name: 'calls',
				type: 'tuple[]',
			},
		],
		name: 'aggregate3',
		outputs: [
			{
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
				name: 'returnData',
				type: 'tuple[]',
			},
		],
		stateMutability: 'payable',
		type: 'function',
	},
] as const

export const mainnet = MAINNET_CHAIN

export function defineChain<TChain extends Chain>(chain: TChain) {
	return chain
}

function stripHexPrefix(value: string) {
	return value.startsWith('0x') ? value.slice(2) : value
}

function ensure0x(value: string): Hex {
	return (value.startsWith('0x') ? value : `0x${value}`) as Hex
}

function ensureEvenHex(value: string) {
	return value.length % 2 === 0 ? value : `0${value}`
}

function isHexCharacter(value: string) {
	return /^[0-9a-fA-F]*$/.test(value)
}

function hexToBigInt(value: string | bigint | number | undefined) {
	if (value === undefined) return undefined
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return normalizeQuantityValue(value)
	return BigInt(value)
}

function normalizeQuantityValue(value: bigint | number) {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Number "${value.toString()}" is not in safe integer range`)
		return BigInt(value)
	}
	if (value < 0n) throw new Error(`Number "${value.toString()}n" is not in safe integer range`)
	return value
}

function hexQuantity(value: bigint | number) {
	const normalized = normalizeQuantityValue(value)
	return normalized === 0n ? '0x0' : ensure0x(normalized.toString(16))
}

function normalizeHexData(value: string | undefined) {
	if (value === undefined) return undefined
	if (!isHex(value, { strict: true })) throw new Error(`Invalid hex value: ${value}`)
	return ensure0x(ensureEvenHex(stripHexPrefix(value).toLowerCase()))
}

function normalizeBoolean(value: unknown) {
	if (typeof value === 'boolean') return value
	if (typeof value === 'string') {
		if (value === '0x1' || value.toLowerCase() === 'true') return true
		if (value === '0x0' || value.toLowerCase() === 'false') return false
	}
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'bigint') return value !== 0n
	return false
}

function normalizeTransactionType(value: unknown) {
	if (typeof value !== 'string') return undefined
	switch (value) {
		case '0x0':
			return 'legacy'
		case '0x1':
			return 'eip2930'
		case '0x2':
			return 'eip1559'
		case '0x3':
			return 'eip4844'
		case '0x4':
			return 'eip7702'
		default:
			return value
	}
}

function normalizeBlockTag(value: bigint | undefined) {
	return value === undefined ? 'latest' : hexQuantity(value)
}

function normalizeNullableAddress(value: unknown) {
	if (value === null || value === undefined) return undefined
	if (typeof value !== 'string') throw new Error('RPC returned an invalid address')
	if (value === '0x') return undefined
	return getAddress(value)
}

function normalizeAddress(value: unknown) {
	const normalized = normalizeNullableAddress(value)
	if (normalized === undefined) throw new Error('RPC returned an invalid address')
	return normalized
}

function normalizeHash(value: unknown) {
	if (typeof value !== 'string' || !isHex(value, { strict: true })) throw new Error('RPC returned an invalid hash')
	const normalized = stripHexPrefix(value).toLowerCase()
	if (normalized.length !== 64) throw new Error('RPC returned an invalid hash')
	return ensure0x(normalized) as Hash
}

function normalizeRpcHex(value: unknown) {
	if (typeof value !== 'string' || !isHex(value, { strict: true })) throw new Error('RPC returned an invalid hex value')
	return ensure0x(ensureEvenHex(stripHexPrefix(value).toLowerCase()))
}

function normalizeRpcBigInt(value: unknown, fallback = 0n) {
	if (value === undefined || value === null) return fallback
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return BigInt(value)
	if (typeof value !== 'string') throw new Error('RPC returned an invalid bigint value')
	return BigInt(value)
}

function normalizeInputValues(values: readonly unknown[] | undefined) {
	return values === undefined ? [] : [...values]
}

function isStaticBytesAbiType(type: string) {
	return /^bytes\d+$/u.test(type)
}

function normalizeCodecValue(parameter: AbiParameter, value: unknown): unknown {
	const arrayItemType = getArrayItemType(parameter.type)
	if (arrayItemType !== undefined) {
		if (!Array.isArray(value)) return value
		return value.map(item => normalizeCodecValue({ ...parameter, type: arrayItemType }, item))
	}
	if (parameter.type.startsWith('tuple')) {
		const components = parameter.components ?? []
		const allNamed = components.every(component => component.name !== undefined && component.name !== '')
		if (Array.isArray(value)) {
			if (!allNamed) {
				return value.map((item, index) => {
					const component = components[index]
					return component === undefined ? item : normalizeCodecValue(component, item)
				})
			}
			return Object.fromEntries(
				components.map((component, index) => {
					const name = component.name
					if (name === undefined || name === '') throw new Error('ABI tuple component name is missing')
					return [name, normalizeCodecValue(component, value[index])]
				}),
			)
		}
		if (typeof value !== 'object' || value === null) return value
		if (!allNamed) {
			return components.map((component, index) => normalizeCodecValue(component, Reflect.get(value, index.toString())))
		}
		return Object.fromEntries(
			components.map(component => {
				const name = component.name
				if (name === undefined || name === '') throw new Error('ABI tuple component name is missing')
				return [name, normalizeCodecValue(component, Reflect.get(value, name))]
			}),
		)
	}
	if ((parameter.type === 'bytes' || isStaticBytesAbiType(parameter.type)) && typeof value === 'string' && isHex(value, { strict: true })) {
		return abiHexToBytes(value)
	}
	return value
}

function abiHexToBytes(value: Hex | string) {
	const stripped = stripHexPrefix(value)
	return nobleHexToBytes(stripped.length % 2 === 0 ? stripped : `${stripped}0`)
}

function normalizeCodecArguments(parameters: readonly AbiParameter[] | undefined, values: readonly unknown[] | undefined) {
	const normalizedValues = normalizeInputValues(values)
	const resolvedParameters = parameters ?? []
	if (resolvedParameters.length === 0) return normalizedValues
	if (resolvedParameters.length === 1) {
		const parameter = resolvedParameters[0]
		if (parameter === undefined) return normalizedValues[0]
		return normalizeCodecValue(parameter, normalizedValues[0])
	}
	const allNamed = resolvedParameters.every(parameter => parameter.name !== undefined && parameter.name !== '')
	if (!allNamed) {
		return resolvedParameters.map((parameter, index) => normalizeCodecValue(parameter, normalizedValues[index]))
	}
	return Object.fromEntries(
		resolvedParameters.map((parameter, index) => {
			const name = parameter.name
			if (name === undefined || name === '') throw new Error('ABI parameter name is missing')
			return [name, normalizeCodecValue(parameter, normalizedValues[index])]
		}),
	)
}

function normalizeAbiParameterValue(value: unknown, context: string): AbiParameter {
	if (typeof value !== 'object' || value === null) throw new Error(`Invalid ${context}`)
	const parameter = value as Record<string, unknown>
	const type = parameter['type']
	if (typeof type !== 'string') throw new Error(`Invalid ${context}`)
	const normalizeChildParameters = (children: unknown, propertyName: string) => {
		if (!Array.isArray(children)) throw new Error(`Invalid ${context}.${propertyName}`)
		return children.map((child, index) => normalizeAbiParameterValue(child, `${context}.${propertyName}[${index.toString()}]`))
	}
	return {
		...(typeof parameter['anonymous'] === 'boolean' ? { anonymous: parameter['anonymous'] } : {}),
		...(parameter['components'] === undefined ? {} : { components: normalizeChildParameters(parameter['components'], 'components') }),
		...(typeof parameter['indexed'] === 'boolean' ? { indexed: parameter['indexed'] } : {}),
		...(parameter['inputs'] === undefined ? {} : { inputs: normalizeChildParameters(parameter['inputs'], 'inputs') }),
		...(typeof parameter['name'] === 'string' ? { name: parameter['name'] } : {}),
		...(parameter['outputs'] === undefined ? {} : { outputs: normalizeChildParameters(parameter['outputs'], 'outputs') }),
		...(typeof parameter['stateMutability'] === 'string' ? { stateMutability: parameter['stateMutability'] } : {}),
		type,
	}
}

function normalizeAbi(abi: readonly unknown[]) {
	return abi.map((entry, index) => normalizeAbiParameterValue(entry, `abi[${index.toString()}]`))
}

function getArrayItemType(type: string) {
	const match = /^(.*)\[(?:\d*)\]$/u.exec(type)
	return match?.[1]
}

function isIntegerAbiType(type: string) {
	return /^u?int(?:\d+)?$/u.test(type)
}

function normalizeDecodedTuple(components: readonly AbiParameter[], value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item, index) => {
			const component = components[index]
			return component === undefined ? item : normalizeDecodedValue(component, item)
		})
	}
	if (typeof value !== 'object' || value === null) return value
	const tuple = value as Record<string, unknown>
	const normalized: Record<string, unknown> = {}
	for (const [key, currentValue] of Object.entries(tuple)) {
		const componentByIndex = /^\d+$/u.test(key) ? components[Number(key)] : undefined
		const componentByName = componentByIndex ?? components.find(component => component.name === key)
		normalized[key] = componentByName === undefined ? currentValue : normalizeDecodedValue(componentByName, currentValue)
	}
	return normalized
}

function normalizeDecodedValue(parameter: AbiParameter, value: unknown): unknown {
	const arrayItemType = getArrayItemType(parameter.type)
	if (arrayItemType !== undefined) {
		if (!Array.isArray(value)) return value
		return value.map(item => normalizeDecodedValue({ ...parameter, type: arrayItemType }, item))
	}
	if (parameter.type.startsWith('tuple')) {
		return normalizeDecodedTuple(parameter.components ?? [], value)
	}
	if (isIntegerAbiType(parameter.type)) {
		if (typeof value === 'number') return BigInt(value)
		return value
	}
	if (parameter.type === 'address' && typeof value === 'string' && isAddress(value)) return getAddress(value)
	if (parameter.type.startsWith('bytes') && value instanceof Uint8Array) return bytesToHex(value)
	if (parameter.type.startsWith('bytes') && typeof value === 'string' && isHex(value, { strict: true })) return normalizeRpcHex(value)
	return value
}

function normalizeDecodedArguments(parameters: readonly AbiParameter[], value: unknown): unknown[] {
	if (parameters.length === 0) return []
	if (parameters.length === 1) {
		const parameter = parameters[0]
		if (parameter === undefined) return [value]
		return [normalizeDecodedValue(parameter, value)]
	}
	return normalizeDecodeFunctionArgs(value).map((item, index) => {
		const parameter = parameters[index]
		return parameter === undefined ? item : normalizeDecodedValue(parameter, item)
	})
}

function normalizeDecodedFunctionOutput(abiItem: AbiParameter, value: unknown): unknown {
	const outputs = abiItem.outputs ?? []
	if (outputs.length === 0) return undefined
	if (outputs.length === 1) {
		const output = outputs[0]
		if (output === undefined) return value
		return normalizeDecodedValue(output, value)
	}
	return normalizeDecodedTuple(outputs, value)
}

function cloneAbiParameter(parameter: AbiParameter, options: { stripName: boolean }): AbiParameter {
	const nameProperties = (() => {
		if (options.stripName) return {}
		if (parameter.name === undefined) return {}
		return { name: parameter.name }
	})()
	return {
		...nameProperties,
		...(parameter.anonymous === undefined ? {} : { anonymous: parameter.anonymous }),
		...(parameter.indexed === undefined ? {} : { indexed: parameter.indexed }),
		...(parameter.inputs === undefined ? {} : { inputs: parameter.inputs.map((input: AbiParameter) => cloneAbiParameter(input, { stripName: false })) }),
		...(parameter.outputs === undefined ? {} : { outputs: parameter.outputs.map((output: AbiParameter) => cloneAbiParameter(output, { stripName: false })) }),
		...(parameter.components === undefined ? {} : { components: parameter.components.map((component: AbiParameter) => cloneAbiParameter(component, { stripName: false })) }),
		...(parameter.stateMutability === undefined ? {} : { stateMutability: parameter.stateMutability }),
		type: parameter.type,
	}
}

function normalizeFunctionAbiForCodec(abiItem: AbiParameter): AbiParameter {
	return {
		...(abiItem.name === undefined ? {} : { name: abiItem.name }),
		...(abiItem.inputs === undefined
			? {}
			: {
					inputs: abiItem.inputs.map((input: AbiParameter) => cloneAbiParameter(input, { stripName: true })),
				}),
		...(abiItem.outputs === undefined
			? {}
			: {
					outputs: abiItem.outputs.map((output: AbiParameter, _index: number, outputs: readonly AbiParameter[]) => cloneAbiParameter(output, { stripName: outputs.length !== 1 || !output.type.startsWith('tuple') })),
				}),
		...(abiItem.stateMutability === undefined ? {} : { stateMutability: abiItem.stateMutability }),
		type: abiItem.type,
	}
}

function normalizeFunctionAbiForEncoder(abiItem: AbiParameter): AbiParameter {
	return {
		...(abiItem.name === undefined ? {} : { name: abiItem.name }),
		...(abiItem.inputs === undefined
			? {}
			: {
					inputs: abiItem.inputs.map((input: AbiParameter) => cloneAbiParameter(input, { stripName: false })),
				}),
		...(abiItem.outputs === undefined
			? {}
			: {
					outputs: abiItem.outputs.map((output: AbiParameter, _index: number, outputs: readonly AbiParameter[]) => cloneAbiParameter(output, { stripName: outputs.length !== 1 || !output.type.startsWith('tuple') })),
				}),
		...(abiItem.stateMutability === undefined ? {} : { stateMutability: abiItem.stateMutability }),
		type: abiItem.type,
	}
}

function getNamedFunctionAbi(abi: readonly unknown[], functionName: string, args?: readonly unknown[]) {
	const normalizedAbi = normalizeAbi(abi)
	const signatureMatch = normalizedAbi.find((entry: AbiParameter) => entry.type === 'function' && getAbiSignature(entry) === functionName)
	if (signatureMatch !== undefined) return signatureMatch

	const matchingEntries = normalizedAbi.filter((entry: AbiParameter) => entry.type === 'function' && entry.name === functionName)
	if (matchingEntries.length === 0) {
		throw new Error(`Function "${functionName}" was not found in the ABI`)
	}
	if (matchingEntries.length === 1) {
		const onlyEntry = matchingEntries[0]
		if (onlyEntry === undefined) throw new Error(`Function "${functionName}" was not found in the ABI`)
		return onlyEntry
	}

	const argumentCount = args?.length ?? 0
	const arityMatches = matchingEntries.filter((entry: AbiParameter) => (entry.inputs?.length ?? 0) === argumentCount)
	if (arityMatches.length === 1) {
		const arityMatch = arityMatches[0]
		if (arityMatch === undefined) throw new Error(`Function "${functionName}" was not found in the ABI`)
		return arityMatch
	}
	if (arityMatches.length > 1) {
		const compatibleMatches = arityMatches.filter((entry: AbiParameter) => canEncodeFunctionArguments(entry, args))
		if (compatibleMatches.length === 1) {
			const compatibleMatch = compatibleMatches[0]
			if (compatibleMatch === undefined) throw new Error(`Function "${functionName}" was not found in the ABI`)
			return compatibleMatch
		}
		if (compatibleMatches.length > 1) {
			throw new Error(`Function "${functionName}" is overloaded and remained ambiguous for the provided argument shape`)
		}
	}

	throw new Error(`Function "${functionName}" is overloaded and could not be resolved from ${argumentCount.toString()} arguments`)
}

function canEncodeFunctionArguments(abiItem: AbiParameter, args: readonly unknown[] | undefined) {
	try {
		const method = getContractMethod(abiItem)
		method.encodeInput(normalizeCodecArguments(abiItem.inputs, args))
		return true
	} catch (error) {
		if (error instanceof Error) return false
		return false
	}
}

function getNamedEventAbi(abi: readonly unknown[], eventName: string) {
	for (const entry of normalizeAbi(abi)) {
		if (entry.type !== 'event') continue
		if (entry.name === eventName) return entry
	}
	throw new Error(`Event "${eventName}" was not found in the ABI`)
}

function getContractMethod(abiItem: AbiParameter) {
	if (abiItem.name === undefined) throw new Error('ABI function is missing a name')
	const contract = createContract([normalizeFunctionAbiForEncoder(abiItem)] as never) as Record<
		string,
		{
			decodeOutput: (value: Uint8Array) => unknown
			encodeInput: (value: unknown) => Uint8Array
		}
	>
	const method = contract[abiItem.name]
	if (method === undefined) throw new Error(`Function "${abiItem.name}" could not be created`)
	return method
}

function normalizeDecodeFunctionArgs(value: unknown) {
	if (value === undefined) return []
	return Array.isArray(value) ? value : [value]
}

function decodeFunctionOutput(abiItem: AbiParameter, data: Hex) {
	const method = getContractMethod(abiItem)
	return normalizeDecodedFunctionOutput(abiItem, method.decodeOutput(nobleHexToBytes(stripHexPrefix(data))))
}

function rlpEncodeBytes(value: Uint8Array): Uint8Array {
	if (value.length === 1 && value[0] !== undefined && value[0] < 0x80) return value
	if (value.length <= 55) return concatBytes(Uint8Array.of(0x80 + value.length), value)
	const lengthBytes = bigintToBytes(BigInt(value.length))
	return concatBytes(Uint8Array.of(0xb7 + lengthBytes.length), lengthBytes, value)
}

function rlpEncodeList(items: readonly Uint8Array[]) {
	const payload = concatBytes(...items)
	if (payload.length <= 55) return concatBytes(Uint8Array.of(0xc0 + payload.length), payload)
	const lengthBytes = bigintToBytes(BigInt(payload.length))
	return concatBytes(Uint8Array.of(0xf7 + lengthBytes.length), lengthBytes, payload)
}

function bigintToBytes(value: bigint) {
	if (value === 0n) return new Uint8Array([])
	let hex = value.toString(16)
	hex = ensureEvenHex(hex)
	return nobleHexToBytes(hex)
}

function checksumAddressFromBytes(value: Uint8Array) {
	return getAddress(ensure0x(nobleBytesToHex(value).slice(-40)))
}

function normalizeEventTopicArgs(eventAbi: AbiParameter, args: readonly unknown[] | Record<string, unknown> | undefined) {
	const inputs = eventAbi.inputs ?? []
	const hasNames = inputs.every((input: AbiParameter) => input.name !== undefined)
	const normalizeTopicValue = (input: AbiParameter, value: unknown) => {
		if (value === null || value === undefined) return null
		if (input.type === 'bytes' && typeof value === 'string' && isHex(value, { strict: true })) return hexToBytes(value)
		return normalizeCodecValue(input, value)
	}
	if (args === undefined) {
		if (hasNames) {
			return Object.fromEntries(inputs.map((input: AbiParameter) => [input.name as string, null]))
		}
		return inputs.map(() => null)
	}
	if (!hasNames || Array.isArray(args)) {
		let indexedInputIndex = 0
		const usesFullInputArray = Array.isArray(args) && args.length === inputs.length
		return inputs.map((input, inputIndex) => {
			if (input.indexed !== true) return null
			const value = Array.isArray(args) ? args[usesFullInputArray ? inputIndex : indexedInputIndex] : undefined
			indexedInputIndex += 1
			return normalizeTopicValue(input, value)
		})
	}
	return Object.fromEntries(
		inputs.map(input => {
			const name = input.name
			if (name === undefined) throw new Error('ABI event input name is missing')
			return [name, input.indexed === true ? normalizeTopicValue(input, Reflect.get(args, name)) : null]
		}),
	)
}

function createDecodeError(name: string, message: string) {
	const error = new Error(message)
	error.name = name
	return error
}

function getEventDecoder(eventAbi: AbiParameter) {
	if (eventAbi.name === undefined) throw new Error('ABI event is missing a name')
	const contractEvents = events([eventAbi as never]) as Record<
		string,
		{
			decode: (topics: string[], data: string) => unknown
			topics: (values: readonly unknown[] | Record<string, unknown>) => (string | null)[]
		}
	>
	const eventDecoder = contractEvents[eventAbi.name]
	if (eventDecoder === undefined) throw new Error(`Event "${eventAbi.name}" could not be created`)
	return eventDecoder
}

function getAbiSignature(parameter: AbiParameter): string {
	if (parameter.type === 'function' || parameter.type === 'event') {
		return `${parameter.name ?? 'function'}(${(parameter.inputs ?? []).map((input: AbiParameter) => getAbiSignature(input)).join(',')})`
	}
	if (parameter.type.startsWith('tuple')) {
		return `(${(parameter.components ?? []).map((component: AbiParameter) => getAbiSignature(component)).join(',')})${parameter.type.slice(5)}`
	}
	return parameter.type
}

function getEventSignatureHash(eventAbi: AbiParameter) {
	return stripHexPrefix(keccak256(getAbiSignature(eventAbi))).toLowerCase()
}

function ensureConstructorAbi(abi: readonly unknown[]) {
	const normalizedAbi = normalizeAbi(abi)
	return normalizedAbi.some(entry => entry.type === 'constructor')
		? normalizedAbi
		: [
				...normalizedAbi,
				{
					inputs: [],
					type: 'constructor',
				} satisfies AbiParameter,
			]
}

async function requestTransport<TValue>(transport: Transport, parameters: ClientRequestParameters): Promise<TValue> {
	if (transport.kind === 'custom') {
		try {
			return (await transport.provider.request({
				method: parameters.method,
				params: parameters.params,
			})) as TValue
		} catch (error) {
			throw toRpcError(error, `${parameters.method} failed`)
		}
	}

	const response = await fetch(transport.url, {
		body: JSON.stringify({
			id: 1,
			jsonrpc: '2.0',
			method: parameters.method,
			params: parameters.params ?? [],
		}),
		headers: {
			'content-type': 'application/json',
		},
		method: 'POST',
	})
	if (!response.ok) {
		throw new RpcError(`HTTP ${response.status} while calling ${parameters.method}`, {
			shortMessage: `HTTP ${response.status} while calling ${parameters.method}`,
		})
	}

	const payload = (await response.json()) as {
		error?: {
			code?: number | string | undefined
			data?: unknown
			message?: string | undefined
		}
		result?: TValue
	}
	if (payload.error !== undefined) {
		throw new RpcError(payload.error.message ?? `${parameters.method} failed`, {
			cause: payload.error.data,
			code: payload.error.code,
			shortMessage: payload.error.message,
		})
	}
	return payload.result as TValue
}

function toRpcError(error: unknown, fallbackMessage: string) {
	if (error instanceof RpcError) return error
	if (typeof error === 'object' && error !== null) {
		const code = 'code' in error && (typeof error.code === 'number' || typeof error.code === 'string') ? error.code : undefined
		const message = 'message' in error && typeof error.message === 'string' ? error.message : fallbackMessage
		return new RpcError(message, {
			cause: error,
			code,
			shortMessage: message,
		})
	}
	if (error instanceof Error) {
		return new RpcError(error.message, {
			cause: error,
			shortMessage: error.message,
		})
	}
	return new RpcError(fallbackMessage, {
		cause: error,
		shortMessage: fallbackMessage,
	})
}

function normalizeLog(value: unknown): TransactionLog {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid log')
	const log = value as Record<string, unknown>
	return {
		address: normalizeAddress(log['address']),
		blockHash: log['blockHash'] === undefined || log['blockHash'] === null ? undefined : normalizeHash(log['blockHash']),
		blockNumber: log['blockNumber'] === undefined || log['blockNumber'] === null ? undefined : normalizeRpcBigInt(log['blockNumber']),
		data: normalizeRpcHex(log['data']),
		logIndex: log['logIndex'] === undefined || log['logIndex'] === null ? undefined : normalizeRpcBigInt(log['logIndex']),
		removed: normalizeBoolean(log['removed']),
		topics: Array.isArray(log['topics']) ? log['topics'].map(topic => normalizeRpcHex(topic)) : [],
		transactionHash: log['transactionHash'] === undefined || log['transactionHash'] === null ? undefined : normalizeHash(log['transactionHash']),
		transactionIndex: log['transactionIndex'] === undefined || log['transactionIndex'] === null ? undefined : normalizeRpcBigInt(log['transactionIndex']),
	}
}

function normalizeReceipt(value: unknown): TransactionReceipt {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid transaction receipt')
	const receipt = value as Record<string, unknown>
	return {
		blockHash: normalizeHash(receipt['blockHash']),
		blockNumber: normalizeRpcBigInt(receipt['blockNumber']),
		contractAddress: normalizeNullableAddress(receipt['contractAddress']) ?? null,
		cumulativeGasUsed: normalizeRpcBigInt(receipt['cumulativeGasUsed']),
		effectiveGasPrice: receipt['effectiveGasPrice'] === undefined ? undefined : normalizeRpcBigInt(receipt['effectiveGasPrice']),
		from: normalizeAddress(receipt['from']),
		gasUsed: normalizeRpcBigInt(receipt['gasUsed']),
		logs: Array.isArray(receipt['logs']) ? receipt['logs'].map(item => normalizeLog(item)) : [],
		logsBloom: receipt['logsBloom'] === undefined ? undefined : normalizeRpcHex(receipt['logsBloom']),
		status: normalizeBoolean(receipt['status']) ? 'success' : 'reverted',
		to: normalizeNullableAddress(receipt['to']) ?? null,
		transactionHash: normalizeHash(receipt['transactionHash']),
		transactionIndex: normalizeRpcBigInt(receipt['transactionIndex']),
		type: normalizeTransactionType(receipt['type']),
	}
}

function normalizeTransaction(value: unknown): BlockTransaction {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid transaction')
	const transaction = value as Record<string, unknown>
	return {
		blockNumber: transaction['blockNumber'] === undefined || transaction['blockNumber'] === null ? undefined : normalizeRpcBigInt(transaction['blockNumber']),
		from: normalizeAddress(transaction['from']),
		gas: normalizeRpcBigInt(transaction['gas']),
		gasPrice: transaction['gasPrice'] === undefined || transaction['gasPrice'] === null ? undefined : normalizeRpcBigInt(transaction['gasPrice']),
		hash: normalizeHash(transaction['hash']),
		input: normalizeRpcHex(transaction['input'] ?? transaction['data'] ?? '0x'),
		maxFeePerGas: transaction['maxFeePerGas'] === undefined || transaction['maxFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxFeePerGas']),
		maxPriorityFeePerGas: transaction['maxPriorityFeePerGas'] === undefined || transaction['maxPriorityFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxPriorityFeePerGas']),
		nonce: normalizeRpcBigInt(transaction['nonce']),
		to: normalizeNullableAddress(transaction['to']) ?? null,
		transactionIndex: transaction['transactionIndex'] === undefined || transaction['transactionIndex'] === null ? undefined : normalizeRpcBigInt(transaction['transactionIndex']),
		type: normalizeTransactionType(transaction['type']),
		value: normalizeRpcBigInt(transaction['value']),
	}
}

function normalizeBlock(value: unknown, includeTransactions: boolean) {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid block')
	const block = value as Record<string, unknown>
	return {
		baseFeePerGas: block['baseFeePerGas'] === undefined || block['baseFeePerGas'] === null ? undefined : normalizeRpcBigInt(block['baseFeePerGas']),
		hash: block['hash'] === undefined || block['hash'] === null ? undefined : normalizeHash(block['hash']),
		number: block['number'] === undefined || block['number'] === null ? undefined : normalizeRpcBigInt(block['number']),
		parentHash: block['parentHash'] === undefined || block['parentHash'] === null ? undefined : normalizeHash(block['parentHash']),
		timestamp: normalizeRpcBigInt(block['timestamp']),
		transactions: Array.isArray(block['transactions']) ? block['transactions'].map(transaction => (includeTransactions ? normalizeTransaction(transaction) : normalizeHash(transaction))) : [],
	} satisfies Block
}

function isBlockTransaction(value: unknown): value is BlockTransaction {
	return typeof value === 'object' && value !== null && 'hash' in value && 'from' in value && 'nonce' in value
}

function isTransactionNotFoundError(error: unknown) {
	return error instanceof Error && error.message.includes('could not be found')
}

function getReplacementReason(originalTransaction: BlockTransaction, replacementTransaction: BlockTransaction): ReplacementReason {
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.from.toLowerCase() && replacementTransaction.value === 0n && replacementTransaction.input === '0x') return 'cancelled'
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.to?.toLowerCase() && replacementTransaction.value === originalTransaction.value && replacementTransaction.input === originalTransaction.input) return 'repriced'
	return 'replaced'
}

const REPLACEMENT_SCAN_BLOCK_DEPTH = 12n

async function findReplacementTransaction(actions: PublicClientActions, originalTransaction: BlockTransaction, parameters: { fromBlock: bigint; toBlock: bigint }) {
	for (let blockNumber = parameters.fromBlock; blockNumber <= parameters.toBlock; blockNumber += 1n) {
		const block = await actions.getBlock({
			blockNumber,
			includeTransactions: true,
		})
		const replacementTransaction = block.transactions.find((transaction): transaction is BlockTransaction => isBlockTransaction(transaction) && transaction.hash !== originalTransaction.hash && transaction.nonce === originalTransaction.nonce && transaction.from.toLowerCase() === originalTransaction.from.toLowerCase())
		if (replacementTransaction !== undefined) return replacementTransaction
	}
	return undefined
}

function buildRpcTransactionRequest(parameters: {
	account?: Account | Address | undefined
	amount?: bigint | undefined
	data?: Hex | undefined
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | number | undefined
	to?: Address | null | undefined
	value?: bigint | undefined
}) {
	const from = normalizeAccountAddress(parameters.account)
	const value = parameters.value ?? parameters.amount
	return {
		...(from === undefined ? {} : { from }),
		...(parameters.to === undefined || parameters.to === null ? {} : { to: parameters.to }),
		...(parameters.data === undefined ? {} : { data: parameters.data }),
		...(parameters.gas === undefined ? {} : { gas: hexQuantity(parameters.gas) }),
		...(parameters.gasPrice === undefined ? {} : { gasPrice: hexQuantity(parameters.gasPrice) }),
		...(parameters.maxFeePerGas === undefined ? {} : { maxFeePerGas: hexQuantity(parameters.maxFeePerGas) }),
		...(parameters.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: hexQuantity(parameters.maxPriorityFeePerGas) }),
		...(parameters.nonce === undefined ? {} : { nonce: hexQuantity(parameters.nonce) }),
		...(value === undefined ? {} : { value: hexQuantity(value) }),
	}
}

function normalizeAccountAddress(account: Account | Address | undefined) {
	if (account === undefined) return undefined
	return typeof account === 'string' ? getAddress(account) : account.address
}

async function readContractRaw<TAbi extends Abi, TFunctionName extends string>(transport: Transport, parameters: ContractReadParameters<TAbi, TFunctionName>) {
	const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args)
	const method = getContractMethod(abiItem)
	const data = ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))))
	const rawResult = normalizeRpcHex(
		await requestTransport<string>(transport, {
			method: 'eth_call',
			params: [
				buildRpcTransactionRequest({
					account: parameters.account,
					data,
					gas: parameters.gas,
					gasPrice: parameters.gasPrice,
					maxFeePerGas: parameters.maxFeePerGas,
					maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
					to: parameters.address,
					value: parameters.value,
				}),
				parameters.blockTag ?? 'latest',
			],
		}),
	)
	if (rawResult === '0x' && (abiItem.outputs?.length ?? 0) > 0) {
		throw new RpcError(`The contract function "${parameters.functionName}" returned no data ("0x"). The contract does not have the function "${parameters.functionName}".`, {
			shortMessage: `The contract function "${parameters.functionName}" returned no data ("0x"). The contract does not have the function "${parameters.functionName}".`,
		})
	}
	return {
		abiItem,
		data: rawResult,
	}
}

function buildPublicClientActions<TTransport extends Transport, TChain extends Chain | undefined>({ chain, transport }: { chain: TChain; transport: TTransport }): Omit<PublicClientShape<TTransport, TChain>, 'chain' | 'extend' | 'transport'> {
	return {
		estimateContractGas: async <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) =>
			normalizeRpcBigInt(
				await requestTransport<string>(transport, {
					method: 'eth_estimateGas',
					params: [
						buildRpcTransactionRequest({
							account: parameters.account,
							data: encodeFunctionData({
								abi: parameters.abi,
								...(parameters.args === undefined ? {} : { args: parameters.args }),
								functionName: parameters.functionName,
							}),
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							to: parameters.address,
							value: parameters.value,
						}),
					],
				}),
			),
		getBalance: async parameters =>
			normalizeRpcBigInt(
				await requestTransport<string>(transport, {
					method: 'eth_getBalance',
					params: [parameters.address, parameters.blockTag ?? 'latest'],
				}),
			),
		getTransactionCount: async parameters =>
			normalizeRpcBigInt(
				await requestTransport<string>(transport, {
					method: 'eth_getTransactionCount',
					params: [parameters.address, parameters.blockTag ?? 'latest'],
				}),
			),
		getBlock: async parameters => {
			const includeTransactions = parameters?.includeTransactions === true
			const blockTag = normalizeBlockTag(parameters?.blockNumber)
			const block = await requestTransport<unknown>(transport, {
				method: 'eth_getBlockByNumber',
				params: [blockTag, includeTransactions],
			})
			return normalizeBlock(block, includeTransactions)
		},
		getBlockNumber: async () => normalizeRpcBigInt(await requestTransport<string>(transport, { method: 'eth_blockNumber' })),
		getChainId: async () => Number(normalizeRpcBigInt(await requestTransport<string>(transport, { method: 'eth_chainId' }))),
		getCode: async parameters => {
			const result = normalizeRpcHex(
				await requestTransport<string>(transport, {
					method: 'eth_getCode',
					params: [parameters.address, parameters.blockTag ?? 'latest'],
				}),
			)
			return result === '0x' ? undefined : result
		},
		getLogs: async <TEvent extends AbiParameter | undefined>(parameters: { address?: Address | undefined; event?: TEvent; fromBlock?: bigint | undefined; toBlock?: bigint | undefined; topics?: readonly LogTopicFilter[] | undefined }) => {
			const event = parameters.event
			if (event !== undefined && parameters.topics !== undefined) throw new Error('getLogs accepts either an event or raw topics, not both')
			const topics =
				parameters.topics ??
				(event === undefined
					? undefined
					: encodeEventTopics({
							abi: [event],
							eventName: event.name ?? 'event',
						}))
			const rawLogs = await requestTransport<unknown[]>(transport, {
				method: 'eth_getLogs',
				params: [
					{
						...(parameters.address === undefined ? {} : { address: parameters.address }),
						...(parameters.fromBlock === undefined ? {} : { fromBlock: hexQuantity(parameters.fromBlock) }),
						...(parameters.toBlock === undefined ? {} : { toBlock: hexQuantity(parameters.toBlock) }),
						...(topics === undefined ? {} : { topics }),
					},
				],
			})
			return rawLogs.map(rawLog => {
				const normalizedLog = normalizeLog(rawLog)
				if (event === undefined) return normalizedLog
				const decodedLog = decodeEventLog({
					abi: [event],
					data: normalizedLog.data,
					topics: normalizedLog.topics,
				})
				return {
					...normalizedLog,
					args: decodedLog.args,
					eventName: decodedLog.eventName,
				}
			}) as unknown as readonly RpcLogForEvent<TEvent>[]
		},
		getTransaction: async parameters => {
			const rawTransaction = await requestTransport<unknown>(transport, {
				method: 'eth_getTransactionByHash',
				params: [parameters.hash],
			})
			if (rawTransaction === null) throw new Error(`Transaction with hash "${parameters.hash}" could not be found.`)
			return normalizeTransaction(rawTransaction)
		},
		getTransactionReceipt: async parameters => {
			const rawReceipt = await requestTransport<unknown>(transport, {
				method: 'eth_getTransactionReceipt',
				params: [parameters.hash],
			})
			if (rawReceipt === null) throw new Error(`Transaction receipt with hash "${parameters.hash}" could not be found.`)
			return normalizeReceipt(rawReceipt)
		},
		multicall: async <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: { allowFailure: TAllowFailure; contracts: TContracts; multicallAddress: Address }) => {
			const calls: { allowFailure: boolean; callData: Hex; target: Address }[] = []
			for (const contract of parameters.contracts) {
				calls.push({
					allowFailure: parameters.allowFailure,
					callData: encodeFunctionData({
						abi: contract.abi,
						...(contract.args === undefined ? {} : { args: contract.args }),
						functionName: contract.functionName,
					}),
					target: contract.address,
				})
			}
			const rawResult = (await readContractRaw(transport, {
				abi: MULTICALL3_ABI,
				address: parameters.multicallAddress,
				args: [calls] as never,
				functionName: 'aggregate3',
			})) as {
				abiItem: AbiParameter
				data: Hex
			}
			const decoded = decodeFunctionOutput(rawResult.abiItem, rawResult.data)
			if (!Array.isArray(decoded)) throw new Error('Unexpected multicall response')

			if (parameters.allowFailure) {
				return decoded.map((entry, index) => {
					if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry)) {
						return {
							error: new Error('Unexpected multicall response'),
							status: 'failure',
						}
					}
					if (entry.success !== true) {
						return {
							error: new Error('Multicall contract call failed'),
							status: 'failure',
						}
					}
					const contract = parameters.contracts[index]
					if (contract === undefined) throw new Error('Missing multicall contract response')
					const abiItem = getNamedFunctionAbi(contract.abi, contract.functionName, contract.args)
					return {
						result: decodeFunctionOutput(abiItem, entry.returnData as Hex),
						status: 'success',
					}
				}) as MulticallReturnType<typeof parameters.contracts, typeof parameters.allowFailure>
			}

			return decoded.map((entry, index) => {
				if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry) || entry.success !== true) {
					throw new Error('Multicall contract call failed')
				}
				const contract = parameters.contracts[index]
				if (contract === undefined) throw new Error('Missing multicall contract response')
				const abiItem = getNamedFunctionAbi(contract.abi, contract.functionName, contract.args)
				return decodeFunctionOutput(abiItem, entry.returnData as Hex)
			}) as MulticallReturnType<typeof parameters.contracts, typeof parameters.allowFailure>
		},
		readContract: async <TAbi extends Abi, TFunctionName extends string>(parameters: ContractFunctionParameters<TAbi, TFunctionName>) => {
			const { abiItem, data } = await readContractRaw(transport, parameters)
			return decodeFunctionOutput(abiItem, data) as ContractFunctionResult<TAbi, TFunctionName>
		},
		simulateContract: async <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => {
			const { abiItem, data } = await readContractRaw(transport, parameters)
			return {
				result: decodeFunctionOutput(abiItem, data) as ContractFunctionResult<TAbi, TFunctionName>,
			}
		},
		waitForTransactionReceipt: async parameters => {
			const timeoutMilliseconds = parameters.timeout ?? 180_000
			const pollingInterval = parameters.pollingInterval ?? 1_000
			const startTime = Date.now()
			const actions = buildPublicClientActions({ chain, transport })
			let originalTransaction = parameters.transaction
			let lastScannedReplacementBlock: bigint | undefined
			if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
				try {
					originalTransaction = await actions.getTransaction({
						hash: parameters.hash,
					})
				} catch (error) {
					if (!isTransactionNotFoundError(error)) throw error
				}
			}
			while (true) {
				try {
					return await actions.getTransactionReceipt({
						hash: parameters.hash,
					})
				} catch (error) {
					if (!isTransactionNotFoundError(error)) throw error
					if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
						try {
							originalTransaction = await actions.getTransaction({
								hash: parameters.hash,
							})
						} catch (transactionError) {
							if (!isTransactionNotFoundError(transactionError)) throw transactionError
						}
					}
					if (originalTransaction !== undefined) {
						const latestBlockNumber = await actions.getBlockNumber()
						let firstScanBlock = lastScannedReplacementBlock === undefined ? 0n : lastScannedReplacementBlock + 1n
						if (lastScannedReplacementBlock === undefined && latestBlockNumber > REPLACEMENT_SCAN_BLOCK_DEPTH) {
							firstScanBlock = latestBlockNumber - REPLACEMENT_SCAN_BLOCK_DEPTH
						}
						const replacementTransaction = firstScanBlock > latestBlockNumber ? undefined : await findReplacementTransaction(actions, originalTransaction, { fromBlock: firstScanBlock, toBlock: latestBlockNumber })
						lastScannedReplacementBlock = latestBlockNumber
						if (replacementTransaction !== undefined) {
							const transactionReceipt = await actions.getTransactionReceipt({
								hash: replacementTransaction.hash,
							})
							parameters.onReplaced?.({
								reason: getReplacementReason(originalTransaction, replacementTransaction),
								replacedTransaction: originalTransaction,
								transaction: replacementTransaction,
								transactionReceipt,
							})
							return transactionReceipt
						}
					}
					if (Date.now() - startTime >= timeoutMilliseconds) throw error
					await new Promise(resolve => {
						setTimeout(resolve, pollingInterval)
					})
				}
			}
		},
	}
}

function getClientDefaultAccountAddress(client: object): Address | undefined {
	if (!('account' in client)) return undefined
	const account = client.account
	if (typeof account === 'string') return getAddress(account)
	if (typeof account !== 'object' || account === null) return undefined
	if (!('address' in account) || typeof account.address !== 'string') return undefined
	return getAddress(account.address)
}

export function publicActions<TTransport extends Transport, TChain extends Chain | undefined>(client: PublicClientShape<TTransport, TChain>) {
	const actions = buildPublicClientActions({
		chain: client.chain,
		transport: client.transport,
	})
	const defaultAccount = getClientDefaultAccountAddress(client)
	if (defaultAccount === undefined) return actions
	const estimateContractGas: typeof actions.estimateContractGas = async parameters =>
		await actions.estimateContractGas({
			...parameters,
			account: parameters.account ?? defaultAccount,
		})
	const simulateContract: typeof actions.simulateContract = async parameters =>
		await actions.simulateContract({
			...parameters,
			account: parameters.account ?? defaultAccount,
		})
	return {
		...actions,
		estimateContractGas,
		simulateContract,
	}
}

export function createPublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ chain, transport }: { cacheTime?: number | undefined; chain?: TChain; transport: TTransport }): PublicClient<TTransport, TChain> {
	const resolvedChain = chain as TChain
	const actions = buildPublicClientActions({
		chain: resolvedChain,
		transport,
	})
	let client: PublicClient<TTransport, TChain>
	client = {
		...actions,
		chain: resolvedChain,
		extend: extension => Object.assign({}, client, extension(client)) as PublicClient<TTransport, TChain> & ReturnType<typeof extension>,
		transport,
	}
	return client
}

function normalizeWalletAccount(account: Account | Address | undefined) {
	if (account === undefined) return undefined
	if (typeof account === 'string') {
		return {
			address: getAddress(account),
			type: 'json-rpc',
		} satisfies Account
	}
	return account
}

export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account: Account | Address; cacheTime?: number | undefined; chain?: TChain; transport: TTransport }): WalletClient<TTransport, TChain, Account>
export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account?: undefined; cacheTime?: number | undefined; chain?: TChain; transport: TTransport }): WalletClient<TTransport, TChain, undefined>
export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account?: Account | Address | undefined; cacheTime?: number | undefined; chain?: TChain; transport: TTransport }) {
	const normalizedAccount = normalizeWalletAccount(account)
	const publicClient =
		chain === undefined
			? createPublicClient({
					transport,
				})
			: createPublicClient({
					chain,
					transport,
				})
	const baseClient = publicClient as PublicClient<TTransport, TChain>
	let walletClient: WalletClient<TTransport, TChain, Account | undefined>
	walletClient = {
		...baseClient,
		account: normalizedAccount,
		call: async parameters => {
			const account = parameters.account ?? normalizedAccount
			const data = normalizeRpcHex(
				await requestTransport<string>(transport, {
					method: 'eth_call',
					params: [
						buildRpcTransactionRequest({
							account,
							data: parameters.data,
							gas: parameters.gas,
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							to: parameters.to,
							value: parameters.value,
						}),
						'latest',
					],
				}),
			)
			return {
				data,
			}
		},
		estimateContractGas: async parameters =>
			await baseClient.estimateContractGas({
				...parameters,
				account: parameters.account ?? normalizedAccount,
			}),
		sendRawTransaction: async parameters =>
			normalizeHash(
				await requestTransport<string>(transport, {
					method: 'eth_sendRawTransaction',
					params: [parameters.serializedTransaction],
				}),
			),
		simulateContract: async parameters =>
			await baseClient.simulateContract({
				...parameters,
				account: parameters.account ?? normalizedAccount,
			}),
		sendTransaction: async parameters => {
			const sender = parameters.account ?? normalizedAccount
			if (typeof sender === 'object' && sender !== null && sender.type === 'local' && sender.signTransaction !== undefined) {
				const serializedTransaction = await sender.signTransaction({
					chainId: chain?.id,
					data: parameters.data,
					gas: parameters.gas,
					gasPrice: parameters.gasPrice,
					maxFeePerGas: parameters.maxFeePerGas,
					maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
					nonce: parameters.nonce,
					to: parameters.to ?? undefined,
					value: parameters.value ?? parameters.amount,
				})
				return await walletClient.sendRawTransaction({
					serializedTransaction,
				})
			}

			const normalizedSender = (() => {
				if (sender === undefined) return undefined
				if (typeof sender === 'string') return getAddress(sender)
				return sender
			})()
			return normalizeHash(
				await requestTransport<string>(transport, {
					method: 'eth_sendTransaction',
					params: [
						buildRpcTransactionRequest({
							account: normalizedSender,
							amount: parameters.amount,
							data: parameters.data,
							gas: parameters.gas,
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							nonce: parameters.nonce,
							to: parameters.to,
							value: parameters.value,
						}),
					],
				}),
			)
		},
		extend: extension => Object.assign({}, walletClient, extension(walletClient)) as WalletClient<TTransport, TChain, Account | undefined> & ReturnType<typeof extension>,
		writeContract: async parameters =>
			await walletClient.sendTransaction({
				account: parameters.account,
				data: encodeFunctionData({
					abi: parameters.abi,
					...(parameters.args === undefined ? {} : { args: parameters.args }),
					functionName: parameters.functionName,
				}),
				gas: parameters.gas,
				gasPrice: parameters.gasPrice,
				maxFeePerGas: parameters.maxFeePerGas,
				maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
				to: parameters.address,
				value: parameters.value,
			}),
	}
	return walletClient
}

export function http(url: string, _options?: unknown) {
	return {
		kind: 'http',
		url,
	} satisfies Transport
}

export function custom(provider: EIP1193Provider, _options?: unknown) {
	return {
		kind: 'custom',
		provider,
	} satisfies Transport
}

export function getAddress(value: string): Address {
	if (value.startsWith('0X')) throw new Error(`Invalid address: ${value}`)
	const parsed = addr.parse(value)
	if (!addr.isValid(value)) throw new Error(`Invalid address: ${value}`)
	return ensure0x(addr.addChecksum(parsed.hasPrefix ? value : parsed.data)) as Address
}

export function isAddress(value: string) {
	if (value.startsWith('0X')) return false
	return addr.isValid(value)
}

export function isHex(value: string, options: { strict?: boolean | undefined } = {}) {
	if (options.strict === true && !value.startsWith('0x')) return false
	if (!value.startsWith('0x')) return false
	if (value === '0x') return true
	const normalized = stripHexPrefix(value)
	return isHexCharacter(normalized)
}

export function bytesToHex(value: Uint8Array) {
	return ensure0x(nobleBytesToHex(value))
}

export function hexToBytes(value: Hex | string) {
	return nobleHexToBytes(ensureEvenHex(stripHexPrefix(value)))
}

export function concatHex(values: readonly Hex[]) {
	return ensure0x(values.map(value => stripHexPrefix(value)).join(''))
}

export function toHex(value: bigint | number | string | Uint8Array, options: { size?: number | undefined } = {}) {
	if (typeof value === 'string') {
		return ensure0x(nobleBytesToHex(utf8ToBytes(value)))
	}
	if (typeof value === 'bigint' || typeof value === 'number') {
		const bigintValue = normalizeQuantityValue(value)
		if (options.size === undefined) return hexQuantity(bigintValue)
		const bytes = bigintToBytes(bigintValue)
		if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
		return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])))
	}
	const bytes = value
	if (options.size === undefined) return ensure0x(nobleBytesToHex(bytes))
	if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
	return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])))
}

export function numberToBytes(value: bigint | number, options: { size?: number | undefined } = {}) {
	const bytes = bigintToBytes(normalizeQuantityValue(value))
	if (options.size === undefined) return bytes
	if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
	return Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])
}

export function keccak256(value: Hex | Uint8Array | string) {
	if (typeof value === 'string' && value.startsWith('0x')) {
		return ensure0x(nobleBytesToHex(keccak_256(hexToBytes(value))))
	}
	const bytes = typeof value === 'string' ? utf8ToBytes(value) : value
	return ensure0x(nobleBytesToHex(keccak_256(bytes)))
}

export function encodeAbiParameters(parameters: readonly AbiParameter[], values: readonly unknown[]) {
	return deployContract(
		[
			{
				inputs: parameters.map(parameter => cloneAbiParameter(parameter, { stripName: false })),
				type: 'constructor',
			},
		],
		'0x',
		normalizeCodecArguments(parameters, values),
	) as Hex
}

export function encodeFunctionData(parameters: { abi: readonly unknown[]; args?: readonly unknown[]; functionName: string }): Hex
export function encodeFunctionData(parameters: { abi: readonly unknown[]; args?: readonly unknown[]; functionName: string }) {
	const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args)
	const method = getContractMethod(abiItem)
	return ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))))
}

export function decodeFunctionData<TAbi extends Abi>(parameters: { abi: TAbi; data: Hex }): DecodedFunctionData<TAbi>
export function decodeFunctionData(parameters: { abi: Abi; data: Hex }): {
	args: readonly unknown[]
	functionName: string
}
export function decodeFunctionData(parameters: { abi: Abi; data: Hex }) {
	const strippedAbi = normalizeAbi(parameters.abi)
		.filter((entry: AbiParameter) => entry.type === 'function')
		.map((entry: AbiParameter) => ({
			...normalizeFunctionAbiForCodec(entry),
			outputs: entry.outputs,
		}))
	const decoder = new Decoder()
	decoder.add(zeroAddress, strippedAbi as never)
	const decoded = decoder.decode(zeroAddress, nobleHexToBytes(stripHexPrefix(parameters.data)), {})
	if (decoded === undefined || Array.isArray(decoded)) throw new Error('Function selector was not found in the ABI')
	const functionAbi = getNamedFunctionAbi(parameters.abi, decoded.signature ?? decoded.name, normalizeDecodeFunctionArgs(decoded.value))
	return {
		args: normalizeDecodedArguments(functionAbi.inputs ?? [], decoded.value),
		functionName: decoded.name,
	}
}

function encodeDeploymentWithMicroEthSigner(abi: Abi, bytecode: Hex, constructorArguments: readonly unknown[]) {
	const deploymentEncoder = deployContract as (...args: readonly unknown[]) => unknown
	const encoded = deploymentEncoder(...[abi, bytecode, ...constructorArguments])
	if (typeof encoded !== 'string' || !isHex(encoded, { strict: true })) {
		throw new Error('Contract deployment encoding returned an invalid hex value')
	}
	return normalizeRpcHex(encoded)
}

export function encodeDeployData(parameters: { abi: Abi; args?: readonly unknown[]; bytecode: Hex }) {
	const constructorAbi = ensureConstructorAbi(parameters.abi)
	const constructorParameters = constructorAbi.find(entry => entry.type === 'constructor')?.inputs ?? []
	const constructorArguments = constructorParameters.length === 0 ? [] : [normalizeCodecArguments(constructorParameters, parameters.args)]
	return encodeDeploymentWithMicroEthSigner(constructorAbi, parameters.bytecode, constructorArguments)
}

export function decodeEventLog<TAbi extends Abi>(parameters: { abi: TAbi; data: Hex; topics: readonly Hex[] }): DecodedEventLog<TAbi>
export function decodeEventLog(parameters: { abi: Abi; data: Hex; topics: readonly Hex[] }): {
	args: TupleValue<readonly AbiParameter[], 'output'>
	eventName: string
}
export function decodeEventLog(parameters: { abi: Abi; data: Hex; topics: readonly Hex[] }) {
	const selector = parameters.topics[0]
	if (selector === undefined) throw createDecodeError('DecodeLogTopicsMismatch', 'Event topics were missing')
	const matchingEvent = normalizeAbi(parameters.abi).find((entry: AbiParameter) => entry.type === 'event' && getEventSignatureHash(entry) === stripHexPrefix(selector).toLowerCase())
	if (matchingEvent === undefined || matchingEvent.name === undefined) {
		throw createDecodeError('AbiEventSignatureNotFoundError', 'Event signature was not found in the ABI')
	}
	try {
		const decodedArgs = getEventDecoder(matchingEvent).decode(parameters.topics as string[], parameters.data)
		return {
			args: normalizeDecodedTuple(matchingEvent.inputs ?? [], decodedArgs),
			eventName: matchingEvent.name,
		}
	} catch (error) {
		if (error instanceof Error && error.message.toLowerCase().includes('topic')) {
			throw createDecodeError('DecodeLogTopicsMismatch', error.message)
		}
		if (error instanceof Error) throw createDecodeError('DecodeLogDataMismatch', error.message)
		throw createDecodeError('DecodeLogDataMismatch', 'Failed to decode event log')
	}
}

export function encodeEventTopics(parameters: { abi: Abi; args?: readonly unknown[] | Record<string, unknown> | undefined; eventName: string }) {
	const eventAbi = getNamedEventAbi(parameters.abi, parameters.eventName)
	return getEventDecoder(eventAbi)
		.topics(normalizeEventTopicArgs(eventAbi, parameters.args))
		.map((topic: string | null) => (topic === null ? null : ensure0x(topic)))
}

export function parseTransaction(serializedTransaction: Hex) {
	const transaction = Transaction.fromHex(serializedTransaction)
	return {
		chainId: 'chainId' in transaction.raw && typeof transaction.raw.chainId === 'bigint' ? transaction.raw.chainId : undefined,
		data: normalizeHexData(transaction.raw.data),
		gas: 'gasLimit' in transaction.raw ? transaction.raw.gasLimit : undefined,
		gasPrice: 'gasPrice' in transaction.raw && typeof transaction.raw.gasPrice === 'bigint' ? transaction.raw.gasPrice : undefined,
		maxFeePerGas: 'maxFeePerGas' in transaction.raw && typeof transaction.raw.maxFeePerGas === 'bigint' ? transaction.raw.maxFeePerGas : undefined,
		maxPriorityFeePerGas: 'maxPriorityFeePerGas' in transaction.raw && typeof transaction.raw.maxPriorityFeePerGas === 'bigint' ? transaction.raw.maxPriorityFeePerGas : undefined,
		nonce: 'nonce' in transaction.raw ? transaction.raw.nonce : undefined,
		to: transaction.raw.to === '0x' ? undefined : getAddress(transaction.raw.to),
		type: transaction.type,
		value: 'value' in transaction.raw ? transaction.raw.value : undefined,
	} satisfies ParsedTransaction
}

export async function recoverTransactionAddress(parameters: { serializedTransaction: Hex }) {
	return getAddress(Transaction.fromHex(parameters.serializedTransaction).sender)
}

export function privateKeyToAccount(privateKey: Hex) {
	return {
		address: getAddress(addr.fromPrivateKey(privateKey)),
		signMessage: async message => ensure0x(eip191Signer.sign(message, privateKey)),
		signTransaction: async parameters => {
			const type = parameters.gasPrice !== undefined ? 'legacy' : 'eip1559'
			const transaction = Transaction.prepare({
				chainId: hexToBigInt(parameters.chainId) ?? 1n,
				data: parameters.data ?? '0x',
				gasLimit: hexToBigInt(parameters.gas) ?? 21_000n,
				...(type === 'legacy'
					? {
							gasPrice: parameters.gasPrice ?? 0n,
							type,
						}
					: {
							maxFeePerGas: parameters.maxFeePerGas ?? parameters.maxPriorityFeePerGas ?? 0n,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas ?? 0n,
							type,
						}),
				nonce: hexToBigInt(parameters.nonce) ?? 0n,
				to: parameters.to ?? '0x',
				value: parameters.value ?? 0n,
			})
			return transaction.signBy(privateKey).toHex() as Hex
		},
		type: 'local',
	} satisfies Account
}

export function getCreateAddress(parameters: { from: Address; nonce: bigint }) {
	const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from))
	const nonceBytes = parameters.nonce === 0n ? new Uint8Array([]) : bigintToBytes(parameters.nonce)
	const encoded = rlpEncodeList([rlpEncodeBytes(fromBytes), rlpEncodeBytes(nonceBytes)])
	return checksumAddressFromBytes(keccak_256(encoded).slice(-20))
}

export function getCreate2Address(parameters: { bytecode?: Hex | undefined; bytecodeHash?: Hex | undefined; from: Address; salt: Hex | Uint8Array }) {
	const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from))
	const saltBytes = parameters.salt instanceof Uint8Array ? parameters.salt : hexToBytes(parameters.salt)
	if (saltBytes.length !== 32) throw new Error('CREATE2 salt must be 32 bytes')
	const bytecodeHashBytes = (() => {
		if (parameters.bytecodeHash !== undefined) return hexToBytes(parameters.bytecodeHash)
		if (parameters.bytecode === undefined) return undefined
		return keccak_256(hexToBytes(parameters.bytecode))
	})()
	if (bytecodeHashBytes === undefined) throw new Error('CREATE2 address derivation requires bytecode or bytecodeHash')
	const encoded = concatBytes(Uint8Array.of(0xff), fromBytes, saltBytes, bytecodeHashBytes)
	return checksumAddressFromBytes(keccak_256(encoded).slice(-20))
}

export function parseUnits(value: string, decimals: number) {
	const trimmed = value.trim()
	if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) throw new Error(`Invalid decimal value: ${value}`)
	const negative = trimmed.startsWith('-')
	const normalized = negative ? trimmed.slice(1) : trimmed
	const [wholePartRaw, fractionPartRaw = ''] = normalized.split('.')
	const wholePart = wholePartRaw === '' ? '0' : wholePartRaw
	const trimmedFraction = fractionPartRaw.replace(/0+$/, '')
	if (trimmedFraction.length > decimals) throw new Error(`Too many decimal places: expected at most ${decimals.toString()}`)
	const paddedFraction = trimmedFraction.padEnd(decimals, '0')
	const combined = `${wholePart}${paddedFraction}`.replace(/^0+/, '') || '0'
	const result = BigInt(combined)
	return negative ? -result : result
}

export function formatUnits(value: bigint, decimals: number) {
	const negative = value < 0n
	const normalized = negative ? -value : value
	const base = 10n ** BigInt(decimals)
	const whole = normalized / base
	const fraction = normalized % base
	if (fraction === 0n) return `${negative ? '-' : ''}${whole.toString()}`
	const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
	return `${negative ? '-' : ''}${whole.toString()}.${fractionString}`
}

export function formatEther(value: bigint) {
	return formatUnits(value, 18)
}

function findMatchingParenthesis(value: string, openingIndex: number) {
	let depth = 0
	for (let index = openingIndex; index < value.length; ++index) {
		const character = value[index]
		if (character === '(') {
			depth += 1
			continue
		}
		if (character !== ')') continue
		depth -= 1
		if (depth === 0) return index
	}
	throw new Error(`Unable to parse ABI item: ${value}`)
}

function splitTopLevelCommaSeparated(value: string) {
	const entries: string[] = []
	let current = ''
	let depth = 0
	for (const character of value) {
		if (character === '(') {
			depth += 1
			current += character
			continue
		}
		if (character === ')') {
			depth -= 1
			if (depth < 0) throw new Error(`Unable to parse ABI item: ${value}`)
			current += character
			continue
		}
		if (character === ',' && depth === 0) {
			const trimmedEntry = current.trim()
			if (trimmedEntry !== '') entries.push(trimmedEntry)
			current = ''
			continue
		}
		current += character
	}
	if (depth !== 0) throw new Error(`Unable to parse ABI item: ${value}`)
	const finalEntry = current.trim()
	if (finalEntry !== '') entries.push(finalEntry)
	return entries
}

function canonicalizeHumanReadableAbiType(type: string) {
	const typeMatch = /^(?<baseType>[^\[]+)(?<arraySuffix>(?:\[[0-9]*\])*)$/u.exec(type)
	if (typeMatch === null) return type
	const baseType = typeMatch.groups?.['baseType']
	const arraySuffix = typeMatch.groups?.['arraySuffix'] ?? ''
	if (baseType === undefined) return type
	const canonicalBaseType = (() => {
		if (baseType === 'uint') return 'uint256'
		if (baseType === 'int') return 'int256'
		if (baseType === 'byte') return 'bytes1'
		if (baseType === 'fixed') return 'fixed128x18'
		if (baseType === 'ufixed') return 'ufixed128x18'
		return baseType
	})()
	return `${canonicalBaseType}${arraySuffix}`
}

function parseAbiParameterEntry(entry: string): AbiParameter {
	const trimmedEntry = entry.trim()
	if (trimmedEntry === '') throw new Error(`Unable to parse ABI parameter: ${entry}`)
	const indexed = /(?:^|\s)indexed(?:\s|$)/u.test(trimmedEntry)
	const sanitizedEntry = trimmedEntry
		.replace(/\b(?:indexed|memory|calldata|storage)\b/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()

	if (/^(?:tuple\s*)?\(/u.test(sanitizedEntry)) {
		const openingIndex = sanitizedEntry.indexOf('(')
		const closingIndex = findMatchingParenthesis(sanitizedEntry, openingIndex)
		const componentsSource = sanitizedEntry.slice(openingIndex + 1, closingIndex)
		const trailingSource = sanitizedEntry.slice(closingIndex + 1).trim()
		const tupleMatch = /^(?<arraySuffix>(?:\[[0-9]*\])*)(?:\s*(?<name>[A-Za-z_][A-Za-z0-9_]*))?$/u.exec(trailingSource)
		if (tupleMatch === null) throw new Error(`Unable to parse ABI parameter: ${entry}`)
		const arraySuffix = tupleMatch.groups?.['arraySuffix'] ?? ''
		const name = tupleMatch.groups?.['name']
		return {
			...(indexed ? { indexed } : {}),
			...(name === undefined ? {} : { name }),
			components: parseParameterList(componentsSource),
			type: `tuple${arraySuffix}`,
		}
	}

	const parameterMatch = /^(?<type>\S+)(?:\s+(?<name>[A-Za-z_][A-Za-z0-9_]*))?$/u.exec(sanitizedEntry)
	if (parameterMatch === null) throw new Error(`Unable to parse ABI parameter: ${entry}`)
	const type = parameterMatch.groups?.['type']
	const name = parameterMatch.groups?.['name']
	if (type === undefined) throw new Error(`Unable to parse ABI parameter: ${entry}`)
	return {
		...(indexed ? { indexed } : {}),
		...(name === undefined ? {} : { name }),
		type: canonicalizeHumanReadableAbiType(type),
	}
}

function parseParameterList(value: string) {
	if (value.trim() === '') return []
	return splitTopLevelCommaSeparated(value).map<AbiParameter>(parseAbiParameterEntry)
}

export function parseAbiParameters(value: string) {
	return parseParameterList(value)
}

export function parseAbiItem(value: string) {
	const trimmed = value.trim()
	const functionHeaderMatch = /^function\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(trimmed)
	if (functionHeaderMatch !== null) {
		const name = functionHeaderMatch.groups?.['name']
		if (name === undefined) throw new Error(`Unsupported ABI item string: ${value}`)
		const inputsOpeningIndex = trimmed.indexOf('(', functionHeaderMatch[0].length - 1)
		const inputsClosingIndex = findMatchingParenthesis(trimmed, inputsOpeningIndex)
		const inputSource = trimmed.slice(inputsOpeningIndex + 1, inputsClosingIndex)
		const trailingSource = trimmed.slice(inputsClosingIndex + 1).trim()
		const returnsMatch = /\breturns\s*\(/u.exec(trailingSource)
		const modifiersSource = returnsMatch === null ? trailingSource : trailingSource.slice(0, returnsMatch.index).trim()
		const stateMutability = ['pure', 'view', 'payable', 'nonpayable'].find(candidate => new RegExp(`(?:^|\\s)${candidate}(?:\\s|$)`, 'u').test(modifiersSource))
		const unsupportedModifiers = modifiersSource
			.replace(/\b(?:external|public|internal|private|pure|view|payable|nonpayable)\b/gu, ' ')
			.replace(/\s+/gu, ' ')
			.trim()
		if (unsupportedModifiers !== '') throw new Error(`Unsupported ABI item string: ${value}`)

		const outputs = (() => {
			if (returnsMatch === null) return []
			const returnsOpeningIndex = trailingSource.indexOf('(', returnsMatch.index)
			const returnsClosingIndex = findMatchingParenthesis(trailingSource, returnsOpeningIndex)
			const trailingAfterReturns = trailingSource.slice(returnsClosingIndex + 1).trim()
			if (trailingAfterReturns !== '') throw new Error(`Unsupported ABI item string: ${value}`)
			return parseParameterList(trailingSource.slice(returnsOpeningIndex + 1, returnsClosingIndex))
		})()
		return {
			inputs: parseParameterList(inputSource),
			name,
			outputs,
			...(stateMutability === undefined ? {} : { stateMutability }),
			type: 'function',
		} satisfies AbiParameter
	}
	const eventHeaderMatch = /^event\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(trimmed)
	if (eventHeaderMatch !== null) {
		const name = eventHeaderMatch.groups?.['name']
		if (name === undefined) throw new Error(`Unsupported ABI item string: ${value}`)
		const inputsOpeningIndex = trimmed.indexOf('(', eventHeaderMatch[0].length - 1)
		const inputsClosingIndex = findMatchingParenthesis(trimmed, inputsOpeningIndex)
		const inputSource = trimmed.slice(inputsOpeningIndex + 1, inputsClosingIndex)
		const trailingSource = trimmed.slice(inputsClosingIndex + 1).trim()
		if (trailingSource !== '' && trailingSource !== 'anonymous') throw new Error(`Unsupported ABI item string: ${value}`)
		return {
			...(trailingSource === 'anonymous' ? { anonymous: true } : {}),
			inputs: parseParameterList(inputSource),
			name,
			type: 'event',
		} satisfies AbiParameter
	}
	throw new Error(`Unsupported ABI item string: ${value}`)
}
