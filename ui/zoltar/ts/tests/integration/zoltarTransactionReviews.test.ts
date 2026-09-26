/// <reference types="bun-types" />

import { afterEach, expect, test } from 'bun:test'
import { getActiveBackend, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { initializeZoltarActiveEnvironment } from '../../app/activeEnvironment.js'

const account = '0x0000000000000000000000000000000000000001'

afterEach(() => {
	transactionSteps.value?.cancel()
	resetActiveEnvironmentForTesting()
})

// Fork and migration burn REP, so Zoltar writes must pass through the in-app review before any wallet prompt.
test('the Zoltar environment holds wallet writes for the in-app transaction review', async () => {
	const dom = installDomEnvironment()
	const walletMethods: string[] = []
	window.ethereum = {
		on: () => undefined,
		removeListener: () => undefined,
		request: async ({ method }) => {
			walletMethods.push(method)
			if (method === 'eth_accounts') return [account]
			if (method === 'eth_chainId') return getActiveBackend().profile.chainIdHex
			throw new Error(`Unexpected wallet request ${method}`)
		},
	}
	try {
		await initializeZoltarActiveEnvironment({ hostname: 'localhost', search: '' })
		const client = getActiveBackend().createWriteClient(account)
		const sending = client.sendTransaction({ account, chain: undefined, to: account, value: 1n })
		for (let attempt = 0; attempt < 100 && transactionSteps.value?.steps[0]?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
		expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
		expect(walletMethods).not.toContain('eth_sendTransaction')
		transactionSteps.value?.cancel()
		await expect(sending).rejects.toThrow()
		expect(walletMethods).not.toContain('eth_sendTransaction')
	} finally {
		window.ethereum = undefined
		dom.cleanup()
	}
})
