import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_SecurityPoolUtils_SecurityPoolUtils, statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../types/contractArtifact'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../testSupport/storage'
import { createCompleteSet, depositRepToVault, getRepToken } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { getEthRaiseCapAttoEth } from '../../../testSupport/simulator/utils/contracts/auction'
import { getTotalTheoreticalSupply } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { finalizeTruthAuction, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { getQuestionEndDate, participateAuction } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { approveToken } from '../../../testSupport/simulator/utils/utilities'
import { DAY, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../../testSupport/simulator/utils/clients'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getContractOutput, loadContractsJson, normalizeStorageLayout } from '../../contractArtifactHelpers'
import type { StatoblastTruthAuctionFixture } from '../fixture'

/** Storage slot of `SecurityPool.feeEpochEndTime`, read from the compiled storage layout. */
export function getFeeEpochEndTimeStorageSlot(): bigint {
	const poolStorageLayout = normalizeStorageLayout(getContractOutput(loadContractsJson(`${import.meta.dir}/../..`), 'contracts/statoblast/SecurityPool.sol', 'SecurityPool'))
	const feeEpochStorage = poolStorageLayout.find(entry => entry.label === 'feeEpochEndTime')
	if (feeEpochStorage === undefined) throw new Error('SecurityPool storage layout is missing feeEpochEndTime')
	return BigInt(feeEpochStorage.slot)
}

export async function getPendingAuctionRefund(client: WriteClient, truthAuction: Address, bidder: Address) {
	return await client.readContract({
		abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		address: truthAuction,
		functionName: 'pendingEthRefundsAttoEth',
		args: [bidder],
	})
}

export async function withdrawPendingAuctionRefund(bidderClient: WriteClient, truthAuction: Address) {
	await writeContractAndWait(bidderClient, () =>
		bidderClient.writeContract({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			address: truthAuction,
			functionName: 'withdrawPendingEthRefund',
		}),
	)
}

export async function getUnassignedPosition(client: WriteClient, securityPool: Address) {
	const [repBackingUnits, underwritingLimitAttoEth, badDebtAttoEth] = await client.readContract({
		abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
		address: getInfraContractAddresses().securityPoolForker,
		functionName: 'getUnassignedPosition',
		args: [securityPool],
	})
	const [feeIndex, claimableFeesAttoEth] = await client.readContract({
		abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi,
		address: getInfraContractAddresses().securityPoolUtils,
		functionName: 'getUnassignedPositionFeeAccounting',
		args: [securityPool],
	})
	return { repBackingUnits, underwritingLimitAttoEth, badDebtAttoEth, feeIndex, claimableFeesAttoEth }
}

export async function setupFinalizedAuctionWithUnclaimedUnderwritingLimitAttoEth(fixture: StatoblastTruthAuctionFixture, forkSource: string) {
	const { mockWindow, client, securityPoolAddresses, questionId, repDeposit, triggerExternalForkForSecurityPool, getYesChildPool } = fixture
	const unmigratedUnderwritingLimitAttoEthHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
	const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
	const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3])
	await approveAndDepositRepToVault(unmigratedUnderwritingLimitAttoEthHolder, repDeposit, questionId)

	const endTime = await getQuestionEndDate(client, questionId)
	const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
	await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
	await mockWindow.setTime(endTime + 10000n)

	const securityPoolUnderwritingLimitAttoEth = repDeposit / 8n
	await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
	await setVaultCapacityFixture(unmigratedUnderwritingLimitAttoEthHolder, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, unmigratedUnderwritingLimitAttoEthHolder.account.address, securityPoolUnderwritingLimitAttoEth)

	await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

	await triggerExternalForkForSecurityPool(undefined, forkSource)
	await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
	await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

	const { yesSecurityPool } = getYesChildPool()
	await mockWindow.advanceTime(8n * 7n * DAY + DAY)
	await startTruthAuction(client, yesSecurityPool.securityPool)

	const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableAttoRepAtFork
	const expectedEthToBuy = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
	const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

	await mockWindow.advanceTime(7n * DAY + DAY)
	await finalizeTruthAuction(client, yesSecurityPool.securityPool)
	const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
	const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
	const clientChildRepBalanceSlot = formatStorageSlot(getAddressMappingStorageSlot(client.account.address, 0n))
	await mockWindow.addStateOverrides({
		[childRepToken]: {
			stateDiff: {
				[clientChildRepBalanceSlot]: repDeposit,
			},
		},
	})
	await approveToken(client, childRepToken, getInfraContractAddresses().openOracle)

	return {
		auctionParticipant,
		auctionTick,
		auctionedUnderwritingLimitAttoEth: forkData.auctionedUnderwritingLimitAttoEth,
		migratedUnderwritingLimitAttoEth: securityPoolUnderwritingLimitAttoEth,
		yesSecurityPool,
	}
}
