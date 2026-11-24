import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance, overrideGenesisTheoreticalSupply } from '../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../types/contractArtifact'
import { statoblast_EscalationGame_EscalationGame } from '../types/contractArtifact'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getQuestionLedgersEscalationGame, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/questionLedger'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { balanceOfShares } from '../testSupport/simulator/utils/contracts/statoblast'
import { getShareTokenSupplyAttoShares, redeemShares } from '../testSupport/simulator/utils/contracts/questionLedger'
import { statoblast_QuestionLedger_QuestionLedger, Zoltar_Zoltar } from '../types/contractArtifact'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

describe('Audit regression: escalation start configuration liveness', () => {
	const securityPool = useSecurityPoolFixture()
	const fixture = securityPool.base
	const reportBond = 11n * 10n ** 17n

	test('an existing funded pool remains resolvable when the tracked threshold falls to the configured start bond', async () => {
		const { client, genesisUniverse, mockWindow, questionData, statoblastSecurityMultiplierBps } = fixture
		const questionLedgerAddresses = securityPool.poolFor(fixture.questionId)
		const openInterestAmount = 1n * 10n ** 18n
		const underwritingLimitAttoEth = 25n * 10n ** 18n
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
				abi: statoblast_QuestionLedger_QuestionLedger.abi,
				address: questionLedgerAddresses.questionLedger,
				functionName: 'initialEscalationGameDepositAttoRep',
				args: [],
			}),
			reportBond,
			'the canonical pool must apply the supply-based escalation bond floor',
		)
		assert.ok(reportBond > 10n ** 18n, 'the supply-based floor must exceed the one-REP minimum in this fixture')
		assert.ok((await readNonDecisionThreshold()) > reportBond, 'the unmodified production configuration must allow the game to start')

		await securityPool.prepare(1_000n * unit, underwritingLimitAttoEth)
		await securityPool.mint(openInterestAmount, fixture.questionId, { sender: client })

		const vaultRepBeforeResolution = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPool.capitalLedger)
		const shareSupplyBeforeResolution = await getShareTokenSupplyAttoShares(client, questionLedgerAddresses.questionLedger)
		const holderSharesBeforeResolution = await balanceOfShares(client, questionLedgerAddresses.shareToken, genesisUniverse, client.account.address)
		assert.ok(vaultRepBeforeResolution > reportBond, 'the vault REP redemption must represent a funded claim')
		assert.ok(shareSupplyBeforeResolution > 0n, 'the pool must have open-interest liabilities before escalation starts')
		assert.ok(
			holderSharesBeforeResolution.every(balance => balance > 0n),
			'the share redemption must represent funded outcome balances',
		)

		// Change only the external genesis token's theoretical supply: token balances, canonical factory wiring,
		// vault accounting, and the real complete-set liabilities remain untouched.
		const trackedSupplyForOneRepThreshold = 2n * reportBond * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		await overrideGenesisTheoreticalSupply(mockWindow, client, getRepTokenAddress(genesisUniverse), trackedSupplyForOneRepThreshold)
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
		const fresh = await securityPool.deploySecurityPool()
		await securityPool.register(fixture.questionId, fresh)

		await mockWindow.setTime(questionData.endTime + 1n)
		await securityPool.refreshPrice()
		assert.strictEqual(await getQuestionLedgersEscalationGame(client, questionLedgerAddresses.questionLedger), zeroAddress, 'the first-deposit path must begin without a game')

		await approveToken(client, getRepTokenAddress(genesisUniverse), questionLedgerAddresses.questionLedger)
		await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddresses.questionLedger, functionName: 'depositWalletRepToEscalationGame', args: [1, reportBond] }))
		const escalationGame = await getQuestionLedgersEscalationGame(client, questionLedgerAddresses.questionLedger)
		assert.notStrictEqual(escalationGame, zeroAddress, 'the pool must deploy a live escalation game')
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_QuestionLedger_QuestionLedger.abi,
				address: questionLedgerAddresses.questionLedger,
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
		await withdrawFromEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.Yes, [0n])
		await redeemShares(client, questionLedgerAddresses.questionLedger)
		await securityPool.refreshPrice()
		await securityPool.authorize(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: securityPool.capitalLedger, functionName: 'withdrawPrincipal', args: [vaultRepBeforeResolution, client.account.address] }))

		assert.strictEqual(await getShareTokenSupplyAttoShares(client, questionLedgerAddresses.questionLedger), 0n, 'resolved open interest must be fully redeemable')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPool.capitalLedger), 0n, 'the funded owner principal must be fully redeemable')
	})
})
