import { describe, test } from 'bun:test'
import { encodeAbiParameters, keccak256, zeroAddress } from '@zoltar/shared/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { balanceOfShares, OperationType } from '../testSupport/simulator/utils/contracts/peripherals'
import { createCompleteSet, getShareTokenSupply, redeemShares } from '../testSupport/simulator/utils/contracts/securityPool'
import { peripherals_SecurityPool_SecurityPool, Zoltar_Zoltar } from '../types/contractArtifact'
import { usePeripheralsVaultAccountingFixture } from './peripherals/fixture'

const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

describe('Audit regression: escalation start configuration liveness', () => {
	const fixture = usePeripheralsVaultAccountingFixture()
	const { assert, deployOriginSecurityPool, getSecurityPoolsEscalationGame, getSecurityVault, getZoltarAddress, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, poolOwnershipToRep, redeemRep, reportBond, reportedRepEthPrice, withdrawFromEscalationGame } = fixture

	test('an existing funded pool remains resolvable when the tracked threshold falls to the configured start bond', async () => {
		const { client, genesisUniverse, mockWindow, questionData, securityMultiplier, securityPoolAddresses } = fixture
		const openInterestAmount = 1n * 10n ** 18n
		const securityBondAllowance = 25n * 10n ** 18n
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		const readNonDecisionThreshold = async () =>
			await client.readContract({
				abi: Zoltar_Zoltar.abi,
				address: getZoltarAddress(),
				functionName: 'getNonDecisionThreshold',
				args: [genesisUniverse],
			})

		assert.strictEqual(securityMultiplier, 2n, 'the fixture must use the normal origin-pool security multiplier')
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDeposit',
				args: [],
			}),
			DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit,
			'the canonical factory deployment must preserve the default immutable escalation bond',
		)
		assert.strictEqual(reportBond, DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit, 'the production start bond must be exactly 1 REP')
		assert.ok((await readNonDecisionThreshold()) > reportBond, 'the unmodified production configuration must allow the game to start')

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityBondAllowance, reportedRepEthPrice)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)

		const vaultBeforeResolution = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeResolution = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeResolution.repDepositShare)
		const shareSupplyBeforeResolution = await getShareTokenSupply(client, securityPoolAddresses.securityPool)
		const holderSharesBeforeResolution = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		assert.ok(vaultRepBeforeResolution > reportBond, 'the vault REP redemption must represent a funded claim')
		assert.ok(shareSupplyBeforeResolution > 0n, 'the pool must have open-interest liabilities before escalation starts')
		assert.ok(
			holderSharesBeforeResolution.every(balance => balance > 0n),
			'the share redemption must represent funded outcome balances',
		)

		// Change only Zoltar's tracked supply: token balances, canonical factory wiring,
		// vault accounting, and the real complete-set liabilities remain untouched.
		const trackedSupplyForOneRepThreshold = 2n * reportBond * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: trackedSupplyForOneRepThreshold,
				},
			},
		})
		assert.strictEqual(
			await client.readContract({
				abi: Zoltar_Zoltar.abi,
				address: getZoltarAddress(),
				functionName: 'getUniverseTheoreticalSupply',
				args: [genesisUniverse],
			}),
			trackedSupplyForOneRepThreshold,
			'the liveness PoC must isolate a 40 REP tracked-supply boundary',
		)
		assert.strictEqual(await readNonDecisionThreshold(), reportBond, 'the live non-decision threshold must equal the 1 REP start bond')
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, fixture.questionId, securityMultiplier + 1n), /Escalation threshold too low/)

		await mockWindow.setTime(questionData.endTime + 1n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, reportedRepEthPrice)
		assert.strictEqual(await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool), zeroAddress, 'the first-deposit path must begin without a game')

		await fixture.depositToEscalationGame(client, securityPoolAddresses.securityPool, fixture.QuestionOutcome.Yes, reportBond)
		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		assert.notStrictEqual(escalationGame, zeroAddress, 'the pool must deploy a live escalation game')
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDeposit',
				args: [],
			}),
			reportBond,
			'the immutable configured bond must remain unchanged',
		)
		assert.strictEqual(
			await client.readContract({
				abi: fixture.peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'startBond',
				args: [],
			}),
			reportBond - 1n,
			'the live game bond must be reduced only enough to remain below the threshold',
		)
		assert.strictEqual(
			await client.readContract({
				abi: fixture.peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'nonDecisionThreshold',
				args: [],
			}),
			reportBond,
			'the game must preserve the live non-decision threshold',
		)
		const escalationEndTime = await client.readContract({
			abi: fixture.peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(escalationEndTime + 1n)
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, fixture.QuestionOutcome.Yes, [0n])
		await redeemShares(client, securityPoolAddresses.securityPool)
		await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)

		assert.strictEqual(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'resolved open interest must be fully redeemable')
		const vaultAfterRedemption = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.strictEqual(vaultAfterRedemption.repDepositShare, 0n, 'the funded vault REP claim must be fully redeemable')
	})
})
