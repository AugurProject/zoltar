import { beforeAll, beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { approveAndDepositRepToVault } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { createCompleteSet, getSettlementCollateralAttoEth, getShareTokenSupplyAttoShares, getTotalAccruedFees, redeemCompleteSet, redeemFees, updateSettlementCollateral } from '../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'

const PRICE_PRECISION = 10n ** 18n
const BLOCK_TIME = 12n
const genesisUniverse = 0n
const statoblastSecurityMultiplierBps = 20_000n

describe('Audit PoC: dust settlement collateral fee accrual', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let securityPool: Address

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		const questionData = {
			title: 'dust fee accrual',
			description: '',
			startTime: 0n,
			endTime: (await mockWindow.getTime()) + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		const questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		securityPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
		const minimumVaultRepDepositAttoRep = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'minimumVaultRepDepositAttoRep' })
		await approveAndDepositRepToVault(client, minimumVaultRepDepositAttoRep, questionId)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
	})

	const getFeeEligibleCapacityOwnershipAttoRep = async () => (await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'getPoolAccountingSnapshot' })).feeEligibleCapacityOwnershipAttoRep

	const assertCollateralAndFeesAreFunded = async (label: string) => {
		const [balance, collateral, fees] = await Promise.all([client.getBalance({ address: securityPool }), getSettlementCollateralAttoEth(client, securityPool), getTotalAccruedFees(client, securityPool)])
		assert.ok(collateral + fees <= balance, `${label}: settlement collateral plus fee liabilities must stay funded by the pool balance`)
	}

	const accrueEveryBlock = async (checkpoints: bigint) => {
		for (let checkpoint = 0n; checkpoint < checkpoints; checkpoint++) {
			await mockWindow.advanceTime(BLOCK_TIME)
			await updateSettlementCollateral(client, securityPool)
			await assertCollateralAndFeesAreFunded(`checkpoint ${checkpoint}`)
		}
	}

	test('one attoETH of collateral cannot credit more fees than it holds and brick the pool', async () => {
		const capacity = await getFeeEligibleCapacityOwnershipAttoRep()
		assert.ok(capacity > PRICE_PRECISION, 'a minimum vault deposit should provide more than one attoREP of fee-eligible capacity per attoETH')
		await createCompleteSet(client, securityPool, 1n)
		// Repeatedly re-decaying the same attoETH credits floor(capacity / 1e18) attoETH after this many checkpoints.
		await accrueEveryBlock(capacity / PRICE_PRECISION + 2n)
		assert.ok((await getSettlementCollateralAttoEth(client, securityPool)) <= 1n, 'accrual must never mint collateral')
		assert.ok((await getTotalAccruedFees(client, securityPool)) <= 1n, 'accrual must never credit more fees than the deposited attoETH')

		await redeemFees(client, securityPool, client.account.address)
		await createCompleteSet(client, securityPool, PRICE_PRECISION)
		await mockWindow.advanceTime(DAY)
		await updateSettlementCollateral(client, securityPool)
		await assertCollateralAndFeesAreFunded('after a normal mint')
		await redeemCompleteSet(client, securityPool, await getShareTokenSupplyAttoShares(client, securityPool))
		await assertCollateralAndFeesAreFunded('after redeeming every complete set')
	})

	test('redeeming dust collateral with uncredited decay pending keeps later accruals funded', async () => {
		const capacity = await getFeeEligibleCapacityOwnershipAttoRep()
		await createCompleteSet(client, securityPool, 1n)
		await accrueEveryBlock(3n)
		await redeemCompleteSet(client, securityPool, await getShareTokenSupplyAttoShares(client, securityPool))
		await createCompleteSet(client, securityPool, 1n)
		await accrueEveryBlock(capacity / PRICE_PRECISION + 2n)
		await createCompleteSet(client, securityPool, PRICE_PRECISION)
		await mockWindow.advanceTime(DAY)
		await updateSettlementCollateral(client, securityPool)
		await assertCollateralAndFeesAreFunded('after a normal mint')
	})
})
