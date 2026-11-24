import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '../../abi/abis'
import {
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { approveToken, getERC20Balance, overrideGenesisTheoreticalSupply } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { useSecurityPoolFixture } from './securityPoolFixture'

// A game fixes its non-decision threshold N when it starts, while the genesis fork threshold follows the
// live external REP supply. Non-decision leaves exactly 2N in escrow, so any later supply growth leaves
// the own-question fork short of admission REP; the trigger caller pays that shortfall.
describe('own-question fork admission after genesis supply growth', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const pool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
	const zoltar = () => ({ abi: zoltarArtifact.abi, address: getZoltarAddress() })
	const universe = () => fixture.base.genesisUniverse
	const repToken = () => getRepTokenAddress(universe())

	const reachNonDecisionAfterGrowth = async (growth: bigint) => {
		const owner = fixture.owner()
		const other = fixture.other()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		// The fixture token sits at the 11M REP cap; start from a lower external supply so it can grow.
		const fixtureSupply = await getTotalTheoreticalSupply(owner, repToken())
		await overrideGenesisTheoreticalSupply(fixture.base.mockWindow, owner, addressString(GENESIS_REPUTATION_TOKEN), fixtureSupply - 1000n * 10n ** 18n)
		const nonDecision = await owner.readContract({ ...zoltar(), functionName: 'getNonDecisionThresholdAttoRep', args: [universe()] })
		for (const sender of [owner, other]) await approveToken(sender, repToken(), pool())
		// The first deposit starts the game and fixes its non-decision threshold.
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, nonDecision / 3n + 1n] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'nonDecisionThresholdAttoRep' })).toBe(nonDecision)
		// The external genesis REP mints a little supply (REP Yes: about 24 REP per day).
		const supply = await getTotalTheoreticalSupply(owner, repToken())
		await overrideGenesisTheoreticalSupply(fixture.base.mockWindow, owner, addressString(GENESIS_REPUTATION_TOKEN), supply + growth)
		await writeContractAndWait(other, () => other.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, nonDecision - nonDecision / 3n - 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [2, nonDecision] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'canTriggerOwnFork' })).toBe(true)
		const ledger = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'reporterLedger', args: [universe()] })
		const escrow = await owner.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'balanceOfGame', args: [game] })
		expect(escrow).toBe(2n * nonDecision)
		const threshold = await owner.readContract({ ...zoltar(), functionName: 'getForkThresholdAttoRep', args: [universe()] })
		return { game, ledger, escrow, threshold }
	}

	const approveExactly = (client: WriteClient, spender: Address, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: ABIS.mainnet.erc20, address: repToken(), functionName: 'approve', args: [spender, amount] }))

	test.each([40n, 24n * 10n ** 18n])('a caller who pays the shortfall forks after %d attoREP of supply growth', async growth => {
		const payer = fixture.other()
		const { ledger, escrow, threshold } = await reachNonDecisionAfterGrowth(growth)
		const shortfall = threshold - escrow
		expect(shortfall).toBeGreaterThan(0n)
		await approveExactly(payer, ledger, shortfall)
		const payerBefore = await getERC20Balance(payer, repToken(), payer.account.address)
		await writeContractAndWait(payer, () => payer.writeContract({ ...forker(), functionName: 'forkZoltarWithOwnEscalationGame', args: [pool()] }))
		expect(await payer.readContract({ ...zoltar(), functionName: 'getForkTime', args: [universe()] })).not.toBe(0n)
		expect(payerBefore - (await getERC20Balance(payer, repToken(), payer.account.address))).toBe(shortfall)
		// The donation joins the question's escrow: the full live threshold is admitted and only its haircut is lost.
		const burnDivisor = await payer.readContract({ ...zoltar(), functionName: 'forkBurnDivisor' })
		const [state] = await payer.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'question', args: [universe(), fixture.base.questionId] })
		expect(state.balanceAttoRep).toBe(threshold - threshold / burnDivisor)
		expect(state.winnerHaircutPaidByFork).toBe(true)
		expect(await payer.readContract({ ...zoltar(), functionName: 'getMigrationRepBalanceAttoRep', args: [ledger, universe()] })).toBe(threshold - threshold / burnDivisor)
	})

	test('reports the shortfall and spender, and refuses a caller who has not approved it', async () => {
		const payer = fixture.other()
		const { ledger, escrow, threshold } = await reachNonDecisionAfterGrowth(40n)
		const [spender, shortfall] = await payer.readContract({ ...forker(), functionName: 'getOwnForkAdmissionShortfall', args: [pool()] })
		expect(spender).toBe(ledger)
		expect(shortfall).toBe(threshold - escrow)
		await approveExactly(payer, ledger, threshold - escrow - 1n)
		await expect(payer.writeContract({ ...forker(), functionName: 'forkZoltarWithOwnEscalationGame', args: [pool()] })).rejects.toThrow()
		expect(await payer.readContract({ ...zoltar(), functionName: 'getForkTime', args: [universe()] })).toBe(0n)
	})

	test('needs no payment when the supply has not grown', async () => {
		const payer = fixture.other()
		const { ledger } = await reachNonDecisionAfterGrowth(0n)
		const [spender, shortfall] = await payer.readContract({ ...forker(), functionName: 'getOwnForkAdmissionShortfall', args: [pool()] })
		expect(spender).toBe(ledger)
		expect(shortfall).toBe(0n)
		const payerBefore = await getERC20Balance(payer, repToken(), payer.account.address)
		await writeContractAndWait(payer, () => payer.writeContract({ ...forker(), functionName: 'forkZoltarWithOwnEscalationGame', args: [pool()] }))
		expect(await payer.readContract({ ...zoltar(), functionName: 'getForkTime', args: [universe()] })).not.toBe(0n)
		expect(await getERC20Balance(payer, repToken(), payer.account.address)).toBe(payerBefore)
	})
})
