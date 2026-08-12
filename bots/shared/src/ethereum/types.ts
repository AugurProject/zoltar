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

export type FixedArrayValue<TValue, TLength extends number, TAccumulator extends readonly unknown[] = readonly []> = TAccumulator['length'] extends TLength ? TAccumulator : FixedArrayValue<TValue, TLength, readonly [...TAccumulator, TValue]>

export type TupleComponentName<TComponent extends AbiParameter> = TComponent['name']
export type AbiValueKind = 'input' | 'output'

export type TupleComponentsAllNamed<TComponents extends readonly AbiParameter[]> = TComponents extends readonly [] ? false : Extract<TupleComponentName<TComponents[number]>, undefined | ''> extends never ? true : false

export type TupleComponentsObject<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = {
	readonly [TComponent in TComponents[number] as TComponent['name'] extends string ? TComponent['name'] : never]: AbiParameterValue<TComponent, TKind>
}

export type TupleComponentsArray<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = Readonly<{
	[TIndex in keyof TComponents]: TComponents[TIndex] extends AbiParameter ? AbiParameterValue<TComponents[TIndex], TKind> : never
}>

export type TupleValue<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = TKind extends 'input'
	? TupleComponentsAllNamed<TComponents> extends true
		? TupleComponentsArray<TComponents, TKind> | TupleComponentsObject<TComponents, TKind>
		: TupleComponentsArray<TComponents, TKind>
	: TupleComponentsArray<TComponents, TKind> & (TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsObject<TComponents, TKind> : {})

export type RebasedAbiParameter<TParameter extends AbiParameter, TType extends string> = {
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

export type ArrayElementValue<TParameter extends AbiParameter, TElementType extends string, TKind extends AbiValueKind> = TElementType extends 'tuple'
	? TParameter['components'] extends readonly AbiParameter[]
		? TKind extends 'input'
			? TupleValue<TParameter['components'], TKind>
			: TupleComponentsAllNamed<TParameter['components']> extends true
				? TupleComponentsObject<TParameter['components'], TKind>
				: TupleComponentsArray<TParameter['components'], TKind>
		: unknown
	: AbiParameterValue<RebasedAbiParameter<TParameter, TElementType>, TKind>

export type AbiParameterValue<TParameter extends AbiParameter, TKind extends AbiValueKind> = string extends TParameter['type']
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

export type AbiParametersToValues<TParameters extends readonly AbiParameter[] | undefined, TKind extends AbiValueKind> = TParameters extends readonly AbiParameter[] ? TupleComponentsArray<TParameters, TKind> : readonly unknown[]

export type KnownAbiFunctions<TAbi extends Abi> = Extract<TAbi[number], { name: string; type: 'function' }>

export type ContractFunctionName<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never] ? string : Extract<KnownAbiFunctions<TAbi>['name'], string>

export type ContractFunctionDefinition<TAbi extends Abi, TFunctionName extends string> = [KnownAbiFunctions<TAbi>] extends [never]
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

export type ContractFunctionInputs<TAbi extends Abi, TFunctionName extends string> = ContractFunctionDefinition<TAbi, TFunctionName> extends {
	inputs?: infer TInputs extends readonly AbiParameter[]
}
	? TInputs
	: readonly AbiParameter[] | undefined

export type ContractFunctionOutputs<TAbi extends Abi, TFunctionName extends string> = ContractFunctionDefinition<TAbi, TFunctionName> extends {
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
				? TupleValue<TOutputs, 'output'>
				: unknown
	: unknown

export type KnownAbiEvents<TAbi extends Abi> = Extract<TAbi[number], { name: string; type: 'event' }>

export type ContractEventName<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never] ? string : Extract<KnownAbiEvents<TAbi>['name'], string>

export type ContractEventDefinition<TAbi extends Abi, TEventName extends string> = [KnownAbiEvents<TAbi>] extends [never]
	? {
			inputs?: readonly AbiParameter[]
		}
	: Extract<KnownAbiEvents<TAbi>, { name: TEventName }>

export type ContractEventArgs<TAbi extends Abi, TEventName extends string> = TupleValue<ContractEventDefinition<TAbi, TEventName>['inputs'] extends readonly AbiParameter[] ? ContractEventDefinition<TAbi, TEventName>['inputs'] : readonly [], 'output'>

export type DecodedFunctionData<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never]
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

export type DecodedEventLog<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never]
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

export type RpcLogForEvent<TEvent extends AbiParameter | undefined> = TEvent extends AbiParameter ? RpcLog<TEvent['inputs'] extends readonly AbiParameter[] ? TupleValue<TEvent['inputs'], 'output'> : TupleValue<readonly AbiParameter[], 'output'>, TEvent['name'] extends string ? TEvent['name'] : string> : RpcLog

export type ContractReadParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
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

export type ContractWriteParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	gas?: bigint | undefined
	value?: bigint | undefined
}

export type EstimateContractGasParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
	account?: Account | Address | undefined
	value?: bigint | undefined
}

export type MulticallContractResult<TContract> = TContract extends ContractFunctionParameters<infer TAbi, infer TFunctionName> ? ContractFunctionResult<TAbi, TFunctionName> : unknown

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

export type WaitForTransactionReceiptParameters = {
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

export type TypedTransport =
	| {
			kind: 'custom'
			provider: EIP1193Provider
			timeoutMilliseconds: number
	  }
	| {
			kind: 'http'
			timeoutMilliseconds: number
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

export type BlockTag = 'earliest' | 'latest' | 'pending'
export type LogTopicFilter = Hex | readonly Hex[] | null
