import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { getEthRaiseCapAttoEth } from '../../testSupport/simulator/utils/contracts/auction'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getMigratedAttoRep, getSecurityPoolForkerForkData, migrateRepToZoltar, migrateVault, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { createCompleteSet, getSettlementCollateralAttoEth, getSecurityVault, getSystemState, backingUnitsToAttoRep } from '../../testSupport/simulator/utils/contracts/securityPool'
import { approveAndDepositRepToVault, setVaultCapacityFixture } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture } from './fixture'

const transferAbi = [
	{
		type: 'function',
		name: 'transfer',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'recipient', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
] as const

describe('Truth-auction REP donation rounding regression', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { repDeposit, triggerExternalForkForSecurityPool, getYesChildPool } = fixture

	test('full vault migration reconciles donated REP and skips the truth auction', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const vaultClients = [client, createWriteClient(mockWindow, TEST_ADDRESSES[1]), createWriteClient(mockWindow, TEST_ADDRESSES[2]), createWriteClient(mockWindow, TEST_ADDRESSES[3]), createWriteClient(mockWindow, TEST_ADDRESSES[4]), createWriteClient(mockWindow, TEST_ADDRESSES[5])]
		for (const vaultClient of vaultClients.slice(1)) {
			await approveAndDepositRepToVault(vaultClient, repDeposit, questionId)
		}

		const underwritingLimitAttoEthPerVault = repDeposit / 2n
		for (const vaultClient of vaultClients) {
			await setVaultCapacityFixture(vaultClient, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, vaultClient.account.address, underwritingLimitAttoEthPerVault)
		}

		const totalVaultRep = repDeposit * BigInt(vaultClients.length)
		const totalUnderwritingLimitAttoEth = underwritingLimitAttoEthPerVault * BigInt(vaultClients.length)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6])
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, totalUnderwritingLimitAttoEth / 10n)

		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), totalVaultRep, 'test setup should start with exactly six equal vault deposits')

		const donatedRep = 5n
		const donationHash = await client.writeContract({
			abi: transferAbi,
			address: addressString(GENESIS_REPUTATION_TOKEN),
			functionName: 'transfer',
			args: [securityPoolAddresses.securityPool, donatedRep],
		})
		await client.waitForTransactionReceipt({ hash: donationHash })

		await triggerExternalForkForSecurityPool(undefined, 'audit donated REP rounding')
		const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		const forkTimeCollateral = await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(parentForkData.auctionableAttoRepAtFork, totalVaultRep + donatedRep, 'the fork snapshot should count unsolicited REP as auctionable vault REP')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		for (const vaultClient of vaultClients) {
			await migrateVault(vaultClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		}

		const { yesSecurityPool } = getYesChildPool()
		const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(migratedAttoRep, parentForkData.auctionableAttoRepAtFork, 'migrating the complete backingUnits denominator should reconcile every fork-time REP unit')

		const honestVault = await getSecurityVault(client, yesSecurityPool.securityPool, ensureDefined(vaultClients[0], 'missing honest vault client').account.address)
		const honestRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, honestVault.repBackingUnits)
		strictEqualTypeSafe(honestRep, repDeposit, 'the migrated vault should retain its full 1,000 REP claim')
		strictEqualTypeSafe(honestVault.underwritingLimitAttoEth, underwritingLimitAttoEthPerVault, 'the migrated vault should retain its capacity ownership')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const attoEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
		strictEqualTypeSafe(attoEthRaiseCap, 0n, 'full backingUnits migration should finalize without starting an auction')
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), forkTimeCollateral, 'full backingUnits migration should activate with the complete fork-time collateral snapshot')
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the fully migrated child should activate immediately')
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, honestVault.repBackingUnits), repDeposit, 'auction finalization should not dilute migrated vault backingUnits')
	})
})
