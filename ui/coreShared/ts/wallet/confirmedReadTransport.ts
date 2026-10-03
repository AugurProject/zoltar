import { createPublicClient, custom, requestRpc, type Transport } from '@zoltar/core-shared/evm/ethereum'

export function blockParameterIndex(method: string) {
	if (method === 'eth_getBlockByNumber') return 0
	if (method === 'eth_call' || method === 'eth_getBalance' || method === 'eth_getCode' || method === 'eth_getTransactionCount') return 1
	if (method === 'eth_getStorageAt') return 2
	return undefined
}

/** Wallets can cache `latest` even after returning a mined receipt. Use an explicit block at least as new as that receipt. */
export function createConfirmedReadTransport(transport: Transport, getConfirmedBlock: () => bigint | undefined): Transport {
	const client = createPublicClient({ transport })
	let pendingHead: Promise<bigint> | undefined
	const loadHead = () => {
		if (pendingHead !== undefined) return pendingHead
		pendingHead = client.getBlockNumber().finally(() => {
			pendingHead = undefined
		})
		return pendingHead
	}
	return custom(
		{
			request: async parameters => {
				const index = blockParameterIndex(parameters.method)
				const params = parameters.params
				// Preserve explicit historical blocks, block hashes, and pending-state reads.
				if (index === undefined || !Array.isArray(params) || params[index] !== 'latest') return await requestRpc(transport, parameters)
				while (true) {
					let confirmedBlock = getConfirmedBlock()
					let nextParams = params
					if (confirmedBlock !== undefined) {
						const head = await loadHead()
						confirmedBlock = getConfirmedBlock() ?? confirmedBlock
						const block = head > confirmedBlock ? head : confirmedBlock
						nextParams = [...params]
						nextParams[index] = `0x${block.toString(16)}`
					}
					const result = await requestRpc(transport, { ...parameters, params: nextParams })
					// Also retire reads started before confirmation, including background allowance loads.
					if (getConfirmedBlock() === confirmedBlock) return result
				}
			},
		},
		{ retryCount: transport.retryCount, retryDelay: transport.retryDelay },
	)
}
