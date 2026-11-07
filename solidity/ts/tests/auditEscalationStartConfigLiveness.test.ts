import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../types/contractArtifact'
import { statoblast_EscalationGame_EscalationGame } from '../types/contractArtifact'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityPoolsEscalationGame, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { encodeAbiParameters, keccak256, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { balanceOfShares } from '../testSupport/simulator/utils/contracts/statoblast'
import { getShareTokenSupplyAttoShares, redeemShares } from '../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_SecurityPool_SecurityPool, Zoltar_Zoltar } from '../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

describe('Audit regression: escalation start configuration liveness', () => {
	const portfolio = useSecurityPoolPortfolioFixture()
	const fixture = portfolio.base
	const reportBond = 11n * 10n ** 17n

	test('an existing funded pool remains resolvable when the tracked threshold falls to the configured start bond', async () => {
		const { client, genesisUniverse, mockWindow, questionData, statoblastSecurityMultiplierBps } = fixture
		const securityPoolAddresses = portfolio.poolFor(fixture.questionId)
		const openInterestAmount = 1n * 10n ** 18n
		const underwritingLimitAttoEth = 25n * 10n ** 18n
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		const readNonDecisionThreshold = async () =>
			await client.readContract({
				abi: Zoltar_Zoltar.abi,
				address: getZoltarAddress(),
				functionName: 'getNonDecisionThresholdAttoRep',
				args: [genesisUniverse],
			})

		assert.strictEqual(statoblastSecurityMultiplierBps, 20_000n, 'the fixture must use the normal origin-pool security multiplier')
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDepositAttoRep',
				args: [],
			}),
			reportBond,
			'the canonical pool must apply the supply-based escalation bond floor',
		)
		assert.ok(reportBond > 10n ** 18n, 'the supply-based floor must exceed the one-REP minimum in this fixture')
		assert.ok((await readNonDecisionThreshold()) > reportBond, 'the unmodified production configuration must allow the game to start')

		await portfolio.prepare(1_000n * unit, underwritingLimitAttoEth)
		await portfolio.mint(openInterestAmount, fixture.questionId, { sender: client })

		const vaultRepBeforeResolution = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), portfolio.capitalLedger)
		const shareSupplyBeforeResolution = await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool)
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
				functionName: 'getUniverseTheoreticalSupplyAttoRep',
				args: [genesisUniverse],
			}),
			trackedSupplyForOneRepThreshold,
			'the liveness PoC must isolate a 40 REP tracked-supply boundary',
		)
		assert.strictEqual(await readNonDecisionThreshold(), reportBond, 'the live non-decision threshold must equal the 1 REP start bond')
		// A newly deployed pool must use the same reduced live supply for its bond,
		// so the tracked threshold remains safely above that pool's start bond.
		const fresh = await portfolio.deployPortfolio()
		await portfolio.register(fixture.questionId, fresh)

		await mockWindow.setTime(questionData.endTime + 1n)
		await portfolio.refreshPrice()
		assert.strictEqual(await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool), zeroAddress, 'the first-deposit path must begin without a game')

		await approveToken(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'depositWalletRepToEscalationGame', args: [1, reportBond] }))
		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		assert.notStrictEqual(escalationGame, zeroAddress, 'the pool must deploy a live escalation game')
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDepositAttoRep',
				args: [],
			}),
			reportBond,
			'the immutable configured bond must remain unchanged',
		)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'startBondAttoRep',
				args: [],
			}),
			reportBond - 1n,
			'the live game bond must be reduced only enough to remain below the threshold',
		)
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'nonDecisionThresholdAttoRep',
				args: [],
			}),
			reportBond,
			'the game must preserve the live non-decision threshold',
		)
		const escalationEndTime = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
			args: [],
		})
		await mockWindow.setTime(escalationEndTime + 1n)
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await redeemShares(client, securityPoolAddresses.securityPool)
		await portfolio.refreshPrice()
		await portfolio.authorize(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: portfolio.capitalLedger, functionName: 'withdrawPrincipal', args: [vaultRepBeforeResolution, client.account.address] }))

		assert.strictEqual(await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool), 0n, 'resolved open interest must be fully redeemable')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(genesisUniverse), portfolio.capitalLedger), 0n, 'the funded owner principal must be fully redeemable')
	})
})
