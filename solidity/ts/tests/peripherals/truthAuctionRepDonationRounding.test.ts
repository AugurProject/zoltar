import { beforeEach, describe, test } from 'bun:test'
import { usePeripheralsTruthAuctionFixture, type PeripheralsTruthAuctionFixture } from './fixture'

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
	const fixture = usePeripheralsTruthAuctionFixture()

	const strictEqualTypeSafe: PeripheralsTruthAuctionFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe

	const {
		addressString,
		approveAndDepositRepToVault,
		createCompleteSet,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		getChildUniverseId,
		getSettlementCollateralAttoEth,
		getERC20Balance,
		getEthRaiseCapAttoEth,
		getMigratedAttoRep,
		getSecurityPoolAddresses,
		getSecurityPoolForkerForkData,
		getSecurityVault,
		getSystemState,
		manipulatePriceOracleAndPerformOperation,
		migrateRepToZoltar,
		migrateVault,
		OperationType,
		backingUnitsToAttoRep,
		QuestionOutcome,
		repDeposit,
		startTruthAuction,
		statoblastSecurityMultiplierBps,
		SystemState,
		TEST_ADDRESSES,
		triggerExternalForkForSecurityPool,
		genesisUniverse,
	} = fixture

	let client: PeripheralsTruthAuctionFixture['client']
	let mockWindow: PeripheralsTruthAuctionFixture['mockWindow']
	let questionId: PeripheralsTruthAuctionFixture['questionId']
	let securityPoolAddresses: PeripheralsTruthAuctionFixture['securityPoolAddresses']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		questionId = fixture.questionId
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	test('full vault migration reconciles donated REP and skips the truth auction', async () => {
		const vaultClients = [client, createWriteClient(mockWindow, TEST_ADDRESSES[1], 0), createWriteClient(mockWindow, TEST_ADDRESSES[2], 0), createWriteClient(mockWindow, TEST_ADDRESSES[3], 0), createWriteClient(mockWindow, TEST_ADDRESSES[4], 0), createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)]
		for (const vaultClient of vaultClients.slice(1)) {
			await approveAndDepositRepToVault(vaultClient, repDeposit, questionId)
		}

		const coverageCommitmentAttoEthPerVault = repDeposit / 2n
		for (const vaultClient of vaultClients) {
			await manipulatePriceOracleAndPerformOperation(vaultClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetCoverageCommitment, vaultClient.account.address, coverageCommitmentAttoEthPerVault)
		}

		const totalVaultRep = repDeposit * BigInt(vaultClients.length)
		const totalCoverageCommitmentAttoEth = coverageCommitmentAttoEthPerVault * BigInt(vaultClients.length)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, totalCoverageCommitmentAttoEth)

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

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const migratedAttoRep = await getMigratedAttoRep(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(migratedAttoRep, parentForkData.auctionableAttoRepAtFork, 'migrating the complete backingUnits denominator should reconcile every fork-time REP unit')

		const honestVault = await getSecurityVault(client, yesSecurityPool.securityPool, vaultClients[0].account.address)
		const honestRep = await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, honestVault.repBackingUnits)
		strictEqualTypeSafe(honestRep, repDeposit, 'the migrated vault should retain its full 1,000 REP claim')
		strictEqualTypeSafe(honestVault.coverageCommitmentAttoEth, coverageCommitmentAttoEthPerVault, 'the migrated vault should retain its coverage commitment')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const attoEthRaiseCap = await getEthRaiseCapAttoEth(client, yesSecurityPool.truthAuction)
		strictEqualTypeSafe(attoEthRaiseCap, 0n, 'full backingUnits migration should finalize without starting an auction')
		strictEqualTypeSafe(await getSettlementCollateralAttoEth(client, yesSecurityPool.securityPool), forkTimeCollateral, 'full backingUnits migration should activate with the complete fork-time collateral snapshot')
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the fully migrated child should activate immediately')
		strictEqualTypeSafe(await backingUnitsToAttoRep(client, yesSecurityPool.securityPool, honestVault.repBackingUnits), repDeposit, 'auction finalization should not dilute migrated vault backingUnits')
	})
})
