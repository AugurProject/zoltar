import { expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { loadStatoblastQuestion, type QuestionReadCheckpoint } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import { loadQuestionLedgerMintCapacity } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { createMockLoaderClient, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { centralSecurityPoolRead, owner, securityPool, capital, token } from '../features/security-pools/capitalFixture.js'

const block = { hash: `0x${'11'.repeat(32)}`, number: 99n, timestamp: 1000n } as const
const deployment = { universeId: 42n, questionId: 7n }
function fixture({ forked = false, reporting = false, missingSecurityPool = false, reorg = false } = {}) {
	const reads: string[] = []
	let headReads = 0
	const client = createMockLoaderClient({
		getBlock: async () => {
			headReads++
			return reorg && headReads > 1 ? { ...block, hash: `0x${'22'.repeat(32)}` as const } : block
		},
		readContract: async request => {
			reads.push(request.functionName)
			if (request.functionName !== 'getOutcomeLabels') expect(request.blockNumber).toBe(99n)
			switch (request.functionName) {
				case 'shareToken':
					return token
				case 'securityPoolCustody':
					return missingSecurityPool ? zeroAddress : capital
				case 'securityPoolOf':
					return securityPool
				case 'escalationGame':
					return reporting ? token : zeroAddress
				case 'forkContinuation':
					return forked
				case 'systemState':
					return 0n
				case 'getQuestionOutcome':
					return 3n
				case 'getForkTime':
					return forked ? 900n : 0n
				case 'priceValidUntil':
					expect(request.address).toBe(capital)
					return 1200
				case 'questions':
					return ['Question', 'Description', 1n, 2n, 2n, 0n, 2000n, '']
				case 'getOutcomeLabels':
					return ['Invalid', 'Yes', 'No']
				default:
					throw new Error(`Unexpected read ${request.functionName}`)
			}
		},
		multicall: async request => {
			if (request.contracts[0]?.functionName !== 'questions') expect(request.blockNumber).toBe(99n)
			return request.contracts.map(call => {
				reads.push(call.functionName)
				if (call.functionName === 'isSecurityPool') return { status: 'success', result: true }
				if (call.functionName === 'getQuestionLedger') return { status: 'success', result: owner }
				if (call.functionName === 'questionId') return deployment.questionId
				if (call.functionName === 'initialReportingResponseWindow') return 172_800n
				if (call.functionName === 'questions') return ['Question', 'Description', 1n, 2000n, 2n, 0n, 2000n, '']
				if (call.functionName === 'questionCreatedTimestamp') return 1n
				if (call.functionName === 'securityPoolCustody') return missingSecurityPool ? zeroAddress : capital
				if (call.functionName === 'securityPoolOf') return securityPool
				if (call.functionName === 'escalationGame') return reporting ? token : zeroAddress
				if (call.functionName === 'systemState') return 0n
				if (call.functionName === 'getQuestionOutcome') return 3n
				if (call.functionName === 'getForkTime') return forked ? 900n : 0n
				return centralSecurityPoolRead(call.functionName, 'active')
			})
		},
	})
	return { client, reads }
}
test.each([false, true])('discovers native security pool question snapshots (reporting: %s)', async reporting => {
	const { client, reads } = fixture({ reporting })
	const { question } = await loadStatoblastQuestion(client, securityPool, deployment.questionId, deployment.universeId, false)
	expect(question).toMatchObject({ securityPoolAddress: securityPool, questionLedgerAddress: owner, settlementCollateralAttoEth: 60n, totalPoolHeldAttoRep: 300n, mintingCapacityAttoEth: reporting ? 0n : 80n, initialReportingResponseWindow: 172_800n, oraclePriceValidUntilTimestamp: 1200n })
	expect(reads).not.toContain('getVaults')
	expect(reads).not.toContain('securityVaults')
})
test('direct loading rejects a question without verified security pool custody', async () => {
	await expect(loadStatoblastQuestion(fixture({ missingSecurityPool: true }).client, securityPool, deployment.questionId, deployment.universeId, false)).rejects.toThrow('Question has no security pool')
})
test('rejects a replaced discovery anchor after loading question snapshots', async () => {
	await expect(loadStatoblastQuestion(fixture({ reorg: true }).client, securityPool, deployment.questionId, deployment.universeId, false)).rejects.toThrow('Question changed during refresh.')
})

test('a failed final block check resumes the verified question read on retry', async () => {
	const { client, reads } = fixture()
	const getBlock = client.getBlock
	let blockReads = 0
	client.getBlock = async parameters => {
		if (++blockReads === 2) throw new Error('RPC unavailable')
		return await getBlock(parameters)
	}
	const checkpoint: QuestionReadCheckpoint = {}
	const load = () => loadStatoblastQuestion(client, securityPool, deployment.questionId, deployment.universeId, false, false, checkpoint)
	await expect(load()).rejects.toThrow('RPC unavailable')
	const previousReads = reads.length
	await expect(load()).resolves.toMatchObject({ question: { questionLedgerAddress: owner } })
	expect(reads).toHaveLength(previousReads)
})

test('retry starts from a new head when the question was missing at the previous block', async () => {
	const { client } = fixture()
	const getBlock = client.getBlock
	const multicall = client.multicall
	let latestReads = 0
	let registered = false
	client.getBlock = async request => {
		if (request?.blockNumber === undefined) latestReads++
		return await getBlock(request)
	}
	client.multicall = createMulticallStub(request => {
		if (!registered && request.contracts[0]?.functionName === 'getQuestionLedger') return [{ status: 'failure', error: new Error('Multicall contract call failed: execution reverted: Question not registered') }]
		return multicall(request)
	})
	const checkpoint: QuestionReadCheckpoint = {}
	const load = () => loadStatoblastQuestion(client, securityPool, deployment.questionId, deployment.universeId, false, false, checkpoint)
	await expect(load()).rejects.toThrow('Question not registered')
	registered = true
	await expect(load()).resolves.toMatchObject({ question: { questionLedgerAddress: owner } })
	expect(latestReads).toBe(2)
})
test('reflects a forked universe without per-question vault scans', async () => {
	const { question } = await loadStatoblastQuestion(fixture({ forked: true }).client, securityPool, deployment.questionId, deployment.universeId, false)
	expect(question.universeHasForked).toBe(true)
})
test.each([false, true])('mint capacity uses central fees and closes when reporting starts (%s)', async reporting => {
	const capacity = await loadQuestionLedgerMintCapacity(fixture({ reporting }).client, owner)
	expect(capacity.feeEndTimestamp).toBe(2000n)
	expect(capacity.mintingCapacityAttoEth).toBe(reporting ? 0n : 80n)
})

test('direct question loading never enumerates other deployments', async () => {
	const { client, reads } = fixture()
	expect((await loadStatoblastQuestion(client, securityPool, deployment.questionId, deployment.universeId, false)).question.questionLedgerAddress).toBe(owner)
	expect(reads.slice(0, 3)).toEqual(['isSecurityPool', 'getQuestionLedger', 'questionId'])
	expect(reads).not.toContain('questionLedgerDeploymentCount')
	expect(reads).not.toContain('questionLedgerDeploymentsRange')
})
