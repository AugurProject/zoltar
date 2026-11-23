import { formatStorageSlot } from '../testSupport/storage'
import { REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT } from '@zoltar/zoltar-shared/constants'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../types/contractArtifact'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getQuestionLedgersEscalationGame, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/questionLedger'
import { getQuestionOutcome } from '../testSupport/simulator/utils/contracts/questionForker'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'
import { getSettlementCollateralAttoEth, redeemShares } from '../testSupport/simulator/utils/contracts/questionLedger'
import { statoblast_EscalationGame_EscalationGame, statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier, statoblast_QuestionLedger_QuestionLedger, Zoltar_Zoltar } from '../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { getTotalPoolHeldAttoRep } from '../testSupport/simulator/utils/contracts/questionLedger'

const ESCALATION_TIME_LENGTH = 4_233_600n

describe('Audit PoC: escalation logarithm precision liveness', () => {
	const securityPool = useSecurityPoolFixture()
	const fixture = securityPool.base

	const reportBond = 11n * 10n ** 17n
	const depositToEscalationGame = async (client: typeof fixture.client, pool: `0x${string}`, outcome: QuestionOutcome, amount: bigint) => {
		await approveToken(client, getRepTokenAddress(fixture.genesisUniverse), pool)
		return writeContractAndWait(client, () => client.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	}

	test('wallet-funded reports resolve and unlock after burning supply to a zero-log threshold ratio', async () => {
		const { client, genesisUniverse, mockWindow, questionData } = fixture
		const questionLedgerAddresses = securityPool.poolFor(fixture.questionId)
		const pool = questionLedgerAddresses.questionLedger
		const token = getRepTokenAddress(genesisUniverse)
		const zoltar = getZoltarAddress()
		assert.strictEqual(await getTotalPoolHeldAttoRep(client, pool), 0n, 'wallet reporting must not depend on vault backing or its immutable minimum')
		const readTrackedSupply = () => client.readContract({ abi: Zoltar_Zoltar.abi, address: zoltar, functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [genesisUniverse] })
		for (const account of TEST_ADDRESSES.slice(1)) {
			const burner = createWriteClient(mockWindow, account)
			const balance = await getERC20Balance(client, token, burner.account.address)
			await approveToken(burner, token, zoltar)
			await writeContractAndWait(burner, () => burner.writeContract({ abi: Zoltar_Zoltar.abi, address: zoltar, functionName: 'burnRep', args: [genesisUniverse, balance] }))
		}
		const threshold = reportBond + 10n ** 12n
		const targetSupply = 2n * threshold * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const finalBurn = (await readTrackedSupply()) - targetSupply
		await approveToken(client, token, zoltar)
		await writeContractAndWait(client, () => client.writeContract({ abi: Zoltar_Zoltar.abi, address: zoltar, functionName: 'burnRep', args: [genesisUniverse, finalBurn] }))
		assert.strictEqual(await readTrackedSupply(), targetSupply, 'public burns must reach the narrow threshold without overriding tracked supply')
		assert.strictEqual(await client.readContract({ abi: Zoltar_Zoltar.abi, address: zoltar, functionName: 'getNonDecisionThresholdAttoRep', args: [genesisUniverse] }), threshold)
		assert.strictEqual(
			await client.readContract({ abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi, address: getInfraContractAddresses().escalationGameProofVerifier, functionName: 'computeLnRatioScaled', args: [reportBond, threshold] }),
			0n,
			'the real verifier must round the positive threshold ratio to zero',
		)

		await mockWindow.setTime(questionData.endTime + 1n)
		await approveToken(client, token, pool)
		for (const [outcome, amount] of [
			[QuestionOutcome.Yes, reportBond + 2n],
			[QuestionOutcome.No, reportBond + 1n],
		] as const) {
			await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		}
		const game = await getQuestionLedgersEscalationGame(client, pool)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getBindingCapitalAttoRep' }), reportBond + 1n, 'both successful deposits must leave binding capital strictly between the bond and threshold')
		const activationTime = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'activationTime' })
		const deadline = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getEscalationGameEndDate' })
		assert.strictEqual(deadline, activationTime + ESCALATION_TIME_LENGTH - 1n, 'the flat rounded curve stays unresolved until its terminal jump')
		await mockWindow.setTime(deadline)
		assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.None, 'the exact deadline must remain unresolved')
		await assert.rejects(client.simulateContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.Yes, [0n]] }), /Question not final/)
		await mockWindow.setTime(deadline + 1n)
		assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.Yes, 'the strict leader must finalize after the terminal deadline')
		const walletBeforeClaim = await getERC20Balance(client, token, client.account.address)
		await withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [0n])
		assert.ok((await getERC20Balance(client, token, client.account.address)) - walletBeforeClaim > reportBond + 2n, 'the winning deposit must unlock its principal and reward')
		await withdrawFromEscalationGame(client, pool, QuestionOutcome.No, [0n])
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'totalDisputeStakedAttoRep' }), 0n, 'both reports must leave logical escrow fully settled')
	})

	test('a funded game with a power-of-two threshold ratio resolves and releases its assets', async () => {
		const { client, genesisUniverse, mockWindow, questionData } = fixture
		const questionLedgerAddresses = securityPool.poolFor(fixture.questionId)
		const underwritingLimitAttoEth = 25n * 10n ** 18n
		await securityPool.prepare(1_000n * unit, underwritingLimitAttoEth)
		await securityPool.mint(unit, fixture.questionId, { sender: client })
		assert.ok((await getSettlementCollateralAttoEth(client, questionLedgerAddresses.questionLedger)) > 0n, 'PoC pool must hold redeemable ETH collateral')

		const nonDecisionThresholdAttoRep = reportBond * 2n
		const trackedSupply = 2n * nonDecisionThresholdAttoRep * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const genesisSupplySlot = formatStorageSlot(REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT)
		await mockWindow.addStateOverrides({
			[getRepTokenAddress(genesisUniverse)]: {
				stateDiff: {
					[genesisSupplySlot]: trackedSupply,
				},
			},
		})

		await mockWindow.setTime(questionData.endTime + 1n)
		await securityPool.refreshPrice()
		await depositToEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.Yes, reportBond + 2n)
		await depositToEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.No, reportBond + 1n)

		const escalationGame = await getQuestionLedgersEscalationGame(client, questionLedgerAddresses.questionLedger)
		const activationTime = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'activationTime',
		})
		await mockWindow.setTime(activationTime + ESCALATION_TIME_LENGTH + 1n)

		assert.strictEqual(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'getQuestionResolution',
			}),
			BigInt(QuestionOutcome.Yes),
			'the balance comparison itself should have a strict winner',
		)
		const escalationEndDate = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'getEscalationGameEndDate',
		})
		assert.ok(escalationEndDate < activationTime + ESCALATION_TIME_LENGTH, 'strict winner should end the game before the maximum escalation duration')
		assert.strictEqual(await getQuestionOutcome(client, questionLedgerAddresses.questionLedger), QuestionOutcome.Yes, 'pool should expose the strict winner after the computed deadline')
		await assert.rejects(depositToEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.No, reportBond), /Invalid deposit preview/)
		await withdrawFromEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.Yes, [0n])
		await withdrawFromEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.No, [0n])
		await redeemShares(client, questionLedgerAddresses.questionLedger)
		await securityPool.refreshPrice()
		await securityPool.authorize(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: securityPool.capitalLedger, functionName: 'withdrawPrincipal', args: [1_000n * unit, client.account.address] }))
	})
})
