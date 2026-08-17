import { encodeFunctionData, RpcError } from '@zoltar/shared/ethereum';
import { getMulticall3Address } from './deploymentHelpers.js';
import { getContractLabel } from './contractLabels.js';
const RPC_STATE_RETRY_DELAYS_MILLISECONDS = [250, 500, 1_000, 2_000, 4_000];
export async function readWithRpcStateRetries(read, isReady, wait = async (milliseconds) => await new Promise(resolve => setTimeout(resolve, milliseconds))) {
    let value = await read();
    for (const delayMilliseconds of RPC_STATE_RETRY_DELAYS_MILLISECONDS) {
        if (isReady(value))
            return value;
        await wait(delayMilliseconds);
        value = await read();
    }
    return value;
}
export async function readRequiredMulticall(client, contracts, blockNumber) {
    return (await client.multicall({
        allowFailure: false,
        blockNumber,
        contracts: contracts,
        multicallAddress: getMulticall3Address(),
    }));
}
export async function readOptionalMulticall(client, contracts) {
    return (await client.multicall({
        allowFailure: true,
        contracts: contracts,
        multicallAddress: getMulticall3Address(),
    }));
}
async function getContractRevertReason(client, params) {
    if (client.call === undefined)
        return undefined;
    try {
        const data = encodeFunctionData({
            abi: params.abi,
            ...(params.args === undefined ? {} : { args: params.args }),
            functionName: params.functionName,
        });
        const account = params.account ?? undefined;
        await client.call({
            account,
            data,
            gas: params.gas,
            to: params.address,
            value: params.value,
        });
        return undefined;
    }
    catch (error) {
        if (error instanceof RpcError)
            return error.shortMessage ?? error.message ?? (error.cause instanceof Error ? error.cause.message : undefined);
        if (error instanceof Error)
            return error.message;
        return undefined;
    }
}
function getOriginalErrorMessage(error) {
    if (error instanceof RpcError)
        return error.shortMessage ?? error.message ?? (error.cause instanceof Error ? error.cause.message : undefined);
    if (error instanceof Error)
        return error.message;
    return undefined;
}
function getReplacementFailureMessage(reason) {
    if (reason === 'cancelled')
        return 'Transaction was cancelled in the wallet before confirmation.';
    return 'Transaction was replaced in the wallet before confirmation.';
}
export async function writeContractAndWait(client, getCallParams) {
    const { hash } = await writeContractAndWaitForReceipt(client, getCallParams);
    return hash;
}
export async function waitForSubmittedTransactionReceipt(client, hash, { allowRevertedReceipt = false } = {}) {
    let resolvedHash = hash;
    let replacementReason;
    const receipt = await client.waitForTransactionReceipt({
        hash,
        onReplaced: replacement => {
            resolvedHash = replacement.transaction.hash;
            replacementReason = replacement.reason;
            client.onTransactionSubmitted?.(resolvedHash);
        },
    });
    if (replacementReason === 'cancelled' || replacementReason === 'replaced') {
        throw new Error(getReplacementFailureMessage(replacementReason));
    }
    if (!allowRevertedReceipt && receipt.status === 'reverted') {
        throw new Error('Transaction reverted');
    }
    return {
        hash: resolvedHash,
        receipt,
    };
}
export async function writeContractAndWaitForReceipt(client, getCallParams) {
    const callParams = getCallParams();
    const data = encodeFunctionData({
        abi: callParams.abi,
        ...(callParams.args === undefined ? {} : { args: callParams.args }),
        functionName: callParams.functionName,
    });
    const account = callParams.account ?? undefined;
    let hash;
    try {
        client.onTransactionPrepared?.({
            account,
            args: callParams.args,
            chainName: client.chain?.name,
            contractAddress: callParams.address,
            contractLabel: callParams.contractLabel ?? getContractLabel(callParams.abi, callParams.functionName),
            data,
            functionName: callParams.functionName,
            requiresWalletConfirmation: client.requiresWalletConfirmation,
            value: callParams.value,
        });
        hash = await client.sendTransaction({
            account,
            data,
            gas: callParams.gas,
            to: callParams.address,
            value: callParams.value,
        });
    }
    catch (error) {
        const reason = await getContractRevertReason(client, callParams);
        throw new Error(reason ?? getOriginalErrorMessage(error) ?? 'Transaction reverted');
    }
    const { hash: resolvedHash, receipt } = await waitForSubmittedTransactionReceipt(client, hash, { allowRevertedReceipt: true });
    if (receipt.status === 'reverted') {
        const reason = await getContractRevertReason(client, callParams);
        throw new Error(reason ?? 'Transaction reverted');
    }
    return { hash: resolvedHash, receipt };
}
//# sourceMappingURL=core.js.map