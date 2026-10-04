/// <reference types='bun-types' />

import { expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { requireWallet } from '../wallet/requireWalletConnection.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'

const accountAddress = '0x1234567890123456789012345678901234567890'

function checkWallet(hasWallet: boolean, connectedAddress: typeof accountAddress | undefined) {
	const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ hasWallet }))
	try {
		let message: string | undefined
		const allowed = requireWallet(
			connectedAddress,
			nextMessage => {
				message = nextMessage
			},
			'creating a pool',
		)
		return { allowed, message }
	} finally {
		resetEnvironment()
	}
}

test('asks to install a wallet when none is available, and to connect when one is', () => {
	expect(checkWallet(false, undefined)).toEqual({ allowed: false, message: 'Install or enable a wallet to continue.' })
	expect(checkWallet(true, undefined)).toEqual({ allowed: false, message: 'Connect wallet to continue.' })
	expect(checkWallet(true, accountAddress)).toEqual({ allowed: true, message: undefined })
})
