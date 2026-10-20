import { describe, test } from 'bun:test'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { createCompleteSet, depositToEscalationGame, getSecurityVault, getSettlementCollateralAttoEth, redeemRepFromVault, redeemShares, setUnderwritingLimit, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { readEscalationGameEndDate } from '../testSupport/simulator/utils/contracts/escalationGame'
import { getQuestionEndDate } from '../testSupport/simulator/utils/contracts/statoblast'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { forkUniverse, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getQuestionId as buildQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approveAndDepositRepToVault, manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { approveToken, getERC20Balance, getETHBalance } from '../testSupport/simulator/utils/utilities'
import assert from '../testSupport/simulator/utils/assert'
import { useStatoblastVaultAccountingFixture } from './statoblast/fixture'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'

describe('Audit PoC: unredeemed winning shares after resolution', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const { repDeposit, reportBond, genesisUniverse, finalizeQuestionAsYesWithoutFork } = fixture

	test('dust winning shares do not lock the last committed vault REP once the escalation settles', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const otherVault = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const winner = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		const dustHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3])
		await approveAndDepositRepToVault(otherVault, repDeposit, questionId)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
		await setUnderwritingLimit(client, securityPoolAddresses.securityPool, repDeposit / 10n)
		await setUnderwritingLimit(otherVault, securityPoolAddresses.securityPool, repDeposit / 10n)
		await createCompleteSet(winner, securityPoolAddresses.securityPool, 10n ** 18n)
		await createCompleteSet(dustHolder, securityPoolAddresses.securityPool, 1_000_000n)

		await finalizeQuestionAsYesWithoutFork()
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await redeemShares(winner, securityPoolAddresses.securityPool)
		const unredeemedCollateralAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
		assert.ok(unredeemedCollateralAttoEth > 0n, 'the dust holder keeps a positive winning claim')

		await setUnderwritingLimit(otherVault, securityPoolAddresses.securityPool, 0n)
		await redeemRepFromVault(otherVault, securityPoolAddresses.securityPool, otherVault.account.address)

		// The settled game cannot fork again and liquidation is closed, so the remaining claim is
		// backed only by ETH already held in the pool. The last vault must be able to leave.
		const lastVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const lastVaultRedeemableAttoRep = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddresses.securityPool,
			functionName: 'backingUnitsToAttoRep',
			args: [lastVaultBefore.repBackingUnits],
		})
		assert.ok(lastVaultRedeemableAttoRep > 0n, 'the last vault still holds REP backing')
		const walletRepBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await setUnderwritingLimit(client, securityPoolAddresses.securityPool, 0n)
		await redeemRepFromVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), walletRepBefore + lastVaultRedeemableAttoRep, 'the last vault recovers all of its REP')
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repBackingUnits, 0n, 'the last vault keeps no REP backing')

		// The dust holder's claim stays fully redeemable without any vault commitment.
		const poolEthBefore = await getETHBalance(client, securityPoolAddresses.securityPool)
		await redeemShares(dustHolder, securityPoolAddresses.securityPool)
		assert.strictEqual(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n, 'the final redemption drains settlement collateral')
		assert.strictEqual(poolEthBefore - (await getETHBalance(client, securityPoolAddresses.securityPool)), unredeemedCollateralAttoEth, 'the dust holder receives its full claim')
	})

	// Two 2 ETH commitments back 3 ETH of collateral, so either vault's exit would leave commitments short.
	// Minting after the question ends keeps retention fees from decaying the collateral below 2 ETH first.
	const openLiveEscalationWithUncoveredExit = async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const otherVault = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await approveAndDepositRepToVault(otherVault, repDeposit, questionId)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
		await setUnderwritingLimit(client, securityPoolAddresses.securityPool, 2n * 10n ** 18n)
		await setUnderwritingLimit(otherVault, securityPoolAddresses.securityPool, 2n * 10n ** 18n)
		await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 10000n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[2]), securityPoolAddresses.securityPool, 3n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const escalationGame = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'escalationGame', args: [] })
		return { otherVault, escalationEndDate: await readEscalationGameEndDate(client, escalationGame) }
	}

	const forkUniverseOnUnrelatedQuestion = async () => {
		const { mockWindow, outcomes, questionData } = fixture
		const forkingClient = createWriteClient(mockWindow, TEST_ADDRESSES[5])
		const forkSourceQuestionData = { ...questionData, title: `commitment floor fork source ${await mockWindow.getTime()}`, endTime: (await mockWindow.getTime()) + DAY }
		await createQuestion(forkingClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(forkingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkingClient, genesisUniverse, buildQuestionId(forkSourceQuestionData, outcomes))
	}

	test('a live escalation game keeps the commitment floor', async () => {
		const { securityPoolAddresses } = fixture
		const { otherVault } = await openLiveEscalationWithUncoveredExit()
		await assert.rejects(setUnderwritingLimit(otherVault, securityPoolAddresses.securityPool, 0n), /Commitments below collateral/)
	})

	test('a universe fork before the game ends keeps commitments locked because the pool can still fork', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const { otherVault, escalationEndDate } = await openLiveEscalationWithUncoveredExit()
		await forkUniverseOnUnrelatedQuestion()
		assert.ok((await mockWindow.getTime()) <= escalationEndDate, 'the universe must fork before the escalation game ends')

		// The interrupted game never resolves, so the fork gate rejects the reduction before the floor is reached.
		await mockWindow.setTime(escalationEndDate + DAY)
		assert.strictEqual(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'isEscalationResolved', args: [] }), false, 'a fork before the game ends leaves the escalation unresolved')
		await assert.rejects(setUnderwritingLimit(otherVault, securityPoolAddresses.securityPool, 0n), /Forked/)
	})

	test('a game settled before an unrelated universe fork still lets vaults exit below collateral', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const { otherVault, escalationEndDate } = await openLiveEscalationWithUncoveredExit()
		await mockWindow.setTime(escalationEndDate + DAY)
		await forkUniverseOnUnrelatedQuestion()
		assert.strictEqual(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'isEscalationResolved', args: [] }), true, 'the game settled before the fork')
		const collateralAttoEth = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
		await setUnderwritingLimit(otherVault, securityPoolAddresses.securityPool, 0n)
		assert.ok((await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'totalUnderwritingLimitAttoEth', args: [] })) < collateralAttoEth, 'the exit leaves commitments below collateral')
	})
})
