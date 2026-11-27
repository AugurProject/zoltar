import { expect, test } from 'bun:test'
import { createPublicClient, http, getAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openArtifact, statoblast_SecurityPoolFixedAdmissionPolicy_SecurityPoolFixedAdmissionPolicy as fixedArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { loadSecurityPoolAdmission, securityPoolAdmissionCreationRequest, requireSecurityPoolQuestionAdmission, requireSecurityPoolQuestionEligibility } from '@zoltar/ui-statoblast-shared/protocol/securityPoolAdmission.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const policy = getAddress('0x0000000000000000000000000000000000000022')

test('fixed policy deployment rejects a list above the transaction gas limit', () => {
	const questions = Array.from({ length: 720 }, (_, index) => BigInt(index + 1))
	expect(() => securityPoolAdmissionCreationRequest(owner, 'fixed', 7n, questions)).toThrow('700 approved questions')
	expect(securityPoolAdmissionCreationRequest(owner, 'fixed', 7n, questions.slice(0, 700)).data).toBeDefined()
})
function client(code: Hex, universeId = 7n, allowed = true) {
	return createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getCode: async () => code,
		...createMockReadClient(async request => {
			if (request.functionName === 'questionCount') return 2n
			if (request.functionName === 'getQuestions') return [1n, 9n]
			if (request.functionName === 'universeId') return universeId
			if (request.functionName === 'isQuestionAllowed') return allowed
			throw new Error(`Unexpected self-description query: ${request.functionName}`)
		}),
	}))
}

test('curated classification verifies bytecode and fixed universe instead of trusting policy labels', async () => {
	expect(await loadSecurityPoolAdmission(client(`0x${openArtifact.evm.deployedBytecode.object}`), policy, 7n)).toEqual({ address: policy, mode: 'open' })
	expect(await loadSecurityPoolAdmission(client(`0x${fixedArtifact.evm.deployedBytecode.object}`), policy, 7n)).toMatchObject({ address: policy, mode: 'fixed', questions: [1n, 9n], questionCount: 2n })
	expect(await loadSecurityPoolAdmission(client(`0x${fixedArtifact.evm.deployedBytecode.object}`, 8n), policy, 7n)).toEqual({ address: policy, mode: 'custom' })
	expect(await loadSecurityPoolAdmission(client('0x6000'), policy, 7n)).toEqual({ address: policy, mode: 'custom' })
	const replacedCode: Hex = `0xff${openArtifact.evm.deployedBytecode.object.slice(2)}`
	expect(await loadSecurityPoolAdmission(client(replacedCode), policy, 7n)).toEqual({ address: policy, mode: 'custom' })
})

test('inconsistent fixed-policy immutable values remain unsupported custom policies', async () => {
	const references = Object.values(fixedArtifact.evm.deployedBytecode.immutableReferences).find(entries => entries.length > 1)
	const reference = references?.[0]
	if (reference === undefined) throw new Error('Expected repeated fixed-policy universe immutable')
	const code = fixedArtifact.evm.deployedBytecode.object
	const offset = (reference.start + reference.length - 1) * 2
	const inconsistent: Hex = `0x${code.slice(0, offset)}01${code.slice(offset + 2)}`
	expect(await loadSecurityPoolAdmission(client(inconsistent), policy, 7n)).toEqual({ address: policy, mode: 'custom' })
})

test('policy deployment is separate from security pool deployment and fixed admission is enforced on reads', async () => {
	const open = securityPoolAdmissionCreationRequest(owner, 'open', 7n, [])
	const fixed = securityPoolAdmissionCreationRequest(owner, 'fixed', 7n, [1n, 9n])
	expect(open.account).toBe(owner)
	expect(open.to).toBeUndefined()
	expect(open.reviewDescription).toContain('open question rules')
	expect(fixed.to).toBeUndefined()
	expect(fixed.data.startsWith(`0x${fixedArtifact.evm.bytecode.object}`)).toBe(true)
	expect(fixed.reviewDescription).toContain('fixed question list')
	expect(fixed.reviewDescription).toContain('Nobody can change the list')
	expect(() => securityPoolAdmissionCreationRequest(owner, 'fixed', 7n, [])).toThrow('at least one')
	expect(() => securityPoolAdmissionCreationRequest(owner, 'fixed', 7n, [9n, 1n])).toThrow('increasing unique')
	await expect(requireSecurityPoolQuestionAdmission(client('0x', 7n, false), policy, owner, 7n, 1n)).rejects.toThrow('not allowed')
})

test('registration requires strict escalation headroom above the supply-scaled initial deposit', async () => {
	const supply = 100_000_000n * 10n ** 18n
	for (const threshold of [10n * 10n ** 18n, 10n * 10n ** 18n + 1n]) {
		const client = createMockReadClient(request => {
			expect(request.blockNumber).toBe(99n)
			if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
			if (request.functionName === 'getNonDecisionThresholdAttoRep') return threshold
			if (request.functionName === 'getUniverseTheoreticalSupplyAttoRep') return supply
			throw new Error(`Unexpected eligibility read ${request.functionName}`)
		})
		const checked = requireSecurityPoolQuestionEligibility(client, 0n, 7n, 99n)
		if (threshold === 10n * 10n ** 18n) await expect(checked).rejects.toThrow('threshold is too low')
		else await checked
	}
})
