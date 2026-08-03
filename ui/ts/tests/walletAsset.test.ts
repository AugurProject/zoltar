/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { getAddress, type Address } from '@zoltar/shared/ethereum'
import { requestWalletWatchAsset, type WalletAssetMetadata, type WalletAssetRequest } from '../lib/walletAsset.js'

const GENESIS_REP_ADDRESS = '0x221657776846890989a759ba2973e427dff5c9bb'
const CHILD_REP_ADDRESS = '0x00000000000000000000000000000000000000a1'
const WALLET_ADDRESS: Address = '0x00000000000000000000000000000000000000b2'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

function createRequestDependencies({
	activeAccount = WALLET_ADDRESS,
	activeChainId = '0x1',
	isCurrent = () => true,
	metadata = { decimals: 18, symbol: 'REPv2' },
	requestError,
	requestResult = true,
}: {
	activeAccount?: Address | null
	activeChainId?: string
	isCurrent?: () => boolean
	metadata?: WalletAssetMetadata
	requestError?: unknown
	requestResult?: unknown
} = {}) {
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
			expectedAccount: WALLET_ADDRESS,
			getActiveAccount: async () => activeAccount ?? undefined,
			getActiveChainId: async () => activeChainId,
			isCurrent,
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

	test('stops before the wallet request when the active chain changes during metadata reads', async () => {
		const activeChainIds = ['0x1', '0xaa36a7']
		const getActiveChainId = mock(async () => activeChainIds.shift() ?? '0xaa36a7')
		const readTokenMetadata = mock(async (_address: Address) => ({ decimals: 18, symbol: 'REP' }))
		const request = mock(async (_walletRequest: WalletAssetRequest) => true)

		const result = await requestWalletWatchAsset(GENESIS_REP_ADDRESS, {
			expectedChainId: '0x1',
			expectedAccount: WALLET_ADDRESS,
			getActiveAccount: async () => WALLET_ADDRESS,
			getActiveChainId,
			isCurrent: () => true,
			readTokenMetadata,
			request,
		})

		expect(result).toEqual({ status: 'wrong-network' })
		expect(getActiveChainId).toHaveBeenCalledTimes(2)
		expect(readTokenMetadata).toHaveBeenCalledTimes(1)
		expect(request).not.toHaveBeenCalled()
	})

	test('does not open the provider after the request scope or wallet account changes', async () => {
		const staleScope = createRequestDependencies({ isCurrent: () => false })
		const switchedAccount = createRequestDependencies({ activeAccount: CHILD_REP_ADDRESS })
		const disconnected = createRequestDependencies({ activeAccount: null })

		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, staleScope.dependencies)).toEqual({ status: 'stale' })
		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, switchedAccount.dependencies)).toEqual({ status: 'stale' })
		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, disconnected.dependencies)).toEqual({ status: 'stale' })
		expect(staleScope.request).not.toHaveBeenCalled()
		expect(switchedAccount.request).not.toHaveBeenCalled()
		expect(disconnected.request).not.toHaveBeenCalled()
	})

	test('accepts an active wallet account with equivalent address casing', async () => {
		const { dependencies, request } = createRequestDependencies({
			activeAccount: '0x00000000000000000000000000000000000000B2',
		})

		expect(await requestWalletWatchAsset(GENESIS_REP_ADDRESS, dependencies)).toEqual({ status: 'accepted' })
		expect(request).toHaveBeenCalledTimes(1)
	})

	test('rechecks request scope after a deferred metadata read', async () => {
		const metadata = createDeferred<WalletAssetMetadata>()
		let isCurrent = true
		const request = mock(async (_walletRequest: WalletAssetRequest) => true)
		const pendingResult = requestWalletWatchAsset(GENESIS_REP_ADDRESS, {
			expectedChainId: '0x1',
			expectedAccount: WALLET_ADDRESS,
			getActiveAccount: async () => WALLET_ADDRESS,
			getActiveChainId: async () => '0x1',
			isCurrent: () => isCurrent,
			readTokenMetadata: async () => await metadata.promise,
			request,
		})

		isCurrent = false
		metadata.resolve({ decimals: 18, symbol: 'REPv2' })

		expect(await pendingResult).toEqual({ status: 'stale' })
		expect(request).not.toHaveBeenCalled()
	})

	test('rechecks the active chain after a deferred account lookup', async () => {
		const activeAccount = createDeferred<Address | undefined>()
		const initialChainIds = ['0x1', '0x1']
		let activeChainId = '0x1'
		const getActiveChainId = mock(async () => initialChainIds.shift() ?? activeChainId)
		const request = mock(async (_walletRequest: WalletAssetRequest) => true)
		const pendingResult = requestWalletWatchAsset(GENESIS_REP_ADDRESS, {
			expectedChainId: '0x1',
			expectedAccount: WALLET_ADDRESS,
			getActiveAccount: async () => await activeAccount.promise,
			getActiveChainId,
			isCurrent: () => true,
			readTokenMetadata: async () => ({ decimals: 18, symbol: 'REPv2' }),
			request,
		})

		activeChainId = '0xaa36a7'
		activeAccount.resolve(WALLET_ADDRESS)

		expect(await pendingResult).toEqual({ status: 'wrong-network' })
		expect(getActiveChainId).toHaveBeenCalledTimes(3)
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

	test('normalizes malformed provider rejections as failed requests', async () => {
		const { dependencies } = createRequestDependencies({
			requestError: 'wallet unavailable',
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
