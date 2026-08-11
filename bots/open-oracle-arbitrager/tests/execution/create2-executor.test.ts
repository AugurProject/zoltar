import { expect, test } from 'bun:test'
import { assertExecutorDeploymentEnvironment, assertExecutorDeploymentReceipt, deterministicDeploymentProxy, deterministicDeploymentProxyCode, executorCodeStatus, executorDeploymentPlan, submitExecutorDeploymentTransaction } from '#execution/create2-executor'
import { keccak256, mainnet } from '#ethereum'
import type { Hex } from '#ethereum'
import { deployExecutorFromConnectivity } from '../../src/runtime/operator-control-plane.ts'

test('derives a stable executor address and canonical proxy calldata from a bytes32 salt', () => {
	const salt = `0x${'00'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	expect(deterministicDeploymentProxy).toBe('0x4e59b44847b379578588920cA78FbF26c0B4956C')
	expect(plan.address).toBe('0xe04E3658Eb81792D5fc059ffF23d996b7940E1aA')
	expect(plan.salt).toBe(salt)
	expect(plan.calldata).toBe(`${salt}${plan.bytecode.slice(2)}` as Hex)
})

test('rejects salts that cannot make CREATE2 deployment deterministic', () => {
	expect(() => executorDeploymentPlan('hello')).toThrow('32-byte')
	expect(() => executorDeploymentPlan(`0x${'00'.repeat(31)}`)).toThrow('32-byte')
})

test('fails closed on a wrong chain or unexpected canonical proxy runtime', () => {
	expect(() => assertExecutorDeploymentEnvironment(1, 11_155_111, deterministicDeploymentProxyCode)).toThrow('RPC chain mismatch')
	expect(() => assertExecutorDeploymentEnvironment(11_155_111, 11_155_111, '0x12')).toThrow('proxy is missing or has unexpected bytecode')
	expect(() => assertExecutorDeploymentEnvironment(11_155_111, 11_155_111, deterministicDeploymentProxyCode)).not.toThrow()
})

test('distinguishes an empty address from matching and conflicting executor runtime', () => {
	const runtime = '0x1234'
	const expectedHash = keccak256(runtime)
	expect(executorCodeStatus(undefined, expectedHash)).toBe('missing')
	expect(executorCodeStatus('0x', expectedHash)).toBe('missing')
	expect(executorCodeStatus(runtime, expectedHash)).toBe('verified')
	expect(() => executorCodeStatus('0xabcd', expectedHash)).toThrow('unexpected runtime bytecode')
})

test('rejects a reverted CREATE2 receipt', () => {
	const hash = `0x${'11'.repeat(32)}` as Hex
	expect(() => assertExecutorDeploymentReceipt('reverted', hash)).toThrow(`reverted: ${hash}`)
	expect(() => assertExecutorDeploymentReceipt('success', hash)).not.toThrow()
})

test('broadcasts one signed executor deployment through every public RPC and tolerates one failure', async () => {
	const transactionHash = `0x${'22'.repeat(32)}` as Hex
	const serializedTransaction = '0x1234' as Hex
	const submissions: { transaction: Hex; url: string }[] = []
	const result = await submitExecutorDeploymentTransaction({
		account: `0x${'11'.repeat(20)}`,
		publicRpcUrls: ['https://primary.example', 'https://secondary.example'],
		publicSubmit: async (url, transaction) => {
			submissions.push({ transaction, url })
			if (url.includes('primary')) throw new Error('primary unavailable')
			return transactionHash
		},
		serializedTransaction,
		transactionHash,
	})

	expect(submissions).toEqual([
		{ transaction: serializedTransaction, url: 'https://primary.example' },
		{ transaction: serializedTransaction, url: 'https://secondary.example' },
	])
	expect(result.hash).toBe(transactionHash)
	expect(result.acceptedTargets).toEqual(['https://secondary.example'])
	expect(result.failedTargets).toHaveLength(1)
})

test('passes every effective public RPC from the dashboard deployment path', async () => {
	const primaryRpcUrl = 'https://primary.example/'
	const publicRpcUrls = [primaryRpcUrl, 'https://secondary.example/']
	let receivedRpcUrls: readonly string[] = []
	await deployExecutorFromConnectivity(
		{
			chain: mainnet,
			connectivity: { publicRpcUrls, readRpcUrl: primaryRpcUrl },
			privateKey: `0x${'11'.repeat(32)}`,
			salt: `0x${'22'.repeat(32)}`,
		},
		async parameters => {
			receivedRpcUrls = parameters.rpcUrls
			return { address: `0x${'33'.repeat(20)}`, alreadyDeployed: false, transactionHash: `0x${'44'.repeat(32)}` }
		},
	)

	expect(receivedRpcUrls).toEqual(publicRpcUrls)
})
