import { expect, test } from 'bun:test'
import { custom, requestRpc, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createConfirmedReadTransport } from '../wallet/confirmedReadTransport.js'

test('gas estimates see a confirmed approval when the wallet head still lags', async () => {
	const transaction = { from: zeroAddress, to: zeroAddress }
	const transport = createConfirmedReadTransport(custom({ request: async request => (request.method === 'eth_blockNumber' ? '0x9' : request.params) }), () => 10n)

	expect(await requestRpc(transport, { method: 'eth_estimateGas', params: [transaction] })).toEqual([transaction, '0xa'])
	expect(await requestRpc(transport, { method: 'eth_estimateGas', params: [transaction, 'latest'] })).toEqual([transaction, '0xa'])
	expect(await requestRpc(transport, { method: 'eth_estimateGas', params: [transaction, 'pending'] })).toEqual([transaction, 'pending'])
	expect(await requestRpc(transport, { method: 'eth_estimateGas', params: [transaction, '0x9'] })).toEqual([transaction, '0x9'])
})
