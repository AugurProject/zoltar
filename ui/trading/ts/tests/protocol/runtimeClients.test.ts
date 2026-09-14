import { expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createTradingWalletClient } from '../../protocol/runtimeClients.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { InjectedEthereum } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'

test('Trading checks its supplied provider before a mainnet transaction can reach the wallet', async () => {
	const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
	const requests: string[] = []
	const provider: InjectedEthereum = {
		request: async ({ method }) => {
			requests.push(method)
			if (method === 'eth_accounts') return [zeroAddress]
			if (method === 'eth_chainId') return '0x1'
			throw new Error(`Unexpected wallet request: ${method}`)
		},
	}
	try {
		await expect(createTradingWalletClient(provider, zeroAddress).sendTransaction({ to: zeroAddress })).rejects.toThrow('Ethereum mainnet is disabled.')
		expect(requests).toEqual(['eth_accounts', 'eth_chainId'])
	} finally {
		restore()
	}
})
