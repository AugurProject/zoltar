import { expect, test } from 'bun:test'
import { assertFocusedDeploymentCompatible, prepareDeploymentTokenTransition, replacePrimaryRepToken, validateDeploymentSettings } from '#config/deployment-settings'
import type { Address } from '#ethereum'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

test('replaces the derived primary REP without retaining stale deployment trust', () => {
	const previousRep = address('1')
	const nextRep = address('2')
	const explicitToken = address('3')
	expect(replacePrimaryRepToken([previousRep, explicitToken, nextRep], previousRep, nextRep)).toEqual([nextRep, explicitToken])
})

test('replaces the configured REP in both active and persisted live deployment settings', () => {
	const activeRep = address('1')
	const restartRep = address('2')
	const explicitToken = address('3')
	const activeTokens = [activeRep, explicitToken]

	const transition = prepareDeploymentTokenTransition(activeTokens, undefined, activeRep, restartRep)

	expect(transition.active).toEqual([restartRep, explicitToken])
	expect(transition.persisted).toEqual([restartRep, explicitToken])
})

test('rejects insecure or credential-bearing quorum RPC URLs', () => {
	const base = {
		coordinatorAddresses: [],
		deploymentManifest: undefined,
		executor: undefined,
		openOracle: address('1'),
		quorumRpcUrls: ['https://quorum.example'],
		rep: address('2'),
		uniswapFactory: address('3'),
		uniswapQuoter: address('4'),
		uniswapRouter: undefined,
		uniswapV2Router: undefined,
		uniswapV4PoolManager: undefined,
		uniswapV4Quoter: undefined,
		weth: address('5'),
	}
	expect(() => validateDeploymentSettings({ ...base, quorumRpcUrls: ['http://quorum.example'] })).toThrow('HTTPS, loopback HTTP, or the local Anvil service')
	expect(() => validateDeploymentSettings({ ...base, quorumRpcUrls: ['https://user:secret@quorum.example'] })).toThrow('embedded credentials')
})

test('rejects a focused REP update that leaves centralized-market identity stale', () => {
	const currentAsset = address('1')
	expect(() => assertFocusedDeploymentCompatible(address('2'), { assetAddress: currentAsset })).toThrow('centralized market configuration')
	expect(() => assertFocusedDeploymentCompatible(currentAsset, { assetAddress: currentAsset })).not.toThrow()
})
