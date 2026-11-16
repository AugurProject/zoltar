import { getEscalationGameDeposits } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getRepToken } from '../../testSupport/simulator/utils/contracts/securityPool'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import assert from '../../testSupport/simulator/utils/assert'
import { encodeDeployData, encodeFunctionData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { deployContract } from '../../testSupport/deployContract'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getSecurityPoolsEscalationGame, getSettlementCollateralAttoEth } from '../../testSupport/simulator/utils/contracts/securityPool'
import { approveToken, getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { ReputationToken_ReputationToken, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_EscalationGame_EscalationGame, statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate, statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const assertRejectsWithoutStateChange = async <Snapshot>(readSnapshot: () => Promise<Snapshot>, execute: () => Promise<unknown>, expected: RegExp) => {
	const before = await readSnapshot()
	await assert.rejects(execute(), expected)
	assert.deepStrictEqual(await readSnapshot(), before)
}

describe('Statoblast: privileged authorization matrix', () => {
	const portfolio = useSecurityPoolPortfolioFixture()
	const fixture = portfolio.base

	const repDeposit = 1_000n * unit
	let client: typeof fixture.client
	let mockWindow: typeof fixture.mockWindow
	let securityPool: Address

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		securityPool = portfolio.poolFor(fixture.questionId).securityPool
	})

	test('REP supply selectors reject attackers without changing balances or supply', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const reputationToken = await deployContract(
			client,
			encodeDeployData({
				abi: ReputationToken_ReputationToken.abi,
				bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
				args: [client.account.address],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationToken,
				functionName: 'initialize',
				args: [1n, 1_000n, 1n],
			}),
		)

		const readSnapshot = async () => ({
			attackerBalance: await getERC20Balance(client, reputationToken, attacker.account.address),
			ownerBalance: await getERC20Balance(client, reputationToken, client.account.address),
			theoreticalSupply: await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationToken,
				functionName: 'getTotalTheoreticalSupply',
				args: [],
			}),
			totalSupply: await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationToken,
				functionName: 'totalSupply',
				args: [],
			}),
		})
		const assertUnauthorizedUnchanged = async (execute: () => Promise<unknown>) => await assertRejectsWithoutStateChange(readSnapshot, execute, /ReputationToken caller must be the Zoltar contract/)

		await assertUnauthorizedUnchanged(() =>
			writeContractAndWait(attacker, () =>
				attacker.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: reputationToken,
					functionName: 'initialize',
					args: [2n, 2_000n, 2n],
				}),
			),
		)
		await assertUnauthorizedUnchanged(() =>
			writeContractAndWait(attacker, () =>
				attacker.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: reputationToken,
					functionName: 'mint',
					args: [attacker.account.address, 100n],
				}),
			),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationToken,
				functionName: 'mint',
				args: [client.account.address, 500n],
			}),
		)
		await assertUnauthorizedUnchanged(() =>
			writeContractAndWait(attacker, () =>
				attacker.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: reputationToken,
					functionName: 'burn',
					args: [client.account.address, 100n],
				}),
			),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationToken,
				functionName: 'burn',
				args: [client.account.address, 100n],
			}),
		)
		const finalSnapshot = await readSnapshot()
		assert.strictEqual(finalSnapshot.totalSupply, 400n)
		assert.strictEqual(finalSnapshot.theoreticalSupply, 900n)
		assert.strictEqual(finalSnapshot.ownerBalance, 400n)
		assert.strictEqual(finalSnapshot.attackerBalance, 0n)
	})

	const readPoolSnapshot = async () => ({
		collateral: await getSettlementCollateralAttoEth(client, securityPool),
		eth: await getETHBalance(client, securityPool),
		capitalRep: await getERC20Balance(client, await getRepToken(client, securityPool), portfolio.capitalLedger),
		capital: await client.readContract({ abi: capitalArtifact.abi, address: portfolio.capitalLedger, functionName: 'totals' }),
		owner: await client.readContract({ abi: capitalArtifact.abi, address: portfolio.capitalLedger, functionName: 'storedOwnerAccount', args: [client.account.address] }),
	})

	test('factory initialization and portfolio custody binding reject attackers without changing capital', async () => {
		await portfolio.prepare()
		const attacker = portfolio.other()
		await assertRejectsWithoutStateChange(readPoolSnapshot, () => attacker.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'setStartingParams' }), /Only factory/)
		await assertRejectsWithoutStateChange(readPoolSnapshot, () => attacker.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'setPortfolioCustody', args: [attacker.account.address] }), /Only portfolio/)
	})

	test('escalation accounting rejects direct callers without changing capital', async () => {
		await portfolio.prepare()
		const attacker = portfolio.other()
		for (const functionName of ['creditEscalationSurplus', 'burnEscalationWinnerHaircut'] as const) {
			await assertRejectsWithoutStateChange(readPoolSnapshot, () => attacker.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName, args: [1n] }), /Only escalation game/)
		}
	})

	test('every forker-only pool mutation rejects direct callers without changing accounting', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const poolAbi = statoblast_SecurityPool_SecurityPool.abi
		const readSnapshot = readPoolSnapshot
		const calls = [
			{ name: 'activateForkMode', data: encodeFunctionData({ abi: poolAbi, functionName: 'activateForkMode', args: [] }) },
			{ name: 'initializeForkedEscalationGame', data: encodeFunctionData({ abi: poolAbi, functionName: 'initializeForkedEscalationGame', args: [1n, 2n, 0n, QuestionOutcome.None] }) },
			{ name: 'setAwaitingForkContinuation', data: encodeFunctionData({ abi: poolAbi, functionName: 'setAwaitingForkContinuation', args: [true] }) },
			{ name: 'setSystemState', data: encodeFunctionData({ abi: poolAbi, functionName: 'setSystemState', args: [1] }) },
			{ name: 'setShareTokenSupplyAttoShares', data: encodeFunctionData({ abi: poolAbi, functionName: 'setShareTokenSupplyAttoShares', args: [1n] }) },
			{ name: 'authorizeChildPool', data: encodeFunctionData({ abi: poolAbi, functionName: 'authorizeChildPool', args: [zeroAddress] }) },
		]
		const before = await readSnapshot()
		for (const call of calls) {
			await assert.rejects(attacker.sendTransaction({ to: securityPool, data: call.data }), /Only forker/, call.name)
			assert.deepStrictEqual(await readSnapshot(), before)
		}
	})

	test('pool-only escalation deposit and withdrawal selectors reject direct callers', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		await approveToken(client, await getRepToken(client, securityPool), securityPool)
		await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.Yes, repDeposit / 10n] }))
		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPool)
		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes)
		assert.strictEqual(deposits.length, 1, 'authorized pool path should record one escalation deposit')
		const existingDeposit = deposits[0]
		if (existingDeposit === undefined) throw new Error('expected initial escalation deposit')
		const repToken = await getRepToken(client, securityPool)

		const readSnapshot = async () => ({
			attackerEscrow: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'disputeStakedRepByVaultAttoRep',
				args: [attacker.account.address],
			}),
			deposits: await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes),
			attackerRepBalance: await getERC20Balance(client, repToken, attacker.account.address),
			gameRepBalance: await getERC20Balance(client, repToken, escalationGame),
			ownerLocalUnresolved: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
				args: [client.account.address, QuestionOutcome.Yes],
			}),
			ownerEscrow: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'disputeStakedRepByVaultAttoRep',
				args: [client.account.address],
			}),
			totalEscrow: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'totalDisputeStakedAttoRep',
				args: [],
			}),
		})
		const assertUnauthorizedUnchanged = async (execute: () => Promise<unknown>, expected: RegExp) => await assertRejectsWithoutStateChange(readSnapshot, execute, expected)

		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'recordDepositFromSecurityPool',
						args: [attacker.account.address, QuestionOutcome.Yes, 1n, 1n],
					}),
				),
			/Only pool/,
		)
		const internalDelegateCalls = [
			{
				name: 'recordDeposit',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'recordDeposit',
					args: [attacker.account.address, QuestionOutcome.Yes, repDeposit, existingDeposit.cumulativeAmountAttoRep + repDeposit],
				}),
			},
			{
				name: 'recordForkedEscrowForOutcome',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'recordForkedEscrowForOutcome',
					args: [attacker.account.address, QuestionOutcome.Yes, 1n, 1n],
				}),
			},
			{
				name: 'consumeEscrowedRepForOwner',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'consumeEscrowedRepForOwner',
					args: [client.account.address, 1n],
				}),
			},
			{
				name: 'consumeCarriedDeposit',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'consumeCarriedDeposit',
					args: [QuestionOutcome.Yes, 0n, 1n, 1n, 0n, 1n],
				}),
			},
			{
				name: 'consumeUnresolvedRepForClaimOwners',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'consumeUnresolvedRepForClaimOwners',
					args: [client.account.address, QuestionOutcome.Yes, 1n, 0n],
				}),
			},
			{
				name: 'creditClaimOwners',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'creditClaimOwners',
					args: [attacker.account.address, 1n],
				}),
			},
			{
				name: 'creditExternalClaimOwners',
				data: encodeFunctionData({
					abi: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.abi,
					functionName: 'creditExternalClaimOwners',
					args: [zeroAddress, attacker.account.address, 0n, 1n, 0n],
				}),
			},
		]
		for (const call of internalDelegateCalls) {
			await assertUnauthorizedUnchanged(() => attacker.sendTransaction({ to: escalationGame, data: call.data }), /revert/i)
		}
		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'withdrawDeposit',
						args: [0n, QuestionOutcome.Yes],
					}),
				),
			/Only pool/,
		)
		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'drainAllRep',
						args: [addressString(TEST_ADDRESSES[2])],
					}),
				),
			/Only pool/,
		)
	})
})
