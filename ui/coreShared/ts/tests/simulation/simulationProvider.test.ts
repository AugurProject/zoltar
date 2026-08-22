/// <reference types='bun-types' />

import { expect, mock, test } from 'bun:test'
import { normalizeAccount } from '../../lib/chainBackend.js'
import { createSimulationProvider } from '../../simulation/simulationProvider.js'

test('simulation providers use the latest block for EIP-1898 calls unsupported by TEVM', async () => {
	const account = normalizeAccount('0x00000000000000000000000000000000000000a1')
	if (account === undefined) throw new Error('Expected a valid simulation account')
	const requestRpc = mock(async () => '0x')
	const provider = createSimulationProvider({
		getChainId: () => '0x1',
		getSelectedAccount: () => account,
		requestRpc,
	})

	await provider.request({
		method: 'eth_call',
		params: [
			{ data: '0x', to: account },
			{ blockHash: `0x${'01'.repeat(32)}`, requireCanonical: true },
		],
	})

	expect(requestRpc).toHaveBeenCalledWith({
		method: 'eth_call',
		params: [{ data: '0x', to: account }, 'latest'],
	})
})
