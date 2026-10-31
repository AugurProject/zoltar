import { expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, zeroAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { prepareChildPool, loadChildPoolPreparation, loadChildHistoryPreparation, initializeChildDisputeHistory } from '@zoltar/ui-statoblast-shared/protocol/forkPreparation.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const parent = getAddress('0x0000000000000000000000000000000000000001')
for (const kind of ['feed', 'dependencies'] as const)
	test(`${kind} preparation submits only the selected factory transaction`, async () => {
		const sent: Hex[] = []
		const client = asWriteClient(
			createMockWriteClient(
				request => {
					if (request.data !== undefined) sent.push(request.data)
				},
				async request => {
					if (request.functionName === 'getSecurityPoolPortfolio') return zeroAddress
					throw new Error(`Unexpected ${request.functionName}`)
				},
			),
		)
		await prepareChildPool(client, parent, 0n, 'yes', kind)
		expect(sent).toHaveLength(1)
		const data = sent[0]
		if (data === undefined) throw new Error('Missing transaction')
		const decoded = decodeFunctionData({ abi: factoryArtifact.abi, data })
		expect(decoded.functionName).toBe(kind === 'feed' ? 'preparePortfolioChildPriceFeed' : 'prepareChildPoolDependencies')
		expect(decoded.args).toEqual([parent, 1n])
	})

for (const shared of [false, true])
	test(`reads preparation state from the canonical factory (${shared})`, async () => {
		const readContract = createReadContractStub(async request => {
			switch (request.functionName) {
				case 'forkController':
					return parent
				case 'isReady':
					return true
				case 'getSecurityPoolPortfolio':
					return shared ? parent : zeroAddress
				case 'getSecurityPoolOriginId':
					return `0x${'00'.repeat(32)}`
				case 'getChildPoolDependencies':
					return [parent, parent]
				case 'getSecurityPool':
					return zeroAddress
				case 'sharedPriceFeeds':
					expect(request.args).toEqual([parent, 5n])
					return zeroAddress
				default:
					throw new Error(`Unexpected read ${request.functionName}`)
			}
		})
		expect(await loadChildPoolPreparation({ readContract }, parent, 5n, 'yes')).toEqual({ portfolio: shared ? parent : undefined, branchReady: shared ? true : undefined, childPool: zeroAddress, sharedFeed: undefined, dependenciesPrepared: true, historyOutcomesInitialized: 0, historyReady: false })
	})

for (const initialized of [0, 1, 2, 3])
	test(`reads bounded child history readiness at ${initialized}/3`, async () => {
		const readContract = createReadContractStub(async request => {
			if (request.functionName === 'escalationGame') return parent
			if (request.functionName === 'forkContinuation') return true
			if (request.functionName === 'forkCarrySnapshotOutcomesInitialized') return initialized
			throw new Error(`Unexpected ${request.functionName}`)
		})
		expect(await loadChildHistoryPreparation({ readContract }, parent)).toEqual({ historyOutcomesInitialized: initialized, historyReady: initialized === 3 })
	})

test('one initialization submission advances only one outcome and does not migrate a vault', async () => {
	const sent: Hex[] = []
	const client = asWriteClient(
		createMockWriteClient(
			request => {
				if (request.data !== undefined) sent.push(request.data)
			},
			async request => {
				if (request.functionName === 'getSecurityPoolPortfolio') return zeroAddress
				throw new Error(`Unexpected ${request.functionName}`)
			},
		),
	)
	await initializeChildDisputeHistory(client, parent, 0n, 'yes')
	expect(sent).toHaveLength(1)
	const data = sent[0]
	if (data === undefined) throw new Error('Missing initialization')
	expect(decodeFunctionData({ abi: forkerArtifact.abi, data })).toMatchObject({ functionName: 'continueChildUniverse', args: [parent, 1n] })
})

for (const mode of ['prepare', 'materialize'] as const)
	test(`bound ${mode} submits one bounded step using the last live reporter source`, async () => {
		const source = getAddress('0x0000000000000000000000000000000000000007')
		const sent: Hex[] = []
		const client = asWriteClient(
			createMockWriteClient(
				request => {
					if (request.data !== undefined) sent.push(request.data)
				},
				async request => {
					if (request.functionName === 'getSecurityPoolPortfolio' || request.functionName === 'forkController' || request.functionName === 'sourceGame') return parent
					if (request.functionName === 'getChildUniverseId') return 42n
					if (request.functionName === 'questionId') return 5n
					if (request.functionName === 'isReady') return true
					if (request.functionName === 'securityPool') return source
					throw new Error(`Unexpected ${request.functionName}`)
				},
			),
		)
		if (mode === 'prepare') await prepareChildPool(client, parent, 0n, 'yes', 'feed')
		else await initializeChildDisputeHistory(client, parent, 0n, 'yes')
		expect(sent).toHaveLength(1)
		const data = sent[0]
		if (data === undefined) throw new Error('Missing wallet request')
		expect(decodeFunctionData({ abi: forkerArtifact.abi, data })).toMatchObject({ functionName: mode === 'prepare' ? 'preparePortfolioQuestion' : 'materializePortfolioQuestion', args: [source, 42n] })
	})
test('portfolio history reports progress while the fixed three outcomes are being installed', async () => {
	const readContract = createReadContractStub(async request => {
		if (['getSecurityPoolPortfolio', 'getSecurityPool', 'forkController', 'escalationGame'].includes(request.functionName)) return parent
		if (request.functionName === 'getSecurityPoolOriginId') return `0x${'00'.repeat(32)}`
		if (request.functionName === 'isReady' || request.functionName === 'forkContinuation') return true
		if (request.functionName === 'systemState') return 3n
		if (request.functionName === 'forkCarrySnapshotOutcomesInitialized') return 2n
		throw new Error(`Unexpected ${request.functionName}`)
	})
	expect(await loadChildPoolPreparation({ readContract }, parent, 42n, 'yes')).toMatchObject({ portfolio: parent, branchReady: true, historyOutcomesInitialized: 2, historyReady: false })
})
