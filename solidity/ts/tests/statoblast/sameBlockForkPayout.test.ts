import { describe, test } from 'bun:test'
import { encodeFunctionData, isHex, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool, statoblast_SecurityPoolForker_SecurityPoolForker, Zoltar_Zoltar } from '../../types/contractArtifact'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getNonDecisionThresholdAttoRep } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getSecurityPoolsEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { claimForkedEscalationDeposits, createChildUniverse, forkZoltarWithOwnEscalationGame, migrateRepToZoltar } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getRepTokenAddress, getUniverseData, getZoltarAddress, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { useStatoblastDeploymentAndOwnForkEscalationFixture } from './fixture'

function requireTransactionHash(value: unknown): Hash {
	if (typeof value !== 'string' || !isHex(value, { strict: true }) || value.length !== 66) throw new Error('Anvil returned an invalid transaction hash')
	return `0x${value.slice(2)}`
}

describe('Statoblast: own-fork payouts after same-block completion', () => {
	const fixture = useStatoblastDeploymentAndOwnForkEscalationFixture()
	const scenarios = [
		{ sameBlock: false, migrationDivisor: 1n, label: 'next-block fork preserves the funded payout after full REP migration' },
		{ sameBlock: true, migrationDivisor: 0n, label: 'same-block fork preserves the funded payout without later REP migration' },
		{ sameBlock: true, migrationDivisor: 2n, label: 'same-block fork preserves the funded payout after partial REP migration' },
		{ sameBlock: true, migrationDivisor: 1n, label: 'same-block fork preserves the funded payout after full REP migration' },
	]

	for (const scenario of scenarios) {
		test(scenario.label, async () => {
			const { client, mockWindow, securityPoolAddresses, questionEndDate, genesisUniverse } = fixture
			const securityPool = securityPoolAddresses.securityPool
			const securityPoolForker = getInfraContractAddresses().securityPoolForker
			const parentRep = getRepTokenAddress(genesisUniverse)
			const depositAttoRep = 275_000n * 10n ** 18n
			await approveToken(client, parentRep, securityPool)
			await mockWindow.setTime(questionEndDate + 1n)
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: securityPool,
					functionName: 'depositWalletRepToEscalationGame',
					args: [QuestionOutcome.Yes, depositAttoRep],
				}),
			)

			if (scenario.sameBlock) {
				await mockWindow.requestRaw({ method: 'evm_setNextBlockTimestamp', params: [`0x${((await mockWindow.getTime()) + 1n).toString(16)}`] })
				await mockWindow.requestRaw({ method: 'anvil_setAutomine', params: [false] })
				// Each transaction requests 8 million gas so both fit within one block's gas limit.
				try {
					const depositHash = requireTransactionHash(
						await mockWindow.requestRaw({
							method: 'eth_sendTransaction',
							params: [
								{
									from: client.account.address,
									to: securityPool,
									gas: '0x7a1200',
									gasPrice: '0x0',
									data: encodeFunctionData({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.No, depositAttoRep] }),
								},
							],
						}),
					)
					const forkHash = requireTransactionHash(
						await mockWindow.requestRaw({
							method: 'eth_sendTransaction',
							params: [
								{
									from: client.account.address,
									to: securityPoolForker,
									gas: '0x7a1200',
									gasPrice: '0x0',
									data: encodeFunctionData({ abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, functionName: 'forkZoltarWithOwnEscalationGame', args: [securityPool] }),
								},
							],
						}),
					)
					await mockWindow.requestRaw({ method: 'evm_mine', params: [] })
					const depositReceipt = await client.getTransactionReceipt({ hash: depositHash })
					const forkReceipt = await client.getTransactionReceipt({ hash: forkHash })
					assert.strictEqual(depositReceipt.status, 'success', 'the completing deposit must succeed')
					assert.strictEqual(forkReceipt.status, 'success', 'the own-fork transaction must succeed')
					assert.strictEqual(depositReceipt.blockHash, forkReceipt.blockHash, 'the completing deposit and own fork must share one block')
				} finally {
					await mockWindow.requestRaw({ method: 'anvil_setAutomine', params: [true] })
				}
			} else {
				await writeContractAndWait(client, () =>
					client.writeContract({
						abi: statoblast_SecurityPool_SecurityPool.abi,
						address: securityPool,
						functionName: 'depositWalletRepToEscalationGame',
						args: [QuestionOutcome.No, depositAttoRep],
					}),
				)
				await forkZoltarWithOwnEscalationGame(client, securityPool)
			}

			const escalationGame = await getSecurityPoolsEscalationGame(client, securityPool)
			const escalationEndDate = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'getEscalationGameEndDate' })
			const { forkTime } = await getUniverseData(client, genesisUniverse)
			assert.strictEqual(forkTime === escalationEndDate, scenario.sameBlock, 'only the same-block fork should coincide with escalation completion')
			await createChildUniverse(client, securityPool, QuestionOutcome.Yes)

			if (scenario.migrationDivisor > 0n) {
				await migrateRepToZoltar(client, securityPool, [QuestionOutcome.Yes])
				for (const account of TEST_ADDRESSES) {
					const owner = createWriteClient(mockWindow, account)
					const balance = await getERC20Balance(owner, parentRep, owner.account.address)
					const amountAttoRep = balance / scenario.migrationDivisor
					if (amountAttoRep === 0n) continue
					await approveToken(owner, parentRep, getZoltarAddress())
					await writeContractAndWait(owner, () =>
						owner.writeContract({
							abi: Zoltar_Zoltar.abi,
							address: getZoltarAddress(),
							functionName: 'addRepToMigrationBalance',
							args: [genesisUniverse, amountAttoRep],
						}),
					)
				}
			}

			const liveForkThresholdAttoRep = await getZoltarForkThreshold(client, genesisUniverse)
			const nonDecisionThresholdAttoRep = await getNonDecisionThresholdAttoRep(client, escalationGame)
			if (scenario.migrationDivisor === 0n) {
				assert.ok(liveForkThresholdAttoRep >= nonDecisionThresholdAttoRep, 'the unmigrated control must retain a live threshold at least as large as the non-decision threshold')
			} else if (scenario.migrationDivisor === 1n) {
				assert.strictEqual(liveForkThresholdAttoRep, 0n, 'full REP migration must reduce the live fork threshold to zero')
			} else {
				assert.ok(liveForkThresholdAttoRep > 0n && liveForkThresholdAttoRep < nonDecisionThresholdAttoRep, 'partial REP migration must leave a positive live threshold below the non-decision threshold')
			}

			const childRep = getRepTokenAddress(getChildUniverseId(genesisUniverse, QuestionOutcome.Yes))
			const balanceBeforeClaim = await getERC20Balance(client, childRep, client.account.address)
			await claimForkedEscalationDeposits(client, securityPool, client.account.address, QuestionOutcome.Yes, [0n])
			const balanceAfterClaim = await getERC20Balance(client, childRep, client.account.address)
			const claimed = await client.readContract({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				address: securityPoolForker,
				functionName: 'isEscalationDepositClaimedDirectly',
				args: [securityPool, QuestionOutcome.Yes, 0n],
			})
			assert.strictEqual(claimed, true, 'the direct claim must be recorded')
			assert.strictEqual(balanceAfterClaim - balanceBeforeClaim, 440_000n * 10n ** 18n, 'ordinary REP migration must not reduce the already funded child payout')
			await assert.rejects(claimForkedEscalationDeposits(client, securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
			assert.strictEqual(await getERC20Balance(client, childRep, client.account.address), balanceAfterClaim, 'replaying a claim must not transfer additional child REP')
		})
	}
})
