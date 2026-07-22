import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, getAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { getCompleteSetCollateralAmount, getCurrentRetentionRate, getPoolOwnershipDenominator, getSecurityPoolsEscalationGame, getSecurityVault, getTotalRepBalance, getTotalSecurityBondAllowance } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool, ReputationToken_ReputationToken } from '../../types/contractArtifact'
import { usePeripheralsVaultAccountingFixture, type PeripheralsVaultAccountingFixture } from './fixture'

describe('Peripherals: privileged authorization matrix', () => {
	const fixture = usePeripheralsVaultAccountingFixture()
	const assert: PeripheralsVaultAccountingFixture['assert'] = fixture.assert
	const { createWriteClient, TEST_ADDRESSES, addressString, manipulatePriceOracleAndPerformOperation, OperationType, QuestionOutcome, depositToEscalationGame, getEscalationGameDeposits, repDeposit } = fixture
	let client: PeripheralsVaultAccountingFixture['client']
	let mockWindow: PeripheralsVaultAccountingFixture['mockWindow']
	let securityPool: Address

	const deployContract = async (deploymentClient: WriteClient, deploymentData: Hex) => {
		const hash = await deploymentClient.sendTransaction({ data: deploymentData })
		const receipt = await deploymentClient.waitForTransactionReceipt({ hash })
		if (typeof receipt.contractAddress !== 'string') throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		securityPool = fixture.securityPoolAddresses.securityPool
	})

	test('REP supply selectors reject attackers without changing balances or supply', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
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
				functionName: 'setMaxTheoreticalSupply',
				args: [1_000n],
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
		const assertUnauthorizedUnchanged = async (execute: () => Promise<unknown>) => {
			const before = await readSnapshot()
			await assert.rejects(execute(), /ReputationToken caller must be the Zoltar contract/)
			assert.deepStrictEqual(await readSnapshot(), before)
		}

		await assertUnauthorizedUnchanged(() =>
			writeContractAndWait(attacker, () =>
				attacker.writeContract({
					abi: ReputationToken_ReputationToken.abi,
					address: reputationToken,
					functionName: 'setMaxTheoreticalSupply',
					args: [2_000n],
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

	test('factory and oracle-only pool selectors reject attackers with full accounting unchanged', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const readSnapshot = async () => ({
			attackerVault: await getSecurityVault(client, securityPool, attacker.account.address),
			collateral: await getCompleteSetCollateralAmount(client, securityPool),
			ethBalance: await getETHBalance(client, securityPool),
			ownerVault: await getSecurityVault(client, securityPool, client.account.address),
			ownershipDenominator: await getPoolOwnershipDenominator(client, securityPool),
			repBalance: await getTotalRepBalance(client, securityPool),
			retentionRate: await getCurrentRetentionRate(client, securityPool),
			totalAllowance: await getTotalSecurityBondAllowance(client, securityPool),
		})
		const assertUnauthorizedUnchanged = async (execute: () => Promise<unknown>, expected: RegExp) => {
			const before = await readSnapshot()
			await assert.rejects(execute(), expected)
			assert.deepStrictEqual(await readSnapshot(), before)
		}

		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						address: securityPool,
						functionName: 'setStartingParams',
						args: [1n, 0n],
					}),
				),
			/Only factory/,
		)
		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						address: securityPool,
						functionName: 'performSetSecurityBondsAllowance',
						args: [attacker.account.address, 0n],
					}),
				),
			/Only coord/,
		)
		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						address: securityPool,
						functionName: 'performWithdrawRep',
						args: [client.account.address, 1n],
					}),
				),
			/Only coord/,
		)
		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						address: securityPool,
						functionName: 'performLiquidation',
						args: [attacker.account.address, client.account.address, 1n, 0n, 0n, 0n, 0n],
					}),
				),
			/Only coord/,
		)

		const authorizedAllowance = repDeposit / 5n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, authorizedAllowance)
		assert.strictEqual(await getTotalSecurityBondAllowance(client, securityPool), authorizedAllowance)

		const rawFactory = await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'securityPoolFactory',
			args: [],
		})
		const factory = getAddress(rawFactory)
		await mockWindow.impersonateAccount(factory)
		const factoryClient = createWriteClient(mockWindow, BigInt(factory), 0)
		const currentRetentionRate = await getCurrentRetentionRate(client, securityPool)
		const currentCollateral = await getCompleteSetCollateralAmount(client, securityPool)
		await writeContractAndWait(factoryClient, () =>
			factoryClient.writeContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'setStartingParams',
				args: [currentRetentionRate, currentCollateral],
			}),
		)
		assert.strictEqual(await getCurrentRetentionRate(client, securityPool), currentRetentionRate)
		assert.strictEqual(await getCompleteSetCollateralAmount(client, securityPool), currentCollateral)
	})

	test('pool-only escalation deposit and withdrawal selectors reject direct callers', async () => {
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		await depositToEscalationGame(client, securityPool, QuestionOutcome.Yes, repDeposit / 10n)
		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPool)
		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes)
		assert.strictEqual(deposits.length, 1, 'authorized pool path should record one escalation deposit')

		const readSnapshot = async () => ({
			attackerEscrow: await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'escrowedRepByVault',
				args: [attacker.account.address],
			}),
			deposits: await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes),
			gameRepBalance: await getERC20Balance(client, await fixture.getRepToken(client, securityPool), escalationGame),
			ownerEscrow: await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'escrowedRepByVault',
				args: [client.account.address],
			}),
			totalEscrow: await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'totalEscrowedRep',
				args: [],
			}),
		})
		const assertUnauthorizedUnchanged = async (execute: () => Promise<unknown>, expected: RegExp) => {
			const before = await readSnapshot()
			await assert.rejects(execute(), expected)
			assert.deepStrictEqual(await readSnapshot(), before)
		}

		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'recordDepositFromSecurityPool',
						args: [attacker.account.address, QuestionOutcome.Yes, 1n, 1n],
					}),
				),
			/Only security pool/,
		)
		await assertUnauthorizedUnchanged(
			() =>
				writeContractAndWait(attacker, () =>
					attacker.writeContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
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
						abi: peripherals_EscalationGame_EscalationGame.abi,
						address: escalationGame,
						functionName: 'drainAllRep',
						args: [addressString(TEST_ADDRESSES[2])],
					}),
				),
			/Only pool/,
		)
	})
})
