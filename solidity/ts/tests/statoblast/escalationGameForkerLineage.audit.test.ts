import { describe, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createCompleteSet, depositToEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { initiateSecurityPoolFork, migrateVaultWithUnresolvedEscalation } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getQuestionEndDate } from '../../testSupport/simulator/utils/contracts/statoblast'
import { setVaultCapacityFixture } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import assert from '../../testSupport/simulator/utils/assert'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_SecurityPool_SecurityPool,
	test_statoblast_EscalationGameForkerLineageAttackMocks_EscalationGameForkerLineageAttackPoolMock,
	test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock,
	test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock,
	test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock,
} from '../../types/contractArtifact'
import { useStatoblastTruthAuctionFixture } from './fixture'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('Audit PoC: fake lineage cannot reach a canonical escalation game through the escalation forker', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const { repDeposit, statoblastSecurityMultiplierBps, genesisUniverse } = fixture

	test('a fake parent reporting a canonical game cannot export a vault canonical escrow', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const deploy = async (deployData: `0x${string}`) => {
			const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: deployData }) })
			const address = receipt.contractAddress
			if (address === undefined || address === null) throw new Error('mock deployment address missing')
			return address
		}

		// The vault stakes REP on an unresolved canonical escalation game before an unrelated universe fork.
		await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 10000n)
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, repDeposit / 4n)
		await createCompleteSet(createWriteClient(mockWindow, TEST_ADDRESSES[1]), securityPoolAddresses.securityPool, 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 2n)
		const canonicalGame = await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' })
		const readCanonicalPrincipal = async () => await client.readContract({ address: canonicalGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome', args: [client.account.address, QuestionOutcome.Yes] })
		const canonicalPrincipalBefore = await readCanonicalPrincipal()
		assert.ok(canonicalPrincipalBefore > 0n, 'the vault must hold unresolved canonical escrow')
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, questionId)

		// Attacker lineage: a fake parent forks with its own unresolved game, then reports the canonical game.
		const forker = getInfraContractAddresses().securityPoolForker
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const attackShareToken = await deploy(encodeDeployData({ abi: test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock.abi, bytecode: `0x${test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackShareTokenMock.evm.bytecode.object}`, args: [] }))
		const attackFactory = await deploy(encodeDeployData({ abi: test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi, bytecode: `0x${test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.evm.bytecode.object}`, args: [] }))
		const attackAuction = await deploy(encodeDeployData({ abi: test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock.abi, bytecode: `0x${test_statoblast_EscalationHaircutLineageAttackMocks_EscalationHaircutLineageAttackAuctionMock.evm.bytecode.object}`, args: [] }))
		const deployAttackPool = async (parent: `0x${string}`, repToken: `0x${string}`, universe: bigint) =>
			await deploy(
				encodeDeployData({
					abi: test_statoblast_EscalationGameForkerLineageAttackMocks_EscalationGameForkerLineageAttackPoolMock.abi,
					bytecode: `0x${test_statoblast_EscalationGameForkerLineageAttackMocks_EscalationGameForkerLineageAttackPoolMock.evm.bytecode.object}`,
					args: [parent, repToken, attackFactory, attackShareToken, forker, attackAuction, universe, questionId, statoblastSecurityMultiplierBps],
				}),
			)
		const attackParent = await deployAttackPool(ZERO_ADDRESS, addressString(GENESIS_REPUTATION_TOKEN), genesisUniverse)
		const attackChild = await deployAttackPool(attackParent, getRepTokenAddress(yesUniverse), yesUniverse)
		await client.waitForTransactionReceipt({
			hash: await client.writeContract({ abi: test_statoblast_TruthAuctionAliasAttackMocks_TruthAuctionAliasAttackFactoryMock.abi, address: attackFactory, functionName: 'configureChild', args: [attackChild, attackAuction] }),
		})
		await initiateSecurityPoolFork(client, attackParent)
		await client.waitForTransactionReceipt({
			hash: await client.writeContract({ abi: test_statoblast_EscalationGameForkerLineageAttackMocks_EscalationGameForkerLineageAttackPoolMock.abi, address: attackParent, functionName: 'reportEscalationGame', args: [canonicalGame] }),
		})

		// A vault lured into migrating through the fake parent must keep its canonical escrow.
		const attempt = await migrateVaultWithUnresolvedEscalation(client, attackParent, client.account.address, QuestionOutcome.Yes).then(
			() => undefined,
			(error: unknown) => error,
		)
		assert.strictEqual(await readCanonicalPrincipal(), canonicalPrincipalBefore, 'the canonical game must keep the vault unresolved escrow')
		assert.ok(attempt instanceof Error && /Escalation game pool/.test(attempt.message), 'the forker must reject a parent whose reported game belongs to another pool')
	})
})
