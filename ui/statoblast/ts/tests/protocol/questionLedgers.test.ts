import { expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { loadStatoblastQuestion } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import { loadQuestionLedgerMintCapacity } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { centralSecurityPoolRead, owner, securityPool, capital, token } from '../features/security-pools/capitalFixture.js'

const block = { hash: `0x${'11'.repeat(32)}`, number: 99n, timestamp: 1000n } as const
const deployment = { questionLedger: owner, parent: zeroAddress, universeId: 42n, questionId: 7n, initialReportPriorityFeeAttoEthPerGas: 1n, openOraclePriceCoordinator: token, statoblastSecurityMultiplierBps: 20000n }
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
				case 'initialReportPriorityFeeAttoEthPerGas':
					return 1n
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
				case 'lastPrice':
					return 10n
				case 'lastSettlementTimestamp':
					return 950n
				case 'priceValidUntil':
					return 1200n
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
				if (call.functionName === 'openOraclePriceCoordinator') return token
				if (call.functionName === 'parent') return zeroAddress
				if (call.functionName === 'questionId') return deployment.questionId
				if (call.functionName === 'statoblastSecurityMultiplierBps') return deployment.statoblastSecurityMultiplierBps
				if (call.functionName === 'questions') return ['Question', 'Description', 1n, 2000n, 2n, 0n, 2000n, '']
				if (call.functionName === 'questionCreatedTimestamp') return 1n
				if (call.functionName === 'securityPoolCustody') return capital
				if (call.functionName === 'escalationGame') return reporting ? token : zeroAddress
				return centralSecurityPoolRead(call.functionName, 'active')
			})
		},
	})
	return { client, reads }
}
test.each([false, true])('discovers native security pool question snapshots (reporting: %s)', async reporting => {
	const { client, reads } = fixture({ reporting })
	const { question } = await loadStatoblastQuestion(client, securityPool, deployment.questionId, deployment.universeId, false)
	expect(question).toMatchObject({ securityPoolAddress: securityPool, questionLedgerAddress: owner, settlementCollateralAttoEth: 60n, totalPoolHeldAttoRep: 300n, mintingCapacityAttoEth: reporting ? 0n : 80n })
	expect(reads).not.toContain('getVaults')
	expect(reads).not.toContain('securityVaults')
})
test('direct loading rejects a question without verified security pool custody', async () => {
	await expect(loadStatoblastQuestion(fixture({ missingSecurityPool: true }).client, securityPool, deployment.questionId, deployment.universeId, false)).rejects.toThrow('Question has no security pool')
})
test('rejects a replaced discovery anchor after loading question snapshots', async () => {
	await expect(loadStatoblastQuestion(fixture({ reorg: true }).client, securityPool, deployment.questionId, deployment.universeId, false)).rejects.toThrow('Question changed during refresh.')
})
test('reflects a forked universe without per-question vault scans', async () => {
	const { question } = await loadStatoblastQuestion(fixture({ forked: true }).client, securityPool, deployment.questionId, deployment.universeId, false)
	expect(question.universeHasForked).toBe(true)
	expect(question.hasForkActivity).toBe(true)
})
test.each([false, true])('mint capacity uses central fees and closes when reporting starts (%s)', async reporting => {
	const capacity = await loadQuestionLedgerMintCapacity(fixture({ reporting }).client, owner)
	expect(capacity.feeEndTimestamp).toBe(2000n)
	expect(capacity.mintingCapacityAttoEth).toBe(reporting ? 0n : 80n)
})

test('direct question loading never enumerates other deployments', async () => {
	const { client, reads } = fixture()
	expect((await loadStatoblastQuestion(client, securityPool, deployment.questionId, deployment.universeId, false)).question.questionLedgerAddress).toBe(owner)
	expect(reads.slice(0, 3)).toEqual(['isSecurityPool', 'getQuestionLedger', 'openOraclePriceCoordinator'])
	expect(reads).not.toContain('questionLedgerDeploymentCount')
	expect(reads).not.toContain('questionLedgerDeploymentsRange')
})
