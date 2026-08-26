import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, keccak256, toHex } from '../support/bot-shared.ts'
import { openOracleAbi } from '../../src/contracts/abi.ts'
import { eligibleOperationPlans, evaluateOperationCatalog } from '../../src/operations/catalog.ts'
import type { OperationPlan } from '../../src/operations/types.ts'
import { snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (2n * 10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 1,
} as const

function onlyWethCreditSnapshot() {
	const snapshot = snapshotFixture()
	for (const token of snapshot.wallet.tokens) token.openOracleCredit = token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() ? 1_001n.toString() : 1n.toString()
	return snapshot
}

function plan(snapshot: ReturnType<typeof snapshotFixture>, definitionId: string, seed: number = options.seed): OperationPlan {
	const selected = eligibleOperationPlans(snapshot, { ...options, seed }).find(candidate => candidate.definitionId === definitionId)
	if (selected === undefined) throw new Error(`Expected ${definitionId} plan for seed ${seed.toString()}`)
	return selected
}

function selector(signature: string) {
	return keccak256(toHex(signature)).slice(0, 10)
}

describe('OpenOracle safe operation completeness', () => {
	test('withdrawTo fixes the recipient to the wallet and retains exact withdrawal proof', () => {
		const snapshot = onlyWethCreditSnapshot()
		const withdrawal = plan(snapshot, 'open-oracle.withdraw-to')
		const step = withdrawal.steps[0]
		if (step === undefined) throw new Error('withdrawTo step missing')
		expect(decodeFunctionData({ abi: openOracleAbi, data: step.data })).toEqual({ args: [snapshot.deployments.weth, 1_000n, snapshot.wallet.address], functionName: 'withdrawTo' })
		expect(step.data.slice(0, 10)).toBe(selector('withdrawTo(address,uint256,address)'))
		expect(step.gasLimit).toBe(500_000n.toString())
		expect(withdrawal.lastValidBlockNumber).toBe('101')
		expect(withdrawal.metadata).toMatchObject({ amount: 1_000n.toString(), methodSignature: 'withdrawTo(address,uint256,address)', recipient: snapshot.wallet.address, token: snapshot.deployments.weth })
		expect(step.preflightCalls).toHaveLength(1)
		const preflight = step.preflightCalls[0]
		if (preflight === undefined) throw new Error('withdrawTo preflight missing')
		expect(decodeFunctionData({ abi: openOracleAbi, data: preflight.data })).toEqual({ args: [snapshot.deployments.weth, 1_000n, snapshot.wallet.address], functionName: 'withdrawTo' })
		expect(preflight).toMatchObject({ caller: snapshot.wallet.address, expectedResult: encodeAbiParameters([{ type: 'uint256' }], [1_000n]), to: snapshot.deployments.openOracle })
		expect(step.evidence).toContainEqual(
			expect.objectContaining({
				emitter: snapshot.deployments.weth,
				equals: 1_000n.toString(),
				field: 'value',
				indexed: { from: snapshot.deployments.openOracle, to: snapshot.wallet.address },
				kind: 'decoded-event-field',
			}),
		)
		expect(step.evidence).toContainEqual(expect.objectContaining({ args: [snapshot.wallet.address, snapshot.deployments.weth], expected: 1n.toString(), functionName: 'tokenHolder', kind: 'storage-postcondition' }))
	})

	test('selects and encodes both pushOrCredit overloads deterministically with bounded gas', () => {
		const snapshot = onlyWethCreditSnapshot()
		const bySignature = new Map<string, OperationPlan>()
		for (let seed = 0; seed < 64 && bySignature.size < 2; seed += 1) {
			const candidate = plan(snapshot, 'open-oracle.push-or-credit', seed)
			const signature = candidate.metadata['methodSignature']
			if (typeof signature !== 'string') throw new Error('pushOrCredit signature metadata missing')
			bySignature.set(signature, candidate)
			expect(plan(snapshot, 'open-oracle.push-or-credit', seed)).toEqual(candidate)
		}
		expect(new Set(bySignature.keys())).toEqual(new Set(['pushOrCredit(address,address,uint128)', 'pushOrCredit(address,address,uint128,uint32)']))

		const defaultPlan = bySignature.get('pushOrCredit(address,address,uint128)')
		const boundedPlan = bySignature.get('pushOrCredit(address,address,uint128,uint32)')
		if (defaultPlan === undefined || boundedPlan === undefined) throw new Error('Both pushOrCredit variants must be planned')
		const defaultStep = defaultPlan.steps[0]
		const boundedStep = boundedPlan.steps[0]
		if (defaultStep === undefined || boundedStep === undefined) throw new Error('pushOrCredit step missing')

		expect(defaultStep.data.slice(0, 10)).toBe(selector('pushOrCredit(address,address,uint128)'))
		expect(decodeFunctionData({ abi: openOracleAbi, data: defaultStep.data })).toEqual({ args: [snapshot.deployments.weth, snapshot.wallet.address, 1_000n], functionName: 'pushOrCredit' })
		expect(defaultPlan.metadata).toMatchObject({ forwardedGasLimit: 50_000n.toString(), recipient: snapshot.wallet.address })

		expect(boundedStep.data.slice(0, 10)).toBe(selector('pushOrCredit(address,address,uint128,uint32)'))
		const boundedCall = decodeFunctionData({ abi: openOracleAbi, data: boundedStep.data })
		expect(boundedCall.functionName).toBe('pushOrCredit')
		expect(boundedCall.args?.slice(0, 3)).toEqual([snapshot.deployments.weth, snapshot.wallet.address, 1_000n])
		const forwardedGasLimit = boundedCall.args?.[3]
		if (typeof forwardedGasLimit !== 'bigint') throw new Error('Custom pushOrCredit gas limit was not decoded as an integer')
		expect(forwardedGasLimit).toBeGreaterThanOrEqual(30_000n)
		expect(forwardedGasLimit).toBeLessThanOrEqual(100_000n)
		expect(boundedPlan.metadata['forwardedGasLimit']).toBe(forwardedGasLimit.toString())
		expect(defaultStep.gasLimit).toBe(500_000n.toString())
		expect(boundedStep.gasLimit).toBe(500_000n.toString())
	})

	test('toggles only a wallet-to-self internal allowance and binds event plus storage evidence', () => {
		const snapshot = snapshotFixture()
		const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
		const rep = snapshot.wallet.tokens.find(token => token.address.toLowerCase() !== snapshot.deployments.weth.toLowerCase())
		if (weth === undefined || rep === undefined) throw new Error('Canonical token inventory missing')
		delete rep.openOracleInternalAllowanceToSelf
		weth.openOracleInternalAllowanceToSelf = 0n.toString()

		const setPlan = plan(snapshot, 'open-oracle.approve-internal')
		const setStep = setPlan.steps[0]
		if (setStep === undefined) throw new Error('Internal approval step missing')
		expect(decodeFunctionData({ abi: openOracleAbi, data: setStep.data })).toEqual({ args: [snapshot.wallet.address, weth.address, BigInt(options.maxEthSpendAttoEth)], functionName: 'approveInternal' })
		expect(setPlan.lastValidBlockNumber).toBe('101')
		expect(setPlan.metadata).toEqual({ allowanceBefore: 0n.toString(), allowanceTarget: options.maxEthSpendAttoEth, owner: snapshot.wallet.address, spender: snapshot.wallet.address, token: weth.address })
		expect(setStep.evidence).toContainEqual(
			expect.objectContaining({
				emitter: snapshot.deployments.openOracle,
				equals: options.maxEthSpendAttoEth,
				field: 'amount',
				indexed: { owner: snapshot.wallet.address, spender: snapshot.wallet.address, token: weth.address },
				kind: 'decoded-event-field',
				signature: 'InternalApproval(address,address,address,uint256)',
			}),
		)
		expect(setStep.evidence).toContainEqual(
			expect.objectContaining({
				args: [snapshot.wallet.address, snapshot.wallet.address, weth.address],
				expected: options.maxEthSpendAttoEth,
				functionName: 'internalAllowance',
				kind: 'storage-postcondition',
				relation: 'equals',
			}),
		)

		weth.openOracleInternalAllowanceToSelf = options.maxEthSpendAttoEth
		const revokePlan = plan(snapshot, 'open-oracle.approve-internal')
		const revokeStep = revokePlan.steps[0]
		if (revokeStep === undefined) throw new Error('Internal allowance revocation step missing')
		expect(decodeFunctionData({ abi: openOracleAbi, data: revokeStep.data })).toEqual({ args: [snapshot.wallet.address, weth.address, 0n], functionName: 'approveInternal' })
		expect(revokePlan.metadata).toMatchObject({ allowanceBefore: options.maxEthSpendAttoEth, allowanceTarget: 0n.toString(), owner: snapshot.wallet.address, spender: snapshot.wallet.address, token: weth.address })
	})

	test('fails closed for legacy snapshots without discovered internal allowances', () => {
		const snapshot = snapshotFixture()
		for (const token of snapshot.wallet.tokens) delete token.openOracleInternalAllowanceToSelf
		expect(eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'open-oracle.approve-internal')).toBeUndefined()
		const evaluated = evaluateOperationCatalog(snapshot, options).find(candidate => candidate.definition.id === 'open-oracle.approve-internal')
		expect(evaluated?.eligibility).toEqual({ blockers: ['No canonical token has a discovered self-allowance that can be safely toggled within policy'], eligible: false })
	})
})
