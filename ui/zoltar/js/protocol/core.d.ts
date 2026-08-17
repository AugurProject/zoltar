import { type Abi, type Account, type Address, type Hash, type MulticallReturnType, type TransactionReceipt } from '@zoltar/shared/ethereum';
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/lib/chainBackend.js';
export type RpcStateRetryWait = (milliseconds: number) => Promise<void>;
export declare function readWithRpcStateRetries<T>(read: () => Promise<T>, isReady: (value: T) => boolean, wait?: RpcStateRetryWait): Promise<T>;
export type ContractRevertReasonParams = {
    account?: Account | Address | undefined | null;
    abi: Abi | readonly unknown[];
    address: Address;
    args?: readonly unknown[];
    contractLabel?: string;
    functionName: string;
    gas?: bigint;
    value?: bigint;
};
type ContractCallClient = {
    call?: WriteClient['call'];
};
type SubmittedTransactionClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = {
    onTransactionSubmitted?: ((hash: Hash) => void) | undefined;
    waitForTransactionReceipt: (...args: Parameters<WriteClient['waitForTransactionReceipt']>) => Promise<TReceipt>;
};
export type WriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<WriteClient, 'sendTransaction'> & ContractCallClient & {
    chain?: WriteClient['chain'];
    onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined;
    onTransactionSubmitted?: ((hash: Hash) => void) | undefined;
    requiresWalletConfirmation?: boolean | undefined;
    waitForTransactionReceipt: (...args: Parameters<WriteClient['waitForTransactionReceipt']>) => Promise<TReceipt>;
};
export declare function readRequiredMulticall<const TContracts extends readonly unknown[]>(client: Pick<ReadClient, 'multicall'>, contracts: TContracts, blockNumber?: bigint): Promise<MulticallReturnType<TContracts, false>>;
export declare function readOptionalMulticall<const TContracts extends readonly unknown[]>(client: Pick<ReadClient, 'multicall'>, contracts: TContracts): Promise<MulticallReturnType<TContracts, true>>;
export declare function writeContractAndWait<TCallParams extends ContractRevertReasonParams, TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, getCallParams: () => TCallParams): Promise<`0x${string}`>;
export declare function waitForSubmittedTransactionReceipt<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: SubmittedTransactionClient<TReceipt>, hash: Hash, { allowRevertedReceipt }?: {
    allowRevertedReceipt?: boolean;
}): Promise<{
    hash: Hash;
    receipt: TReceipt;
}>;
export declare function writeContractAndWaitForReceipt<TCallParams extends ContractRevertReasonParams, TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, getCallParams: () => TCallParams): Promise<{
    hash: Hash;
    receipt: TReceipt;
}>;
export {};
//# sourceMappingURL=core.d.ts.map