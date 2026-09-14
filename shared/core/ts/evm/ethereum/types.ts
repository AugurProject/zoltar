export type Hex = `0x${string}`

export type Address = Hex

export type Hash = Hex

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type AbiValue = JsonValue | bigint | Uint8Array | readonly AbiValue[] | { readonly [key: string]: AbiValue }

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

export type AbiEvent = AbiParameter & { readonly inputs: readonly AbiParameter[]; readonly name: string; readonly type: 'event' }

export type AbiFunction = AbiParameter & { readonly inputs: readonly AbiParameter[]; readonly name: string; readonly outputs: readonly AbiParameter[]; readonly type: 'function' }

type FixedArrayValue<TValue, TLength extends number, TAccumulator extends readonly TValue[] = readonly []> = TAccumulator['length'] extends TLength ? TAccumulator : FixedArrayValue<TValue, TLength, readonly [...TAccumulator, TValue]>

type AbiValueKind = 'input' | 'output'

type TupleComponentsAllNamed<TComponents extends readonly AbiParameter[]> = TComponents extends readonly [infer TComponent extends AbiParameter, ...infer TRest extends readonly AbiParameter[]]
	? TComponent extends { readonly name: infer TName extends string }
		? TName extends ''
			? false
			: TRest extends readonly []
				? true
				: TupleComponentsAllNamed<TRest>
		: false
	: false

type TupleComponentReservedAliasName = keyof [] | keyof Object | '__defineGetter__' | '__defineSetter__' | '__lookupGetter__' | '__lookupSetter__' | '__proto__'

type IsCanonicalNonNegativeIntegerName<TName extends string> = TName extends '0' ? true : TName extends `${infer TInteger extends bigint}` ? (`${TInteger}` extends TName ? (TName extends `-${string}` ? false : true) : false) : false

type TupleComponentsObject<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = {
	readonly [TComponent in TComponents[number] as TComponent['name'] extends string ? TComponent['name'] : never]: AbiParameterValue<TComponent, TKind>
}

type TupleComponentArrayAliasName<TComponent extends AbiParameter> = TComponent['name'] extends infer TName extends string ? (TName extends TupleComponentReservedAliasName ? never : IsCanonicalNonNegativeIntegerName<TName> extends true ? never : TName) : never

type TupleComponentsArrayAliases<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = {
	readonly [TComponent in TComponents[number] as TupleComponentArrayAliasName<TComponent>]: AbiParameterValue<TComponent, TKind>
}

type TupleComponentsArray<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = Readonly<{
	[TIndex in keyof TComponents]: TComponents[TIndex] extends AbiParameter ? AbiParameterValue<TComponents[TIndex], TKind> : never
}>

export type DecodedEventArguments<TComponents extends readonly AbiParameter[]> = number extends TComponents['length']
	? Readonly<Record<string, AbiValue>> | readonly AbiValue[]
	: TComponents extends readonly []
		? Readonly<Record<string, never>>
		: TupleComponentsAllNamed<TComponents> extends true
			? TupleComponentsObject<TComponents, 'output'>
			: TupleComponentsArray<TComponents, 'output'>

type TupleValue<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = TKind extends 'input'
	? TupleComponentsAllNamed<TComponents> extends true
		? TupleComponentsArray<TComponents, TKind> | TupleComponentsObject<TComponents, TKind>
		: TupleComponentsArray<TComponents, TKind>
	: TupleComponentsAllNamed<TComponents> extends true
		? TupleComponentsObject<TComponents, TKind>
		: TupleComponentsArray<TComponents, TKind>

type DecodedTupleArrayValue<TComponents extends readonly AbiParameter[]> = number extends TComponents['length'] ? AbiValue | undefined : TupleComponentsArray<TComponents, 'output'> & (TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsArrayAliases<TComponents, 'output'> : {})

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
		: AbiValue
	: AbiParameterValue<RebasedAbiParameter<TParameter, TElementType>, TKind>

type AbiParameterValue<TParameter extends AbiParameter, TKind extends AbiValueKind> = string extends TParameter['type']
	? AbiValue
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
									: AbiValue

type AbiParametersToValues<TParameters extends readonly AbiParameter[] | undefined, TKind extends AbiValueKind> = TParameters extends readonly AbiParameter[] ? TupleComponentsArray<TParameters, TKind> : readonly AbiValue[]

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

export type ContractFunctionResult<TAbi extends Abi, TFunctionName extends string> = ContractFunctionOutputs<TAbi, TFunctionName> extends infer TOutputs extends readonly AbiParameter[] | undefined
	? TOutputs extends readonly []
		? undefined
		: TOutputs extends readonly [infer TOutput extends AbiParameter]
			? AbiParameterValue<TOutput, 'output'>
			: TOutputs extends readonly AbiParameter[]
				? DecodedTupleArrayValue<TOutputs>
				: AbiValue | undefined
	: AbiValue | undefined

type KnownAbiEvents<TAbi extends Abi> = Extract<TAbi[number], { name: string; type: 'event' }>

type ContractEventName<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never] ? string : Extract<KnownAbiEvents<TAbi>['name'], string>

type ContractEventDefinition<TAbi extends Abi, TEventName extends string> = [KnownAbiEvents<TAbi>] extends [never]
	? {
			inputs?: readonly AbiParameter[]
		}
	: Extract<KnownAbiEvents<TAbi>, { name: TEventName }>

type ContractEventArgs<TAbi extends Abi, TEventName extends string> = DecodedEventArguments<ContractEventDefinition<TAbi, TEventName>['inputs'] extends readonly AbiParameter[] ? ContractEventDefinition<TAbi, TEventName>['inputs'] : readonly []>

export type DecodedFunctionData<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never]
	? {
			args: readonly AbiValue[]
			functionName: string
		}
	: {
			[TFunctionName in ContractFunctionName<TAbi>]: {
				args: AbiParametersToValues<ContractFunctionInputs<TAbi, TFunctionName>, 'output'>
				functionName: TFunctionName
			}
		}[ContractFunctionName<TAbi>]

export type DecodedEventLog<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never]
	? {
			args: DecodedEventArguments<readonly AbiParameter[]>
			eventName: string
		}
	: {
			[TEventName in ContractEventName<TAbi>]: {
				args: ContractEventArgs<TAbi, TEventName>
				eventName: TEventName
			}
		}[ContractEventName<TAbi>]

export type RpcLogForEvent<TEvent extends AbiParameter | undefined> = TEvent extends AbiParameter ? RpcLog<TEvent['inputs'] extends readonly AbiParameter[] ? DecodedEventArguments<TEvent['inputs']> : DecodedEventArguments<readonly AbiParameter[]>, TEvent['name'] extends string ? TEvent['name'] : string> : RpcLog

export type ContractReadParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	blockHash?: Hash | undefined
	blockNumber?: bigint | undefined
	blockTag?: BlockTag | undefined
	gas?: bigint | undefined
	value?: bigint | undefined
}

export type ContractSimulateParameters<TAbi extends Abi, TFunctionName extends string> = ContractReadParameters<TAbi, TFunctionName> & {
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
}

type ContractWriteParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	gas?: bigint | undefined
	value?: bigint | undefined
}

export type EstimateContractGasParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	value?: bigint | undefined
}

type EstimateGasParameters = {
	account?: Account | Address | undefined
	data?: Hex | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	to?: Address | undefined
	value?: bigint | undefined
}

type MulticallContractResult<TContract> = TContract extends ContractFunctionParameters<infer TAbi, infer TFunctionName> ? ContractFunctionResult<TAbi, TFunctionName> : AbiValue

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
	readonly [key: string]: JsonValue
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

export type Log = TransactionLog

export type TransactionReceipt = {
	blockHash: Hash
	blockNumber: bigint
	contractAddress?: Address | undefined
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
	blockHash?: Hash | undefined
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
	readonly transactions: readonly (Hex | BlockTransaction)[]
	timestamp: bigint
}

export type RpcLog<TArgs = AbiValue, TEventName extends string = string> = TransactionLog & {
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

type RpcRequestScheduler = <TValue>(method: string, operation: () => Promise<TValue>) => Promise<TValue>

export type RpcFetchFn = (input: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>

type RpcResponseParser = (response: Response, method: string) => Promise<JsonValue>

export type TransportRetryOptions = {
	requestScheduler?: RpcRequestScheduler | undefined
	retryCount?: number | undefined
	retryDelay?: number | undefined
}

export type HttpTransportOptions = TransportRetryOptions & {
	fetchFn?: RpcFetchFn | undefined
	requestTimeout?: number | undefined
	responseParser?: RpcResponseParser | undefined
}

type TypedTransport =
	| {
			kind: 'custom'
			provider: EIP1193Provider
			requestScheduler?: RpcRequestScheduler | undefined
			retryCount: number
			retryDelay: number
	  }
	| {
			kind: 'http'
			fetchFn?: RpcFetchFn | undefined
			requestTimeout: number
			requestScheduler?: RpcRequestScheduler | undefined
			responseParser?: RpcResponseParser | undefined
			retryCount: number
			retryDelay: number
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
			? MulticallSuccessResult<AbiValue> | MulticallFailureResult
			: AbiValue
}>

export type ClientRequestParameters = {
	method: string
	params?: unknown
}

export type BlockTag = 'earliest' | 'latest' | 'pending'

export type LogTopicFilter = Hex | readonly Hex[] | null

// `this` is the already-extended client, so chained extensions accumulate and each callback sees the ones before it.
export interface ExtendableClient {
	extend: <TExtension extends object>(extension: (client: this) => TExtension) => this & TExtension
}

export type PublicClientShape<TTransport extends Transport, TChain extends Chain | undefined> = ExtendableClient & {
	chain: TChain
	estimateContractGas: <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) => Promise<bigint>
	estimateGas: (parameters: EstimateGasParameters) => Promise<bigint>
	getBalance: (parameters: { address: Address; blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) => Promise<bigint>
	getBlock: (parameters?: { blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined; includeTransactions?: boolean | undefined }) => Promise<Block>
	getBlockNumber: () => Promise<bigint>
	getChainId: () => Promise<number>
	getCode: (parameters: { address: Address; blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) => Promise<Hex | undefined>
	getBytecode: (parameters: { address: Address; blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) => Promise<Hex | undefined>
	getGasPrice: () => Promise<bigint>
	getTransactionCount: (parameters: { address: Address; blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) => Promise<bigint>
	getLogs: <TEvent extends AbiParameter | undefined>(parameters: {
		address?: Address | readonly Address[] | undefined
		args?: Readonly<Record<string, unknown>> | undefined
		event?: TEvent
		fromBlock?: bigint | undefined
		toBlock?: bigint | undefined
		topics?: readonly LogTopicFilter[] | undefined
	}) => Promise<readonly RpcLogForEvent<TEvent>[]>
	getTransaction: (parameters: { hash: Hash }) => Promise<BlockTransaction>
	getTransactionReceipt: (parameters: { hash: Hash }) => Promise<TransactionReceipt>
	multicall: <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: { allowFailure: TAllowFailure; blockNumber?: bigint | undefined; contracts: TContracts; multicallAddress: Address }) => Promise<MulticallReturnType<TContracts, TAllowFailure>>
	readContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractReadParameters<TAbi, TFunctionName>) => Promise<ContractFunctionResult<TAbi, TFunctionName>>
	simulateContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => Promise<{ result: ContractFunctionResult<TAbi, TFunctionName> }>
	transport: TTransport
	waitForTransactionReceipt: (parameters: WaitForTransactionReceiptParameters) => Promise<TransactionReceipt>
}

export type PublicClientActions = Omit<PublicClientShape<Transport, Chain | undefined>, 'chain' | 'extend' | 'transport'>

type WalletClientShape<TTransport extends Transport, TChain extends Chain | undefined, TAccount extends Account | undefined> = PublicClientShape<TTransport, TChain> & {
	account: TAccount
	call: (parameters: { account?: Account | Address | undefined; data?: Hex | undefined; gas?: bigint | undefined; gasPrice?: bigint | undefined; maxFeePerGas?: bigint | undefined; maxPriorityFeePerGas?: bigint | undefined; to?: Address | undefined; value?: bigint | undefined }) => Promise<{ data: Hex | undefined }>
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

export type DeadlineRunner = <TValue>(operation: () => Promise<TValue>) => Promise<TValue>

export type EncodedEventTopic<TArgs> = TArgs extends readonly unknown[] ? (Extract<TArgs[number], readonly unknown[]> extends never ? Hex : Hex | readonly Hex[]) : TArgs extends Readonly<Record<string, unknown>> ? (Extract<TArgs[keyof TArgs], readonly unknown[]> extends never ? Hex : Hex | readonly Hex[]) : Hex
