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
			createMockWriteClient(request => {
				if (request.data !== undefined) sent.push(request.data)
			}),
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
		expect(await loadChildPoolPreparation({ readContract }, parent, 5n, 'yes')).toEqual({ childPool: zeroAddress, sharedFeed: shared ? zeroAddress : undefined, dependenciesPrepared: true, historyOutcomesInitialized: 0, historyReady: false })
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
		createMockWriteClient(request => {
			if (request.data !== undefined) sent.push(request.data)
		}),
	)
	await initializeChildDisputeHistory(client, parent, 0n, 'yes')
	expect(sent).toHaveLength(1)
	const data = sent[0]
	if (data === undefined) throw new Error('Missing initialization')
	expect(decodeFunctionData({ abi: forkerArtifact.abi, data })).toMatchObject({ functionName: 'continueChildUniverse', args: [parent, 1n] })
})
