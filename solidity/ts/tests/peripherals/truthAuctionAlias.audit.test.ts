import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/shared/ethereum'
import { usePeripheralsTruthAuctionFixture, type PeripheralsTruthAuctionFixture } from './fixture'
import {
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackChildMock,
	test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock,
	test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackParentMock,
	test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock,
} from '../../types/contractArtifact'

describe('Audit PoC: truth-auction aliasing across unauthenticated lineages', () => {
	const fixture = usePeripheralsTruthAuctionFixture()

	const assert: PeripheralsTruthAuctionFixture['assert'] = fixture.assert

	const {
		addressString,
		claimAuctionProceeds,
		createChildUniverse,
		createWriteClient,
		DAY,
		finalizeTruthAuction,
		GENESIS_REPUTATION_TOKEN,
		getChildUniverseId,
		getETHBalance,
		getInfraContractAddresses,
		getRepTokenAddress,
		getSecurityPoolForkerForkData,
		getSystemState,
		initiateSecurityPoolFork,
		participateAuction,
		QuestionOutcome,
		statoblastSecurityMultiplierBps,
		setupStartedTruthAuction,
		startTruthAuction,
		SystemState,
		TEST_ADDRESSES,
		genesisUniverse,
	} = fixture

	let client: PeripheralsTruthAuctionFixture['client']
	let mockWindow: PeripheralsTruthAuctionFixture['mockWindow']
	let questionId: PeripheralsTruthAuctionFixture['questionId']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		questionId = fixture.questionId
	})

	test('a fake lineage cannot alias or finalize a canonical truth auction', async () => {
		const { expectedEthToBuy, repAtFork, yesSecurityPool } = await setupStartedTruthAuction('audit truth-auction alias fork source')
		assert.ok(expectedEthToBuy > 0n, 'canonical child must need positive repair ETH')

		const bidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningTick = await participateAuction(bidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
		const forker = getInfraContractAddresses().securityPoolForker
		const attackReceiver = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const shareTokenDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock.abi,
				bytecode: `0x${test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock.evm.bytecode.object}`,
				args: [],
			}),
		})
		const shareTokenReceipt = await client.waitForTransactionReceipt({ hash: shareTokenDeploymentHash })
		const attackShareToken = shareTokenReceipt.contractAddress
		if (attackShareToken === undefined || attackShareToken === null) throw new Error('attack share token address missing')

		const factoryDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi,
				bytecode: `0x${test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.evm.bytecode.object}`,
				args: [],
			}),
		})
		const factoryReceipt = await client.waitForTransactionReceipt({ hash: factoryDeploymentHash })
		const attackFactory = factoryReceipt.contractAddress
		if (attackFactory === undefined || attackFactory === null) throw new Error('attack factory address missing')

		const parentDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackParentMock.abi,
				bytecode: `0x${test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackParentMock.evm.bytecode.object}`,
				args: [addressString(GENESIS_REPUTATION_TOKEN), attackFactory, attackShareToken, genesisUniverse, questionId, statoblastSecurityMultiplierBps, expectedEthToBuy],
			}),
		})
		const parentReceipt = await client.waitForTransactionReceipt({ hash: parentDeploymentHash })
		const attackParent = parentReceipt.contractAddress
		if (attackParent === undefined || attackParent === null) throw new Error('attack parent address missing')

		const undeployedAuction = addressString(0xdeadbeefn)
		const undeployedAuctionChildHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackChildMock.abi,
				bytecode: `0x${test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackChildMock.evm.bytecode.object}`,
				args: [attackParent, attackFactory, getRepTokenAddress(yesUniverse), forker, undeployedAuction, attackReceiver.account.address, yesUniverse],
			}),
		})
		const undeployedAuctionChildReceipt = await client.waitForTransactionReceipt({ hash: undeployedAuctionChildHash })
		const undeployedAuctionChild = undeployedAuctionChildReceipt.contractAddress
		if (undeployedAuctionChild === undefined || undeployedAuctionChild === null) throw new Error('undeployed-auction child address missing')

		const configureUndeployedHash = await client.writeContract({
			abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi,
			address: attackFactory,
			functionName: 'configureChild',
			args: [undeployedAuctionChild, undeployedAuction],
		})
		await client.waitForTransactionReceipt({ hash: configureUndeployedHash })

		await initiateSecurityPoolFork(client, attackParent)
		await assert.rejects(createChildUniverse(client, attackParent, QuestionOutcome.Yes), /Invalid child/)
		const undeployedAuctionForkData = await getSecurityPoolForkerForkData(client, undeployedAuctionChild)
		assert.strictEqual(undeployedAuctionForkData.truthAuction, addressString(0n), 'rejected fake child must not reserve an undeployed auction address')

		const childDeploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackChildMock.abi,
				bytecode: `0x${test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackChildMock.evm.bytecode.object}`,
				args: [attackParent, attackFactory, getRepTokenAddress(yesUniverse), forker, yesSecurityPool.truthAuction, attackReceiver.account.address, yesUniverse],
			}),
		})
		const childReceipt = await client.waitForTransactionReceipt({ hash: childDeploymentHash })
		const attackChild = childReceipt.contractAddress
		if (attackChild === undefined || attackChild === null) throw new Error('attack child address missing')

		const configureHash = await client.writeContract({
			abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi,
			address: attackFactory,
			functionName: 'configureChild',
			args: [attackChild, yesSecurityPool.truthAuction],
		})
		await client.waitForTransactionReceipt({ hash: configureHash })

		await assert.rejects(createChildUniverse(client, attackParent, QuestionOutcome.Yes), /Invalid child/)

		const attackChildForkData = await getSecurityPoolForkerForkData(client, attackChild)
		assert.strictEqual(attackChildForkData.truthAuction, addressString(0n), 'rejected fake child must not capture the canonical auction')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		const receiverBalanceBefore = await getETHBalance(client, attackReceiver.account.address)
		const canonicalPoolBalanceBefore = await getETHBalance(client, yesSecurityPool.securityPool)

		await assert.rejects(startTruthAuction(client, attackChild))
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		assert.strictEqual(await getETHBalance(client, attackReceiver.account.address), receiverBalanceBefore, 'rejected fake lineage must receive no accepted bid ETH')
		assert.strictEqual((await getETHBalance(client, yesSecurityPool.securityPool)) - canonicalPoolBalanceBefore, expectedEthToBuy, 'canonical child should receive every accepted bid wei')
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackChildMock.abi,
				address: attackChild,
				functionName: 'stolenEth',
			}),
			0n,
			'fake child should record no routed ETH',
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				address: yesSecurityPool.truthAuction,
				functionName: 'finalized',
			}),
			true,
			'canonical auction should finalize only for the canonical child',
		)
		assert.strictEqual(await getSystemState(client, attackChild), SystemState.ForkMigration, 'fake child should remain outside the forker lifecycle')
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'real child should complete canonical settlement')
		await claimAuctionProceeds(bidder, yesSecurityPool.securityPool, bidder.account.address, [{ tick: winningTick, bidIndex: 0n }])
	})
})
