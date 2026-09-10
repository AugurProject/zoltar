import { RpcError, Address, LogTopic, Hex, Abi, AbiItem, Transport } from 'viem';

type GetLogsRetryHelperParameters = {
    error: RpcError;
    params: [
        {
            address?: Address | Address[];
            topics?: LogTopic[];
            fromBlock: Hex;
            toBlock: Hex;
        }
    ];
};
type GetLogsRetryHelperReturnType = {
    shouldRetry: true;
    /** `true` if the error message suggested to use this range on retry. */
    isSuggestedRange: boolean;
    /** Suggested values to use for (fromBlock, toBlock) in follow-up eth_getLogs requests. */
    ranges: {
        fromBlock: Hex;
        toBlock: Hex;
    }[];
} | {
    shouldRetry: false;
    /** Suggested values to use for (fromBlock, toBlock) in follow-up eth_getLogs requests. */
    ranges?: never;
};
declare const getLogsRetryHelper: ({ params, error, }: GetLogsRetryHelperParameters) => GetLogsRetryHelperReturnType;

type MergeAbi<TBase extends Abi, TInsert extends Abi> = TInsert extends readonly [
    infer First extends AbiItem,
    ...infer Rest extends Abi
] ? Extract<TBase[number], First> extends never ? First["type"] extends "constructor" | "receive" | "fallback" ? MergeAbi<TBase, Rest> : MergeAbi<readonly [...TBase, First], Rest> : MergeAbi<TBase, Rest> : TBase;
type MergeAbis<TAbis extends readonly Abi[], TMerged extends Abi = []> = TAbis extends readonly [
    infer First extends Abi,
    ...infer Rest extends readonly Abi[]
] ? MergeAbis<Rest, MergeAbi<TMerged, First>> : TMerged;
/**
 * Combine multiple ABIs into one, removing duplicates if necessary.
 */
declare const mergeAbis: <const TAbis extends readonly Abi[]>(abis: TAbis) => MergeAbis<TAbis, []>;

/**
 * @description Creates a load balanced transport that spreads requests between child transports using a round robin algorithm.
 */
declare const loadBalance: (_transports: Transport[]) => Transport;

/**
 * @description Creates a rate limited transport that throttles request throughput.
 */
declare const rateLimit: (_transport: Transport, { requestsPerSecond, browser, }: {
    requestsPerSecond: number;
    browser?: boolean | undefined;
}) => Transport;

type _ReplaceBigInts<arr extends readonly unknown[], type, result extends readonly unknown[] = []> = arr extends [infer first, ...infer rest] ? _ReplaceBigInts<rest, type, readonly [...result, first extends bigint ? type : first]> : result;
type ReplaceBigInts<obj, type> = obj extends bigint ? type : obj extends unknown[] ? _ReplaceBigInts<Readonly<obj>, type> : obj extends readonly [] ? _ReplaceBigInts<obj, type> : obj extends object ? {
    [key in keyof obj]: ReplaceBigInts<obj[key], type>;
} : obj;
declare const replaceBigInts: <const T, const type>(obj: T, replacer: (x: bigint) => type) => ReplaceBigInts<T, type>;

export { type GetLogsRetryHelperParameters, type GetLogsRetryHelperReturnType, type MergeAbis, type ReplaceBigInts, getLogsRetryHelper, loadBalance, mergeAbis, rateLimit, replaceBigInts };
