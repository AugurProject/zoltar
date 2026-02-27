import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient } from '../testsuite/simulator/utils/viem.js'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, setupTestAccounts, getERC20Balance, getChildUniverseId, contractExists } from '../testsuite/simulator/utils/utilities.js'
import assert from 'node:assert'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { areEqualArrays } from '../testsuite/simulator/utils/typed-arrays.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { getDeployments } from '../testsuite/simulator/utils/contracts/deployments.js'
import { ensureZoltarDeployed, forkerClaimRep, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getUniverseForkData, getZoltarAddress, isZoltarDeployed, splitRep } from '../testsuite/simulator/utils/contracts/zoltar.js'

describe('Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum
	const genesisUniverse = 0n

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse)))
		await setupTestAccounts(mockWindow)
	})

	test('canDeployContract', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		const isDeployed = await isZoltarDeployed(client)
		assert.ok(isDeployed, `Not Deployed!`)

		const genesisUniverseData = await getUniverseData(client, 0n)
		assert.strictEqual(BigInt(genesisUniverseData.reputationToken), GENESIS_REPUTATION_TOKEN, 'Genesis universe not recognized or not initialized properly')
	})

	test('canForkQuestion', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const client2 = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await ensureZoltarDeployed(client)
		const zoltar = getZoltarAddress()
		const marketText = 'test market'
		const outcomes = ['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4'] as const

		await approveToken(client2, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)

		const preForkUniverseData = await getUniverseData(client, genesisUniverse)
		const genesisRepToken = getRepTokenAddress(genesisUniverse)
		const totalTheoreticalSupply = await getTotalTheoreticalSupply(client, genesisRepToken)
		assert.strictEqual(preForkUniverseData.forkTime, 0n, 'Universe was forked already')
		assert.strictEqual(preForkUniverseData.parentUniverseId, 0n, 'Universe had parent')
		assert.strictEqual(preForkUniverseData.forkingOutcomeIndex, 0n, 'Universe has forking outcome index')
		assert.strictEqual(preForkUniverseData.reputationToken, genesisRepToken, 'Universe reputation token mismatch')
		const priorRepbalance = await getERC20Balance(client, genesisRepToken, client.account.address)

		// do fork
		await forkUniverse(client, genesisUniverse, marketText, outcomes)
		const afterForkBalance = await getERC20Balance(client, genesisRepToken, client.account.address)
		assert.strictEqual(afterForkBalance + totalTheoreticalSupply/20n, priorRepbalance, 'balance mismatch')
		const universeData = await getUniverseData(client, genesisUniverse)
		assert.ok(universeData.forkTime > 0, 'Universe was supposed to be forked')
		assert.strictEqual(universeData.parentUniverseId, 0n, 'Universe had parent')
		assert.strictEqual(universeData.forkingOutcomeIndex, 0n, 'Universe has forking outcome index')
		assert.strictEqual(universeData.reputationToken, genesisRepToken, 'Wrong rep token')
		const universeForkData = await getUniverseForkData(client, genesisUniverse)
		assert.strictEqual(universeForkData.forkedBy, client.account.address, 'We should have been the forker')
		const forkerDeposit = totalTheoreticalSupply / 20n - totalTheoreticalSupply / 20n / 5n // 5% of supply minus 20% burn
		assert.strictEqual(universeForkData.forkerRepDeposit, forkerDeposit, 'wrong deposit amount')
		assert.strictEqual(universeForkData.forkingQuestionExtraInfo, marketText, 'Market text did not match')
		assert.ok(areEqualArrays([...universeForkData.categories], [...outcomes]), 'Outcomes did not match')
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), forkerDeposit, 'forkers deposit should be in zoltar')

		// forker claim balance
		const outcomeIndexes = [0n, 1n, 3n]
		await forkerClaimRep(client, genesisUniverse, outcomeIndexes)
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, zoltar), 0n, 'forkers deposit should be burned')
		const universeForkDataAfterClaim = await getUniverseForkData(client, genesisUniverse)
		assert.strictEqual(universeForkDataAfterClaim.forkerRepDeposit, 0n, 'deposit is gone')
		for (const index of outcomeIndexes) {
			const indexUniverse = getChildUniverseId(genesisUniverse, index)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${ index } exists`);
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, forkerDeposit)
		}

		// split rest of the rep
		const splitOutcomeIndexes = [0n, 1n, 2n]
		const priorBalances = await Promise.all(splitOutcomeIndexes.map(async (index) => {
			const indexUniverse = getChildUniverseId(genesisUniverse, index)
			const repForIndex = getRepTokenAddress(indexUniverse)
			return await contractExists(client, repForIndex) ? await getERC20Balance(client, repForIndex, client.account.address) : 0n
		}))
		const priorSplitBalance = await getERC20Balance(client, genesisRepToken, client.account.address)
		await splitRep(client, genesisUniverse, splitOutcomeIndexes)
		assert.strictEqual(await getERC20Balance(client, genesisRepToken, client.account.address), 0n, 'splitters rep should be gone')
		for (const [index, outcomeIndex] of splitOutcomeIndexes.entries()) {
			const indexUniverse = getChildUniverseId(genesisUniverse, outcomeIndex)
			const repForIndex = getRepTokenAddress(indexUniverse)
			assert.ok(await contractExists(client, repForIndex), `rep token for index ${ outcomeIndex } exists`);
			const ourBalance = await getERC20Balance(client, repForIndex, client.account.address)
			assert.strictEqual(ourBalance, priorSplitBalance + priorBalances[index], 'after split balance mismatch')
		}
	})
})
