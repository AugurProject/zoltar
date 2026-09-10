export type Hex = `0x${string}`;
export type Address = Hex;
export type Hash = Hex;
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export type AbiValue = JsonValue | bigint | Uint8Array | readonly AbiValue[] | {
    readonly [key: string]: AbiValue;
};
export type AbiParameter = {
    readonly anonymous?: boolean;
    readonly components?: readonly AbiParameter[];
    readonly internalType?: string;
    readonly indexed?: boolean;
    readonly inputs?: readonly AbiParameter[];
    readonly name?: string;
    readonly outputs?: readonly AbiParameter[];
    readonly stateMutability?: string;
    readonly type: string;
};
export type Abi = readonly AbiParameter[];
export type AbiEvent = AbiParameter & {
    readonly inputs: readonly AbiParameter[];
    readonly name: string;
    readonly type: 'event';
};
export type AbiFunction = AbiParameter & {
    readonly inputs: readonly AbiParameter[];
    readonly name: string;
    readonly outputs: readonly AbiParameter[];
    readonly type: 'function';
};
type FixedArrayValue<TValue, TLength extends number, TAccumulator extends readonly TValue[] = readonly []> = TAccumulator['length'] extends TLength ? TAccumulator : FixedArrayValue<TValue, TLength, readonly [...TAccumulator, TValue]>;
type AbiValueKind = 'input' | 'output';
type TupleComponentsAllNamed<TComponents extends readonly AbiParameter[]> = TComponents extends readonly [infer TComponent extends AbiParameter, ...infer TRest extends readonly AbiParameter[]] ? TComponent extends {
    readonly name: infer TName extends string;
} ? TName extends '' ? false : TRest extends readonly [] ? true : TupleComponentsAllNamed<TRest> : false : false;
type TupleComponentReservedAliasName = keyof [] | keyof Object | '__defineGetter__' | '__defineSetter__' | '__lookupGetter__' | '__lookupSetter__' | '__proto__';
type IsCanonicalNonNegativeIntegerName<TName extends string> = TName extends '0' ? true : TName extends `${infer TInteger extends bigint}` ? (`${TInteger}` extends TName ? (TName extends `-${string}` ? false : true) : false) : false;
type TupleComponentsObject<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = {
    readonly [TComponent in TComponents[number] as TComponent['name'] extends string ? TComponent['name'] : never]: AbiParameterValue<TComponent, TKind>;
};
type TupleComponentArrayAliasName<TComponent extends AbiParameter> = TComponent['name'] extends infer TName extends string ? (TName extends TupleComponentReservedAliasName ? never : IsCanonicalNonNegativeIntegerName<TName> extends true ? never : TName) : never;
type TupleComponentsArrayAliases<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = {
    readonly [TComponent in TComponents[number] as TupleComponentArrayAliasName<TComponent>]: AbiParameterValue<TComponent, TKind>;
};
type TupleComponentsArray<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = Readonly<{
    [TIndex in keyof TComponents]: TComponents[TIndex] extends AbiParameter ? AbiParameterValue<TComponents[TIndex], TKind> : never;
}>;
type DecodedEventArguments<TComponents extends readonly AbiParameter[]> = number extends TComponents['length'] ? Readonly<Record<string, AbiValue>> | readonly AbiValue[] : TComponents extends readonly [] ? Readonly<Record<string, never>> : TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsObject<TComponents, 'output'> : TupleComponentsArray<TComponents, 'output'>;
type TupleValue<TComponents extends readonly AbiParameter[], TKind extends AbiValueKind> = TKind extends 'input' ? TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsArray<TComponents, TKind> | TupleComponentsObject<TComponents, TKind> : TupleComponentsArray<TComponents, TKind> : TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsObject<TComponents, TKind> : TupleComponentsArray<TComponents, TKind>;
type DecodedTupleArrayValue<TComponents extends readonly AbiParameter[]> = number extends TComponents['length'] ? AbiValue | undefined : TupleComponentsArray<TComponents, 'output'> & (TupleComponentsAllNamed<TComponents> extends true ? TupleComponentsArrayAliases<TComponents, 'output'> : {});
type RebasedAbiParameter<TParameter extends AbiParameter, TType extends string> = {
    readonly anonymous?: boolean;
    readonly components?: Exclude<TParameter['components'], undefined>;
    readonly internalType?: Exclude<TParameter['internalType'], undefined>;
    readonly indexed?: boolean;
    readonly inputs?: Exclude<TParameter['inputs'], undefined>;
    readonly name?: Exclude<TParameter['name'], undefined>;
    readonly outputs?: Exclude<TParameter['outputs'], undefined>;
    readonly stateMutability?: Exclude<TParameter['stateMutability'], undefined>;
    readonly type: TType;
};
type ArrayElementValue<TParameter extends AbiParameter, TElementType extends string, TKind extends AbiValueKind> = TElementType extends 'tuple' ? TParameter['components'] extends readonly AbiParameter[] ? TKind extends 'input' ? TupleValue<TParameter['components'], TKind> : TupleComponentsAllNamed<TParameter['components']> extends true ? TupleComponentsObject<TParameter['components'], TKind> : TupleComponentsArray<TParameter['components'], TKind> : AbiValue : AbiParameterValue<RebasedAbiParameter<TParameter, TElementType>, TKind>;
type AbiParameterValue<TParameter extends AbiParameter, TKind extends AbiValueKind> = string extends TParameter['type'] ? AbiValue : TParameter['type'] extends `${infer TElementType}[${infer TSize}]` ? TSize extends `${infer TLength extends number}` ? FixedArrayValue<ArrayElementValue<TParameter, TElementType, TKind>, TLength> : readonly ArrayElementValue<TParameter, TElementType, TKind>[] : TParameter['type'] extends 'tuple' ? TupleValue<TParameter['components'] extends readonly AbiParameter[] ? TParameter['components'] : readonly [], TKind> : TParameter['type'] extends 'address' ? Address : TParameter['type'] extends 'bool' ? boolean : TParameter['type'] extends 'bytes' | `bytes${number}` ? Hex : TParameter['type'] extends 'function' ? Hex : TParameter['type'] extends 'int' | 'uint' | `${'int' | 'uint'}${number}` ? TKind extends 'input' ? bigint | number : bigint : TParameter['type'] extends 'string' ? string : AbiValue;
type AbiParametersToValues<TParameters extends readonly AbiParameter[] | undefined, TKind extends AbiValueKind> = TParameters extends readonly AbiParameter[] ? TupleComponentsArray<TParameters, TKind> : readonly AbiValue[];
type KnownAbiFunctions<TAbi extends Abi> = Extract<TAbi[number], {
    name: string;
    type: 'function';
}>;
type ContractFunctionName<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never] ? string : Extract<KnownAbiFunctions<TAbi>['name'], string>;
type ContractFunctionDefinition<TAbi extends Abi, TFunctionName extends string> = [KnownAbiFunctions<TAbi>] extends [never] ? {
    inputs?: readonly AbiParameter[];
    outputs?: readonly AbiParameter[];
} : Extract<KnownAbiFunctions<TAbi>, {
    name: TFunctionName;
}> extends infer TFunction ? [TFunction] extends [never] ? {
    inputs?: readonly AbiParameter[];
    outputs?: readonly AbiParameter[];
} : TFunction : never;
type ContractFunctionInputs<TAbi extends Abi, TFunctionName extends string> = ContractFunctionDefinition<TAbi, TFunctionName> extends {
    inputs?: infer TInputs extends readonly AbiParameter[];
} ? TInputs : readonly AbiParameter[] | undefined;
type ContractFunctionOutputs<TAbi extends Abi, TFunctionName extends string> = ContractFunctionDefinition<TAbi, TFunctionName> extends {
    outputs?: infer TOutputs extends readonly AbiParameter[];
} ? TOutputs : readonly AbiParameter[] | undefined;
type ContractFunctionResult<TAbi extends Abi, TFunctionName extends string> = ContractFunctionOutputs<TAbi, TFunctionName> extends infer TOutputs extends readonly AbiParameter[] | undefined ? TOutputs extends readonly [] ? undefined : TOutputs extends readonly [infer TOutput extends AbiParameter] ? AbiParameterValue<TOutput, 'output'> : TOutputs extends readonly AbiParameter[] ? DecodedTupleArrayValue<TOutputs> : AbiValue | undefined : AbiValue | undefined;
type KnownAbiEvents<TAbi extends Abi> = Extract<TAbi[number], {
    name: string;
    type: 'event';
}>;
type ContractEventName<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never] ? string : Extract<KnownAbiEvents<TAbi>['name'], string>;
type ContractEventDefinition<TAbi extends Abi, TEventName extends string> = [KnownAbiEvents<TAbi>] extends [never] ? {
    inputs?: readonly AbiParameter[];
} : Extract<KnownAbiEvents<TAbi>, {
    name: TEventName;
}>;
type ContractEventArgs<TAbi extends Abi, TEventName extends string> = DecodedEventArguments<ContractEventDefinition<TAbi, TEventName>['inputs'] extends readonly AbiParameter[] ? ContractEventDefinition<TAbi, TEventName>['inputs'] : readonly []>;
type DecodedFunctionData<TAbi extends Abi> = [KnownAbiFunctions<TAbi>] extends [never] ? {
    args: readonly AbiValue[];
    functionName: string;
} : {
    [TFunctionName in ContractFunctionName<TAbi>]: {
        args: AbiParametersToValues<ContractFunctionInputs<TAbi, TFunctionName>, 'output'>;
        functionName: TFunctionName;
    };
}[ContractFunctionName<TAbi>];
type DecodedEventLog<TAbi extends Abi> = [KnownAbiEvents<TAbi>] extends [never] ? {
    args: DecodedEventArguments<readonly AbiParameter[]>;
    eventName: string;
} : {
    [TEventName in ContractEventName<TAbi>]: {
        args: ContractEventArgs<TAbi, TEventName>;
        eventName: TEventName;
    };
}[ContractEventName<TAbi>];
type RpcLogForEvent<TEvent extends AbiParameter | undefined> = TEvent extends AbiParameter ? RpcLog<TEvent['inputs'] extends readonly AbiParameter[] ? DecodedEventArguments<TEvent['inputs']> : DecodedEventArguments<readonly AbiParameter[]>, TEvent['name'] extends string ? TEvent['name'] : string> : RpcLog;
type ContractReadParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
    account?: Account | Address | undefined;
    blockHash?: Hash | undefined;
    blockNumber?: bigint | undefined;
    blockTag?: BlockTag | undefined;
    gas?: bigint | undefined;
    value?: bigint | undefined;
};
type ContractSimulateParameters<TAbi extends Abi, TFunctionName extends string> = ContractReadParameters<TAbi, TFunctionName> & {
    gasPrice?: bigint | undefined;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
};
type ContractWriteParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
    account?: Account | Address | undefined;
    gas?: bigint | undefined;
    value?: bigint | undefined;
};
type EstimateContractGasParameters<TAbi extends Abi, TFunctionName extends string> = ContractFunctionParameters<TAbi, TFunctionName> & {
    account?: Account | Address | undefined;
    value?: bigint | undefined;
};
export type EstimateGasParameters = {
    account?: Account | Address | undefined;
    data?: Hex | undefined;
    gasPrice?: bigint | undefined;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
    to?: Address | undefined;
    value?: bigint | undefined;
};
type MulticallContractResult<TContract> = TContract extends ContractFunctionParameters<infer TAbi, infer TFunctionName> ? ContractFunctionResult<TAbi, TFunctionName> : AbiValue;
export type ContractFunctionParameters<TAbi extends Abi = Abi, TFunctionName extends string = string> = {
    abi: TAbi;
    address: Address;
    args?: AbiParametersToValues<ContractFunctionInputs<TAbi, TFunctionName>, 'input'> | undefined;
    functionName: TFunctionName;
    gasPrice?: bigint | undefined;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
};
export type Chain = {
    id: number;
    name: string;
    nativeCurrency: {
        decimals: number;
        name: string;
        symbol: string;
    };
    rpcUrls: {
        default: {
            http: readonly string[];
        };
    };
    readonly [key: string]: JsonValue;
};
export type EIP1193Provider = {
    request: (parameters: {
        method: string;
        params?: unknown;
    }) => Promise<unknown>;
};
export type TransactionLog = {
    address: Address;
    blockHash?: Hash | undefined;
    blockNumber?: bigint | undefined;
    data: Hex;
    logIndex?: bigint | undefined;
    removed?: boolean | undefined;
    topics: readonly Hex[];
    transactionHash?: Hash | undefined;
    transactionIndex?: bigint | undefined;
};
export type Log = TransactionLog;
export type TransactionReceipt = {
    blockHash: Hash;
    blockNumber: bigint;
    contractAddress?: Address | null | undefined;
    cumulativeGasUsed: bigint;
    effectiveGasPrice?: bigint | undefined;
    from: Address;
    gasUsed: bigint;
    logs: TransactionLog[];
    logsBloom?: Hex | undefined;
    status: 'reverted' | 'success';
    to?: Address | null | undefined;
    transactionHash: Hash;
    transactionIndex: bigint;
    type?: string | undefined;
};
export type ReplacementReason = 'cancelled' | 'replaced' | 'repriced';
export type TransactionReplacement = {
    reason: ReplacementReason;
    replacedTransaction: Pick<BlockTransaction, 'hash'>;
    transaction: Pick<BlockTransaction, 'hash'>;
    transactionReceipt: TransactionReceipt;
};
export type WaitForTransactionReceiptParameters = {
    hash: Hash;
    onReplaced?: ((replacement: TransactionReplacement) => void) | undefined;
    pollingInterval?: number | undefined;
    transaction?: BlockTransaction | undefined;
    timeout?: number | undefined;
};
export type BlockTransaction = {
    blockHash?: Hash | undefined;
    blockNumber?: bigint | undefined;
    from: Address;
    gas: bigint;
    gasPrice?: bigint | undefined;
    hash: Hash;
    input: Hex;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
    nonce: bigint;
    to?: Address | null | undefined;
    transactionIndex?: bigint | undefined;
    type?: string | undefined;
    value: bigint;
};
export type Transaction = BlockTransaction;
export type Block = {
    baseFeePerGas?: bigint | undefined;
    hash?: Hash | undefined;
    number?: bigint | undefined;
    parentHash?: Hash | undefined;
    readonly transactions: readonly (Hex | BlockTransaction)[];
    timestamp: bigint;
};
export type RpcLog<TArgs = AbiValue, TEventName extends string = string> = TransactionLog & {
    args?: TArgs;
    eventName?: TEventName | undefined;
};
export type Account = {
    address: Address;
    signMessage?: (message: string | Uint8Array) => Promise<Hex>;
    signTransaction?: (parameters: SignTransactionParameters) => Promise<Hex>;
    type: 'json-rpc' | 'local' | string;
};
export type SignTransactionParameters = {
    chainId?: bigint | number | undefined;
    data?: Hex | undefined;
    gas?: bigint | number | undefined;
    gasPrice?: bigint | undefined;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
    nonce?: bigint | number | undefined;
    to?: Address | undefined;
    value?: bigint | undefined;
};
export type ParsedTransaction = {
    chainId?: bigint | undefined;
    data?: Hex | undefined;
    gas?: bigint | undefined;
    gasPrice?: bigint | undefined;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
    nonce?: bigint | undefined;
    to?: Address | undefined;
    type?: string | undefined;
    value?: bigint | undefined;
};
export type RpcRequestScheduler = <TValue>(method: string, operation: () => Promise<TValue>) => Promise<TValue>;
export type RpcFetchFn = (input: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
export type RpcResponseParser = (response: Response, method: string) => Promise<JsonValue>;
type TransportRetryOptions = {
    batch?: {
        readonly wait?: number;
    } | undefined;
    requestScheduler?: RpcRequestScheduler | undefined;
    retryCount?: number | undefined;
    retryDelay?: number | undefined;
};
export type HttpTransportOptions = TransportRetryOptions & {
    fetchFn?: RpcFetchFn | undefined;
    requestTimeout?: number | undefined;
    responseParser?: RpcResponseParser | undefined;
};
type TypedTransport = {
    kind: 'custom';
    provider: EIP1193Provider;
    requestScheduler?: RpcRequestScheduler | undefined;
    retryCount: number;
    retryDelay: number;
} | {
    kind: 'http';
    fetchFn?: RpcFetchFn | undefined;
    requestTimeout: number;
    requestScheduler?: RpcRequestScheduler | undefined;
    responseParser?: RpcResponseParser | undefined;
    retryCount: number;
    retryDelay: number;
    url: string;
};
export type Transport = TypedTransport;
export type MulticallSuccessResult<TValue> = {
    result: TValue;
    status: 'success';
};
export type MulticallFailureResult = {
    error: Error;
    status: 'failure';
};
export type MulticallReturnType<TContracts extends readonly unknown[], TAllowFailure extends boolean> = Readonly<{
    [TIndex in keyof TContracts]: TContracts[TIndex] extends ContractFunctionParameters ? TAllowFailure extends true ? MulticallSuccessResult<MulticallContractResult<TContracts[TIndex]>> | MulticallFailureResult : MulticallContractResult<TContracts[TIndex]> : TAllowFailure extends true ? MulticallSuccessResult<AbiValue> | MulticallFailureResult : AbiValue;
}>;
export declare class RpcError extends Error {
    code?: number | string | undefined;
    cause?: unknown;
    shortMessage?: string | undefined;
    constructor(message: string, options?: {
        cause?: unknown;
        code?: number | string | undefined;
        shortMessage?: string | undefined;
    });
}
export declare const zeroAddress: `0x${string}`;
export declare const zeroHash: `0x${string}`;
export declare const maxUint256: bigint;
type BlockTag = 'earliest' | 'latest' | 'pending';
type LogTopicFilter = Hex | readonly Hex[] | null;
export declare const RATE_LIMIT_RETRY_DELAY_MILLISECONDS = 10000;
type PublicClientShape<TTransport extends Transport, TChain extends Chain | undefined> = {
    chain: TChain;
    extend: <TExtension extends object>(extension: (client: PublicClientShape<TTransport, TChain>) => TExtension) => PublicClientShape<TTransport, TChain> & TExtension;
    estimateContractGas: <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) => Promise<bigint>;
    estimateGas: (parameters: EstimateGasParameters) => Promise<bigint>;
    getBalance: (parameters: {
        address: Address;
        blockNumber?: bigint | undefined;
        blockTag?: BlockTag | undefined;
    }) => Promise<bigint>;
    getBlock: (parameters?: {
        blockNumber?: bigint | undefined;
        blockTag?: BlockTag | undefined;
        includeTransactions?: boolean | undefined;
    }) => Promise<Block>;
    getBlockNumber: () => Promise<bigint>;
    getChainId: () => Promise<number>;
    getCode: (parameters: {
        address: Address;
        blockNumber?: bigint | undefined;
        blockTag?: BlockTag | undefined;
    }) => Promise<Hex | undefined>;
    getBytecode: (parameters: {
        address: Address;
        blockNumber?: bigint | undefined;
        blockTag?: BlockTag | undefined;
    }) => Promise<Hex | undefined>;
    getGasPrice: () => Promise<bigint>;
    getTransactionCount: (parameters: {
        address: Address;
        blockNumber?: bigint | undefined;
        blockTag?: BlockTag | undefined;
    }) => Promise<bigint>;
    getLogs: <TEvent extends AbiParameter | undefined>(parameters: {
        address?: Address | readonly Address[] | undefined;
        args?: Readonly<Record<string, unknown>> | undefined;
        event?: TEvent;
        fromBlock?: bigint | undefined;
        toBlock?: bigint | undefined;
        topics?: readonly LogTopicFilter[] | undefined;
    }) => Promise<readonly RpcLogForEvent<TEvent>[]>;
    getTransaction: (parameters: {
        hash: Hash;
    }) => Promise<BlockTransaction>;
    getTransactionReceipt: (parameters: {
        hash: Hash;
    }) => Promise<TransactionReceipt>;
    multicall: <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: {
        allowFailure: TAllowFailure;
        blockNumber?: bigint | undefined;
        contracts: TContracts;
        multicallAddress: Address;
    }) => Promise<MulticallReturnType<TContracts, TAllowFailure>>;
    readContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractReadParameters<TAbi, TFunctionName>) => Promise<ContractFunctionResult<TAbi, TFunctionName>>;
    simulateContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => Promise<{
        result: ContractFunctionResult<TAbi, TFunctionName>;
    }>;
    transport: TTransport;
    waitForTransactionReceipt: (parameters: WaitForTransactionReceiptParameters) => Promise<TransactionReceipt>;
};
type WalletClientShape<TTransport extends Transport, TChain extends Chain | undefined, TAccount extends Account | undefined> = Omit<PublicClientShape<TTransport, TChain>, 'extend'> & {
    account: TAccount;
    call: (parameters: {
        account?: Account | Address | undefined;
        data?: Hex | undefined;
        gas?: bigint | undefined;
        gasPrice?: bigint | undefined;
        maxFeePerGas?: bigint | undefined;
        maxPriorityFeePerGas?: bigint | undefined;
        to?: Address | undefined;
        value?: bigint | undefined;
    }) => Promise<{
        data: Hex | undefined;
    }>;
    extend: <TExtension extends object>(extension: (client: WalletClientShape<TTransport, TChain, TAccount>) => TExtension) => WalletClientShape<TTransport, TChain, TAccount> & TExtension;
    sendRawTransaction: (parameters: {
        serializedTransaction: Hex;
    }) => Promise<Hash>;
    sendTransaction: (parameters: {
        account?: Account | Address | undefined;
        amount?: bigint | undefined;
        data?: Hex | undefined;
        gas?: bigint | undefined;
        gasPrice?: bigint | undefined;
        maxFeePerGas?: bigint | undefined;
        maxPriorityFeePerGas?: bigint | undefined;
        nonce?: bigint | number | undefined;
        to?: Address | null | undefined;
        value?: bigint | undefined;
    }) => Promise<Hash>;
    writeContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractWriteParameters<TAbi, TFunctionName>) => Promise<Hash>;
};
export type PublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined> = PublicClientShape<TTransport, TChain>;
export type WalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined, TAccount extends Account | undefined = Account | undefined> = WalletClientShape<TTransport, TChain, TAccount>;
export type PublicActions<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined> = Omit<PublicClient<TTransport, TChain>, 'chain' | 'extend' | 'transport'>;
export declare const mainnet: {
    id: number;
    name: string;
    nativeCurrency: {
        decimals: number;
        name: string;
        symbol: string;
    };
    rpcUrls: {
        default: {
            http: string[];
        };
    };
};
export declare function defineChain<TChain extends Chain>(chain: TChain): TChain;
export declare function bigintToSafeNumber(value: bigint, label?: string): number;
export declare function formatAbiParameter(parameter: AbiParameter): string;
export declare function formatAbiItem(parameter: AbiParameter): string;
export declare function toEventSelector(parameter: AbiParameter): Hex;
export declare function toFunctionSelector(parameter: AbiParameter): Hex;
export declare function requestRpc<TValue>(transport: Transport, parameters: {
    method: string;
    params?: unknown;
}): Promise<TValue>;
export declare function publicActions<TTransport extends Transport, TChain extends Chain | undefined>(client: PublicClientShape<TTransport, TChain>): Omit<PublicClientShape<TTransport, TChain>, "chain" | "extend" | "transport">;
export declare function createPublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ chain, transport }: {
    cacheTime?: number | undefined;
    chain?: TChain;
    transport: TTransport;
}): PublicClient<TTransport, TChain>;
export declare function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: {
    account: Account | Address;
    cacheTime?: number | undefined;
    chain?: TChain;
    transport: TTransport;
}): WalletClient<TTransport, TChain, Account>;
export declare function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: {
    account?: undefined;
    cacheTime?: number | undefined;
    chain?: TChain;
    transport: TTransport;
}): WalletClient<TTransport, TChain, undefined>;
export declare function http(url: string, options?: HttpTransportOptions): {
    url: string;
    requestTimeout: number;
    retryCount: number;
    retryDelay: number;
    requestScheduler?: RpcRequestScheduler | undefined;
    responseParser?: RpcResponseParser | undefined;
    fetchFn?: RpcFetchFn | undefined;
    kind: "http";
};
export declare function custom(provider: EIP1193Provider, options?: TransportRetryOptions): {
    retryCount: number;
    retryDelay: number;
    requestScheduler?: RpcRequestScheduler | undefined;
    kind: "custom";
    provider: EIP1193Provider;
};
export declare function getAddress(value: string): Address;
export declare function isAddress(value: string): boolean;
export declare function isHex(value: string, options?: {
    strict?: boolean | undefined;
}): boolean;
export declare function bytesToHex(value: Uint8Array): `0x${string}`;
export declare function hexToBytes(value: Hex | string): Uint8Array<ArrayBufferLike> & Uint8Array<ArrayBuffer>;
export declare function concatHex(values: readonly Hex[]): `0x${string}`;
export declare function toHex(value: bigint | number | string | Uint8Array, options?: {
    size?: number | undefined;
}): `0x${string}`;
export declare function stringToHex(value: string): Hex;
export declare function numberToBytes(value: bigint | number, options?: {
    size?: number | undefined;
}): Uint8Array<ArrayBuffer>;
export declare function keccak256(value: Hex | Uint8Array | string): `0x${string}`;
export declare function encodeAbiParameters(parameters: readonly AbiParameter[], values: readonly unknown[]): Hex;
export declare function encodeFunctionData(parameters: {
    abi: readonly unknown[];
    args?: readonly unknown[];
    functionName: string;
}): Hex;
export declare function decodeFunctionData<TAbi extends Abi>(parameters: {
    abi: TAbi;
    data: Hex;
}): DecodedFunctionData<TAbi>;
export declare function decodeFunctionData(parameters: {
    abi: Abi;
    data: Hex;
}): {
    args: readonly AbiValue[];
    functionName: string;
};
export declare function decodeFunctionResult<TAbi extends Abi, TFunctionName extends string>(parameters: {
    abi: TAbi;
    data: Hex;
    functionName: TFunctionName;
}): ContractFunctionResult<TAbi, TFunctionName>;
export declare function encodeDeployData(parameters: {
    abi: Abi;
    args?: readonly unknown[];
    bytecode: Hex;
}): `0x${string}`;
export declare function decodeEventLog<TAbi extends Abi>(parameters: {
    abi: TAbi;
    data: Hex;
    topics: readonly Hex[];
}): DecodedEventLog<TAbi>;
export declare function decodeEventLog(parameters: {
    abi: Abi;
    data: Hex;
    topics: readonly Hex[];
}): {
    args: DecodedEventArguments<readonly AbiParameter[]>;
    eventName: string;
};
type EncodedEventTopic<TArgs> = TArgs extends readonly unknown[] ? (Extract<TArgs[number], readonly unknown[]> extends never ? Hex : Hex | readonly Hex[]) : TArgs extends Readonly<Record<string, unknown>> ? (Extract<TArgs[keyof TArgs], readonly unknown[]> extends never ? Hex : Hex | readonly Hex[]) : Hex;
export declare function encodeEventTopics<const TArgs extends readonly unknown[] | Record<string, unknown> | undefined = undefined>(parameters: {
    abi: Abi;
    args?: TArgs;
    eventName: string;
}): readonly (EncodedEventTopic<TArgs> | null)[];
export declare function parseTransaction(serializedTransaction: Hex): {
    chainId: bigint | undefined;
    data: `0x${string}` | undefined;
    gas: bigint | undefined;
    gasPrice: bigint | undefined;
    maxFeePerGas: bigint | undefined;
    maxPriorityFeePerGas: bigint | undefined;
    nonce: bigint | undefined;
    to: `0x${string}` | undefined;
    type: "legacy" | "eip2930" | "eip1559" | "eip4844" | "eip7702";
    value: bigint | undefined;
};
export declare function recoverTransactionAddress(parameters: {
    serializedTransaction: Hex;
}): Promise<`0x${string}`>;
export declare function privateKeyToAccount(privateKey: Hex): {
    address: `0x${string}`;
    signMessage: (message: string | Uint8Array<ArrayBufferLike>) => Promise<`0x${string}`>;
    signTransaction: (parameters: SignTransactionParameters) => Promise<`0x${string}`>;
    type: string;
};
export declare function getCreateAddress(parameters: {
    from: Address;
    nonce: bigint;
}): `0x${string}`;
export declare function getCreate2Address(parameters: {
    bytecode?: Hex | undefined;
    bytecodeHash?: Hex | undefined;
    from: Address;
    salt: Hex | Uint8Array;
}): `0x${string}`;
export declare function parseUnits(value: string, decimals: number): bigint;
export declare function formatUnits(value: bigint, decimals: number): string;
export declare function formatEther(value: bigint): string;
export declare function parseAbiParameters(value: string): AbiParameter[];
export declare function parseAbi(values: readonly string[]): Abi;
export declare function parseAbiItem(value: string): {
    type: string;
    stateMutability?: string | undefined;
    inputs: AbiParameter[];
    name: string;
    outputs: AbiParameter[];
} | {
    inputs: AbiParameter[];
    name: string;
    type: string;
    anonymous?: true | undefined;
};
export {};
