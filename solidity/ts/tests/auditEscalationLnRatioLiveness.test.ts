import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../types/contractArtifact'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityPoolsEscalationGame, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { getQuestionOutcome } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'
import { getSettlementCollateralAttoEth, redeemShares } from '../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_EscalationGame_EscalationGame, statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier, statoblast_SecurityPool_SecurityPool, Zoltar_Zoltar } from '../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { getTotalPoolHeldAttoRep } from '../testSupport/simulator/utils/contracts/securityPool'

const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n
const ESCALATION_TIME_LENGTH = 4_233_600n

describe('Audit PoC: escalation logarithm precision liveness', () => {
	const portfolio = useSecurityPoolPortfolioFixture()
	const fixture = portfolio.base

	const reportBond = 11n * 10n ** 17n
	const depositToEscalationGame = async (client: typeof fixture.client, pool: `0x${string}`, outcome: QuestionOutcome, amount: bigint) => {
		await approveToken(client, getRepTokenAddress(fixture.genesisUniverse), pool)
		return writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	}

	test('wallet-funded reports resolve and unlock after burning supply to a zero-log threshold ratio', async () => {
		const { client, genesisUniverse, mockWindow, questionData } = fixture
		const securityPoolAddresses = portfolio.poolFor(fixture.questionId)
		const pool = securityPoolAddresses.securityPool
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
			await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		}
		const game = await getSecurityPoolsEscalationGame(client, pool)
		assert.strictEqual(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getBindingCapitalAttoRep' }), reportBond + 1n, 'both successful deposits must leave binding capital strictly between the bond and threshold')
		const activationTime = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'activationTime' })
		const deadline = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getEscalationGameEndDate' })
		assert.strictEqual(deadline, activationTime + ESCALATION_TIME_LENGTH, 'the flat rounded curve reaches intermediate costs only at its terminal jump')
		await mockWindow.setTime(deadline)
		assert.strictEqual(await getQuestionOutcome(client, pool), QuestionOutcome.None, 'the exact deadline must remain unresolved')
		await assert.rejects(client.simulateContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [QuestionOutcome.Yes, [0n]] }), /Question not final/)
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
		const securityPoolAddresses = portfolio.poolFor(fixture.questionId)
		const underwritingLimitAttoEth = 25n * 10n ** 18n
		await portfolio.prepare(1_000n * unit, underwritingLimitAttoEth)
		await portfolio.mint(unit, fixture.questionId, { sender: client })
		assert.ok((await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)) > 0n, 'PoC pool must hold redeemable ETH collateral')

		const nonDecisionThresholdAttoRep = reportBond * 2n
		const trackedSupply = 2n * nonDecisionThresholdAttoRep * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: trackedSupply,
				},
			},
		})

		await mockWindow.setTime(questionData.endTime + 1n)
		await portfolio.refreshPrice()
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 2n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond + 1n)

		const escalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
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
		assert.strictEqual(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'pool should expose the strict winner after the computed deadline')
		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond), /Invalid deposit preview/)
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n])
		await redeemShares(client, securityPoolAddresses.securityPool)
		await portfolio.refreshPrice()
		await portfolio.authorize(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: portfolio.capitalLedger, functionName: 'withdrawPrincipal', args: [1_000n * unit, client.account.address] }))
	})
})
