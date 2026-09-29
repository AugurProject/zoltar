import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { depositRepToVault, getSecurityPoolsEscalationGame, getSecurityVault, backingUnitsToAttoRep, getTotalRepBackingUnits, getTotalPoolHeldAttoRep, redeemRepFromVault } from '../testSupport/simulator/utils/contracts/securityPool'
import { getTotalTheoreticalSupply, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { createCarryProof, SparseNullifierTree } from './carryProofHelpers'
import { useStatoblastEscalationMigrationFixture } from './statoblast/fixture'
import { activateContinuationWithoutAuction, createYesContinuationChild, escrowParentVaultBelowNonDecisionThreshold, forkGenesisUniverseExternally, sweepResidualRep } from './residualCaptureHelpers'

describe('Fork-continuation residual settlement regression', () => {
	const fixture = useStatoblastEscalationMigrationFixture()

	test('burns external-fork continuation residual instead of assigning it to a late depositor', async () => {
		const { mockWindow, client, securityPoolAddresses, genesisUniverse } = fixture
		const { nonDecisionThreshold, noPrincipal, yesPrincipal, totalPrincipal } = await escrowParentVaultBelowNonDecisionThreshold(fixture)

		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await forkGenesisUniverseExternally(fixture, forkInitiator, 'audit external fork for zero-owner residual capture')
		const { childPool, childRepToken, childGame, seedRep } = await createYesContinuationChild(fixture)
		await splitMigrationRep(forkInitiator, genesisUniverse, seedRep, [QuestionOutcome.Yes])
		await approveToken(forkInitiator, childRepToken, childPool.securityPool)

		await activateContinuationWithoutAuction(fixture, childPool.securityPool)
		strictEqualTypeSafe(await getTotalRepBackingUnits(client, childPool.securityPool), 0n, 'the activated child must begin without an owner')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, childPool.securityPool), 0n, 'continuation backing must remain in the game, outside pool backing claims')

		const attackerBalanceBeforeDeposit = await getERC20Balance(client, childRepToken, forkInitiator.account.address)
		strictEqualTypeSafe(attackerBalanceBeforeDeposit, seedRep, 'fork split must fund the minimum late deposit')
		await depositRepToVault(forkInitiator, childPool.securityPool, seedRep)
		const attackerVault = await getSecurityVault(client, childPool.securityPool, forkInitiator.account.address)
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, childPool.securityPool, attackerVault.repBackingUnits), seedRep, 'the late depositor must become the sole child-pool owner')

		const continuationEnd = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: childGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(continuationEnd + 1n)
		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const winningProof = await createCarryProof(client, parentGame, {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
			sourceNodeId: 3n,
		})
		const claimHash = await client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: childPool.securityPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [winningProof]],
		})
		await client.waitForTransactionReceipt({ hash: claimHash })

		const rewardBonus = (noPrincipal * 3n) / 5n
		const winnerHaircut = (noPrincipal * 2n) / 5n
		const expectedResidual = totalPrincipal - yesPrincipal - rewardBonus - winnerHaircut
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, childGame), expectedResidual, 'the lower losing side must remain as sweepable continuation residual')
		const theoreticalSupplyBeforeSweep = await getTotalTheoreticalSupply(client, childRepToken)
		const sweepReceipt = await sweepResidualRep(client, childGame)
		const sweepEventNames = sweepReceipt.logs
			.filter(log => log.address.toLowerCase() === childGame.toLowerCase())
			.map(
				log =>
					decodeEventLog({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					}).eventName,
			)
		assert.ok(sweepEventNames.includes('ForkContinuationResidualRepBurned'), 'continuation cleanup must emit its dedicated burn event')
		assert.ok(!sweepEventNames.includes('ResidualRepSweptToSecurityPool'), 'continuation cleanup must not emit the ordinary residual sweep event')
		strictEqualTypeSafe(await getTotalPoolHeldAttoRep(client, childPool.securityPool), seedRep, 'continuation residual must not enter the late depositor-owned pool balance')
		strictEqualTypeSafe(theoreticalSupplyBeforeSweep - (await getTotalTheoreticalSupply(client, childRepToken)), expectedResidual, 'continuation residual must be removed from child-universe supply')

		await redeemRepFromVault(forkInitiator, childPool.securityPool, forkInitiator.account.address)
		const attackerBalanceAfterRedeem = await getERC20Balance(client, childRepToken, forkInitiator.account.address)
		strictEqualTypeSafe(attackerBalanceAfterRedeem, attackerBalanceBeforeDeposit, 'the late depositor should recover only its own seed REP')
		assert.ok(expectedResidual >= nonDecisionThreshold - 3n, 'the burned residual should cover the economically significant capture path')
	})
})
