import { describe, expect, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { getQuestionEndDate } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { depositToEscalationGame, getSecurityVault, redeemRepFromVault, withdrawFromEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { advancePastOrdinaryEscalationDeadline, depositOrdinaryEscalationPrincipals, ordinaryEscalationPrincipals, redeemOwnVaultPayout, sweepResidualRep } from '../residualCaptureHelpers'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool as poolArtifact, test_statoblast_SecurityPoolPositionReceiver_SecurityPoolPositionReceiver as receiverArtifact } from '../../types/contractArtifact'

describe('Statoblast: lazy ordinary settlement recovery', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const token = addressString(GENESIS_REPUTATION_TOKEN)
	const prepare = async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const reporter = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await approveAndDepositRepToVault(reporter, ordinaryEscalationPrincipals.totalPrincipal, questionId)
		await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 1n)
		await depositOrdinaryEscalationPrincipals(reporter, securityPoolAddresses.securityPool)
		const game = await advancePastOrdinaryEscalationDeadline(client, mockWindow, securityPoolAddresses.securityPool)
		return { reporter, game, pool: securityPoolAddresses.securityPool }
	}

	test('releases only the surplus before any reporter claims, retaining every winner liability', async () => {
		const { client, repDeposit } = fixture
		const { reporter, game, pool } = await prepare()
		await sweepResidualRep(client, game)
		expect(await getERC20Balance(client, token, game)).toBe(500n * 10n ** 18n)
		expect(await redeemOwnVaultPayout(client, pool, token)).toBe(repDeposit + ordinaryEscalationPrincipals.lowLosingPrincipal)
		const before = await getERC20Balance(client, token, reporter.account.address)
		await withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [0n])
		expect((await getERC20Balance(client, token, reporter.account.address)) - before).toBe(420n * 10n ** 18n)
		expect(await getERC20Balance(client, token, game)).toBe(0n)
	})

	test('settles surplus inside passive vault redemption without any earlier sweep or reporter claim', async () => {
		const { client, repDeposit } = fixture
		const { game, pool } = await prepare()
		expect(await redeemOwnVaultPayout(client, pool, token)).toBe(repDeposit + ordinaryEscalationPrincipals.lowLosingPrincipal)
		expect(await getERC20Balance(client, token, game)).toBe(500n * 10n ** 18n)
	})

	test('retires a final backing fraction worth zero REP without stranding its units', async () => {
		const { client, mockWindow, repDeposit } = fixture
		const { pool } = await prepare()
		const receiver = await deployContract(client, encodeDeployData({ abi: receiverArtifact.abi, bytecode: `0x${receiverArtifact.evm.bytecode.object}`, args: [client.account.address, pool, client.account.address] }))
		const source = await getSecurityVault(client, pool, client.account.address)
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'splitVaultPosition', args: [receiver, 1n, source.repBackingUnits] }))
		expect((await getSecurityVault(client, pool, receiver)).repBackingUnits).toBe(1n)
		expect(await client.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'backingUnitsToAttoRep', args: [1n] })).toBe(0n)
		await mockWindow.impersonateAccount(receiver)
		await mockWindow.setBalance(receiver, 10n ** 18n)
		await redeemRepFromVault(createWriteClient(mockWindow, BigInt(receiver)), pool, receiver)
		expect((await getSecurityVault(client, pool, receiver)).repBackingUnits).toBe(0n)
		expect(await getERC20Balance(client, token, receiver)).toBe(0n)
		expect(await redeemOwnVaultPayout(client, pool, token)).toBe(repDeposit + ordinaryEscalationPrincipals.lowLosingPrincipal)
	})

	test('retires losing rights globally and keeps repeated zero-value settlement harmless', async () => {
		const { client } = fixture
		const { reporter, game, pool } = await prepare()
		await sweepResidualRep(client, game)
		const abi = statoblast_EscalationGame_EscalationGame.abi
		for (const outcome of [QuestionOutcome.Invalid, QuestionOutcome.No]) {
			expect(await client.readContract({ abi, address: game, functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome', args: [reporter.account.address, outcome] })).toBe(0n)
			expect((await client.readContract({ abi, address: game, functionName: 'getDepositsByOutcome', args: [outcome, 0n, 1n] }))[0]?.amountAttoRep).toBe(0n)
			const state = await client.readContract({ abi, address: game, functionName: 'getOutcomeState', args: [outcome] })
			expect(state.localUnresolvedTotalAttoRep).toBe(0n)
			expect(state.currentCarryTotalAttoRep).toBe(0n)
			await withdrawFromEscalationGame(client, pool, outcome, [0n])
			await withdrawFromEscalationGame(client, pool, outcome, [0n])
		}
		expect((await getSecurityVault(client, pool, reporter.account.address)).disputeStakedAttoRep).toBe(ordinaryEscalationPrincipals.winningPrincipal)
		expect(await getERC20Balance(client, token, game)).toBe(500n * 10n ** 18n)
	})

	test('split winner intervals exactly exhaust the reserved payouts and burns in reverse claim order', async () => {
		const { client, mockWindow, questionId, securityPoolAddresses } = fixture
		const pool = securityPoolAddresses.securityPool
		const reporter = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const unit = 10n ** 18n
		await approveAndDepositRepToVault(reporter, ordinaryEscalationPrincipals.totalPrincipal, questionId)
		await mockWindow.setTime((await getQuestionEndDate(client, questionId)) + 1n)
		await depositToEscalationGame(reporter, pool, QuestionOutcome.Invalid, 100n * unit)
		await depositToEscalationGame(reporter, pool, QuestionOutcome.No, 200n * unit)
		for (const amount of [10n * unit + 1n, 10n * unit + 1n, 10n * unit + 1n, 270n * unit - 3n]) {
			await depositToEscalationGame(reporter, pool, QuestionOutcome.Yes, amount)
		}
		const game = await advancePastOrdinaryEscalationDeadline(client, mockWindow, pool)
		await sweepResidualRep(client, game)
		const before = await getERC20Balance(client, token, reporter.account.address)
		for (const index of [3n, 2n, 1n, 0n]) await withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [index])
		expect((await getERC20Balance(client, token, reporter.account.address)) - before).toBe(420n * unit)
		expect(await getERC20Balance(client, token, game)).toBe(0n)
		expect(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'ordinaryWinningReserveAttoRep' })).toBe(0n)
		await expect(withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [0n])).rejects.toThrow('Deposit settled')
	})
})
