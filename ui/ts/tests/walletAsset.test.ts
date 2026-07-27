/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { getAddress, type Address } from '@zoltar/shared/ethereum'
import { requestWalletWatchAsset, type WalletAssetMetadata, type WalletAssetRequest } from '../lib/walletAsset.js'

const GENESIS_REP_ADDRESS = '0x221657776846890989a759ba2973e427dff5c9bb'
const CHILD_REP_ADDRESS = '0x00000000000000000000000000000000000000a1'

function createRequestDependencies({ activeChainId = '0x1', metadata = { decimals: 18, symbol: 'REPv2' }, requestError, requestResult = true }: { activeChainId?: string; metadata?: WalletAssetMetadata; requestError?: unknown; requestResult?: unknown } = {}) {
	const readTokenMetadata = mock(async (_address: Address) => metadata)
	const requests: WalletAssetRequest[] = []
	const request = mock(async (walletRequest: WalletAssetRequest) => {
		if (requestError !== undefined) throw requestError
		requests.push(walletRequest)
		return requestResult
	})
	return {
		dependencies: {
			expectedChainId: '0x1',
			getActiveChainId: async () => activeChainId,
			readTokenMetadata,
			request,
		},
		readTokenMetadata,
		request,
		requests,
	}
}

describe('wallet_watchAsset requests', () => {
	test('sends the configured genesis REPv2 metadata in a checksummed ERC-20 request', async () => {
		const { dependencies, requests } = createRequestDependencies()

		const result = await requestWalletWatchAsset(GENESIS_REP_ADDRESS, dependencies)

		expect(result).toEqual({ status: 'accepted' })
		expect(requests).toEqual([
			{
				method: 'wallet_watchAsset',
				params: {
					options: {
						address: getAddress(GENESIS_REP_ADDRESS),
						decimals: 18,
						symbol: 'REPv2',
					},
					type: 'ERC20',
				},
			},
		])
	})

	test('uses each child token address and its onchain REP metadata', async () => {
		const { dependencies, readTokenMetadata, requests } = createRequestDependencies({
			metadata: { decimals: 18, symbol: ' REP ' },
		})

		const result = await requestWalletWatchAsset(CHILD_REP_ADDRESS, dependencies)

		expect(result).toEqual({ status: 'accepted' })
		expect(readTokenMetadata).toHaveBeenCalledWith(getAddress(CHILD_REP_ADDRESS))
		expect(requests[0]?.params.options).toEqual({
			address: getAddress(CHILD_REP_ADDRESS),
			decimals: 18,
			symbol: 'REP',
		})
	})

	test('stops before reading metadata when the wallet is on another chain', async () => {
		const { dependencies, readTokenMetadata, request } = createRequestDependencies({ activeChainId: '0xaa36a7' })

		const result = await requestWalletWatchAsset(GENESIS_REP_ADDRESS, dependencies)

		expect(result).toEqual({ status: 'wrong-network' })
		expect(readTokenMetadata).not.toHaveBeenCalled()
		expect(request).not.toHaveBeenCalled()
	})

	test('treats wallet rejection and false responses as neutral declines', async () => {
		const rejected = createRequestDependencies({
			requestError: { code: 4001, message: 'User rejected the request' },
		})
		const declined = createRequestDependencies({ requestResult: false })

		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, rejected.dependencies)).toEqual({ status: 'dismissed' })
		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, declined.dependencies)).toEqual({ status: 'declined' })
	})

	test('identifies unsupported wallet methods for the manual-import fallback', async () => {
		const { dependencies } = createRequestDependencies({
			requestError: { code: -32601, message: 'Method not found' },
		})

		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, dependencies)).toEqual({ status: 'unsupported' })
	})

	test('normalizes an expected provider error as a failed request', async () => {
		const { dependencies } = createRequestDependencies({
			requestError: new Error('Wallet RPC unavailable'),
		})

		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, dependencies)).toEqual({ status: 'failed' })
	})

	test('rejects invalid token metadata without sending a wallet request', async () => {
		const { dependencies, request } = createRequestDependencies({
			metadata: { decimals: 18, symbol: 'SYMBOL-IS-TOO-LONG' },
		})

		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, dependencies)).toEqual({ status: 'failed' })
		expect(request).not.toHaveBeenCalled()
	})
})
