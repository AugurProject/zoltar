import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolForkChoiceRequest, buildSecurityPoolForkPreparationRequest, buildSecurityPoolForkStartRequest, buildSecurityPoolForkFinalizeRequest, buildSecurityPoolForkRecoveryRequest, buildSecurityPoolRecoveryRightsTransferRequest, loadSecurityPoolForkSnapshot, type SecurityPoolReadClient } from './securityPool.js'
const owner: Address = '0x0000000000000000000000000000000000000001'
const securityPool: Address = '0x0000000000000000000000000000000000000002'
const controller: Address = '0x0000000000000000000000000000000000000003'
const protocol: Address = '0x0000000000000000000000000000000000000004'
const capital: Address = '0x0000000000000000000000000000000000000005'
const hash: Hex = `0x${'11'.repeat(32)}`
const abi = parseAbi([
	'function choose(uint248 source,uint256 outcome)',
	'function prepareBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function startBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function finalizeBranch(uint248 child)',
	'function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)',
	'function transferSecurityPoolRecoveryRights(uint248 sourceUniverse,address recipient,uint256[3] amountsAttoShares)',
])
function fixture(overrides: Record<string, unknown> = {}) {
	const calls: { functionName: string; blockNumber: bigint }[] = []
	const values: Record<string, unknown> = {
		forkController: controller,
		securityPool,
		zoltar: protocol,
		getForkTime: 1_000n,
		getForkChoiceDeadline: 2_000n,
		getForkRecapitalizationDeadline: 3_000n,
		forks: [50n, 40n, 30n, 30n, 2n, 10n, 0n, 0n, true, false, true],
		choices: [7n, true],
		getChildUniverseId: 42n,
		branches: [8n, 7n, 20n, 16n, 10n, 32n, true, false, false],
		getRepToken: owner,
		capitalLedger: capital,
		...overrides,
	}
	const client: SecurityPoolReadClient = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 10n, hash, timestamp: 1_500n }),
		readContract: async p => {
			calls.push({ functionName: p.functionName, blockNumber: p.blockNumber })
			if (!(p.functionName in values)) throw new Error(`Unexpected read ${p.functionName}`)
			return values[p.functionName]
		},
	}
	return { client, calls }
}
describe('bounded security pool fork SDK', () => {
	test('one owner choice, shared activation and source-only complete-set recovery encode exact identities', () => {
		const base = { owner, controller, universeId: 8n }
		expect(decodeFunctionData({ abi, data: buildSecurityPoolForkChoiceRequest({ ...base, outcomeIndex: 7n }).data })).toEqual({ functionName: 'choose', args: [8n, 7n] })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolForkPreparationRequest({ ...base, outcomeIndex: 7n }).data })).toEqual({ functionName: 'prepareBranch', args: [8n, 7n] })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolForkStartRequest({ ...base, outcomeIndex: 7n }).data })).toEqual({ functionName: 'startBranch', args: [8n, 7n] })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolForkFinalizeRequest({ ...base, universeId: 42n }).data })).toEqual({ functionName: 'finalizeBranch', args: [42n] })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolForkRecoveryRequest({ ...base, questionId: 123n, shares: 99n }).data })).toEqual({ functionName: 'recoverUnchosenCash', args: [8n, 123n, 99n] })
		expect(() => buildSecurityPoolForkRecoveryRequest({ ...base, questionId: 123n, shares: 0n })).toThrow('positive')
		expect(() => buildSecurityPoolForkChoiceRequest({ ...base, universeId: 1n << 248n, outcomeIndex: 7n })).toThrow('uint248')
	})
	test('independent recovery transfers bind the source, share token, recipient and all three outcome amounts', () => {
		const parameters = { owner, shareToken: capital, universeId: 8n, recipient: securityPool, amountsAttoShares: [4n, 0n, 7n] satisfies readonly [bigint, bigint, bigint] }
		const request = buildSecurityPoolRecoveryRightsTransferRequest(parameters)
		expect(request).toMatchObject({ account: owner, to: capital, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'transferSecurityPoolRecoveryRights', args: [8n, securityPool, [4n, 0n, 7n]] })
		expect(() => buildSecurityPoolRecoveryRightsTransferRequest({ ...parameters, amountsAttoShares: [0n, 0n, 0n] })).toThrow('positive')
		expect(() => buildSecurityPoolRecoveryRightsTransferRequest({ ...parameters, amountsAttoShares: [-1n, 0n, 1n] })).toThrow('uint256')
		expect(() => buildSecurityPoolRecoveryRightsTransferRequest({ ...parameters, recipient: zeroAddress })).toThrow('nonzero')
		expect(() => buildSecurityPoolRecoveryRightsTransferRequest({ ...parameters, recipient: owner })).toThrow('another account')
	})

	test('reads one chosen branch at a pinned block without owner, question or ancestor history', async () => {
		const { client, calls } = fixture()
		const snapshot = await loadSecurityPoolForkSnapshot({ client, securityPool, owner, universeId: 8n })
		expect(snapshot.choice).toEqual({ outcomeIndex: 7n, recorded: true })
		expect(snapshot.branch).toMatchObject({ universeId: 42n, capitalLedger: capital, recoveryAttoRep: 32n, prepared: true, ready: false })
		expect(snapshot).toMatchObject({ forkTime: 1_000n, choiceDeadline: 2_000n, activationDeadline: 3_000n })
		expect(new Set(calls.map(c => c.blockNumber))).toEqual(new Set([10n]))
		expect(calls.length).toBeLessThan(20)
		expect(snapshot.fork.recoveryAttoRep).toBe(2n)
	})
	test('unprepared arbitrary outcomes do not require child deployment and foreign branches are rejected', async () => {
		const unborn = fixture({ choices: [0n, false], branches: [0n, 0n, 0n, 0n, 0n, 0n, false, false, false] })
		const snapshot = await loadSecurityPoolForkSnapshot({ client: unborn.client, securityPool, owner, universeId: 8n, outcomeIndex: 2n ** 200n })
		expect(snapshot.branch).toMatchObject({ prepared: false, capitalLedger: zeroAddress })
		expect(unborn.calls.some(call => call.functionName === 'capitalLedger')).toBe(false)
		await expect(loadSecurityPoolForkSnapshot({ client: fixture({ branches: [9n, 7n, 0n, 0n, 0n, 32n, true, false, false] }).client, securityPool, owner, universeId: 8n })).rejects.toThrow('different fork')
		await expect(loadSecurityPoolForkSnapshot({ client: fixture({ securityPool: owner }).client, securityPool, owner, universeId: 8n })).rejects.toThrow('different security pool')
	})
	test('malformed deadlines, inconsistent accounting and reorgs fail closed', async () => {
		await expect(loadSecurityPoolForkSnapshot({ client: fixture({ getForkChoiceDeadline: 1_000n }).client, securityPool, owner, universeId: 8n })).rejects.toThrow('deadlines')
		await expect(loadSecurityPoolForkSnapshot({ client: fixture({ forks: [50n, 40n, 30n, 30n, 2n, 31n, 0n, 0n, true, false, true] }).client, securityPool, owner, universeId: 8n })).rejects.toThrow('accounting')
		const reorg = fixture()
		reorg.client.getBlock = async p => ({ number: 10n, hash: p?.blockNumber === undefined ? hash : `0x${'22'.repeat(32)}`, timestamp: 1_500n })
		await expect(loadSecurityPoolForkSnapshot({ client: reorg.client, securityPool, owner, universeId: 8n })).rejects.toThrow('changed')
	})
})
