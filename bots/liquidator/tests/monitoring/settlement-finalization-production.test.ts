import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, questionLedgerAbi, securityPoolCapitalLedgerAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { DAY } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact } from '../../../../solidity/ts/types/contractArtifact'
import { getRepTokenAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { finalizationRequest, scanSettlementFinalizations } from '../../src/monitoring/settlement-finalization.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'
import { securityPoolSettings } from '../support/security-pool-observation.ts'

describe('security pool settlement finalizer', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	test('#1451 discovers an inherited mature claim before its child pool is deployed', async () => {
		const owner = fixture.owner()
		const finalizer = fixture.other()
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(20n * unit, fixture.secondQuestionId)
		const { child, forks, forkTime } = await fixture.forkAndStartYesBranch()
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ address: forks, abi: forkArtifact.abi, functionName: 'finalizeBranch', args: [child] }))
		const [, activatedAt] = await owner.readContract({ address: forks, abi: forkArtifact.abi, functionName: 'clocks', args: [child] })
		let rejectedRanges = 0
		const limitedFinalizer: Pick<typeof finalizer, 'getBlock' | 'readContract' | 'getLogs'> = {
			getBlock: finalizer.getBlock,
			readContract: finalizer.readContract,
			getLogs: parameters => {
				const { fromBlock, toBlock } = parameters ?? {}
				if (typeof fromBlock === 'bigint' && typeof toBlock === 'bigint' && toBlock - fromBlock >= 5n) {
					rejectedRanges++
					throw new Error('Block range limit is 5 blocks')
				}
				return finalizer.getLogs(parameters)
			},
		}
		const scan = async (minimum: bigint) => {
			const matches = []
			for await (const candidate of scanSettlementFinalizations(limitedFinalizer, fixture.securityPool, minimum)) matches.push(candidate)
			return matches.filter(candidate => candidate.universeId === child)
		}
		expect(await scan(1n)).toEqual([])
		await fixture.base.mockWindow.setTime(activatedAt + 3n * DAY)
		expect(await scan(1n)).toEqual([])
		await fixture.base.mockWindow.setTime(activatedAt + 3n * DAY + 1n)
		await expect(owner.readContract({ address: fixture.securityPool, abi: securityPoolAbi, functionName: 'getQuestionLedger', args: [fixture.base.questionId, child] })).rejects.toThrow('Question pool unavailable')
		const candidates = await scan(1n)
		expect(candidates).toHaveLength(1)
		expect(rejectedRanges).toBeGreaterThan(0)
		expect(candidates[0]?.questionId).toBe(fixture.base.questionId)
		expect(candidates[0]?.cash).toBe(10n * unit)
		expect(await scan(10n * unit + 1n)).toEqual([])
		const candidate = candidates[0]
		if (candidate === undefined) throw new Error('Missing inherited finalization candidate')
		const capitalLedger = await owner.readContract({ address: fixture.securityPool, abi: securityPoolAbi, functionName: 'capitalLedger', args: [child] })
		const demand = () => finalizer.readContract({ address: capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'demandAttoEth' })
		const before = await demand()
		await writeContractAndWait(finalizer, () => finalizer.writeContract(finalizationRequest(candidate)))
		expect(await demand()).toBe(before - 10n * unit)
		expect(await scan(1n)).toEqual([])
		await writeContractAndWait(finalizer, () => finalizer.writeContract(finalizationRequest(candidate)))
		expect(await demand()).toBe(before - 10n * unit)
	})

	test('only selects funded claims past the strict deadline and releases demand permissionlessly', async () => {
		const owner = fixture.owner()
		const finalizer = fixture.other()
		const { genesisUniverse, mockWindow, questionData, questionId } = fixture.base
		const pool = fixture.poolFor(questionId).questionLedger
		const scan = async (minimum: bigint) => {
			const matches = []
			for await (const candidate of scanSettlementFinalizations(finalizer, fixture.securityPool, minimum)) matches.push(candidate)
			return matches
		}
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(20n * unit, fixture.secondQuestionId)
		expect(await scan(1n)).toEqual([])
		await approveToken(owner, getRepTokenAddress(genesisUniverse), pool)
		await mockWindow.setTime(questionData.endTime + 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ address: pool, abi: questionLedgerAbi, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await owner.readContract({ address: pool, abi: questionLedgerAbi, functionName: 'escalationGame' })
		const deadline = await owner.readContract({ address: game, abi: escalationGameAbi, functionName: 'getEscalationGameEndDate' })
		await mockWindow.setTime(deadline)
		expect(await scan(1n)).toEqual([])
		await mockWindow.setTime(deadline + 1n)
		expect(await scan(10n * unit + 1n)).toEqual([])
		const settlement = await owner.readContract({ address: fixture.securityPool, abi: securityPoolAbi, functionName: 'settlement' })
		expect(await scan(10n * unit)).toEqual([{ settlement, universeId: genesisUniverse, questionId, cash: 10n * unit }])
		const capital = { abi: securityPoolCapitalLedgerAbi, address: fixture.capitalLedger, functionName: 'demandAttoEth' as const }
		expect(await finalizer.readContract(capital)).toBe(30n * unit)
		const privateKey = `0x${'03'.repeat(32)}` as const
		const account = privateKeyToAccount(privateKey)
		await mockWindow.setBalance(account.address, unit)
		const settings = securityPoolSettings()
		const scope = { address: fixture.securityPool, universeId: genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		const rpc = await serveMockChainRpc(mockWindow, settings, account.address, scope)
		try {
			const script = fileURLToPath(new URL('../../src/cli/finalize-settlement.ts', import.meta.url))
			const chainId = await finalizer.getChainId()
			const run = async (maximumGas: string) => {
				const process = Bun.spawn([Bun.argv[0] ?? 'bun', script], {
					env: {
						SETTLEMENT_RPC_URL: settings.connectivity.readRpcUrl,
						SETTLEMENT_CHAIN_ID: String(chainId),
						SETTLEMENT_SECURITY_POOL: fixture.securityPool,
						SETTLEMENT_MINIMUM_CASH: String(unit),
						SETTLEMENT_PRIVATE_KEY: privateKey,
						SETTLEMENT_MAX_TRANSACTIONS: '1',
						SETTLEMENT_MAX_GAS: maximumGas,
						SETTLEMENT_MAX_GAS_PRICE: String(unit),
					},
					stdout: 'pipe',
					stderr: 'pipe',
				})
				const [status, output, errors] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()])
				if (status !== 0) throw new Error(`Settlement finalizer exited with ${status}: ${errors}`)
				return output
			}
			expect(await run('1')).not.toContain('Submitted settlement finalization')
			expect(await finalizer.readContract(capital)).toBe(30n * unit)
			expect(await run('2000000')).toContain('Submitted settlement finalization')
			expect(await finalizer.readContract(capital)).toBe(20n * unit)
			expect(await scan(1n)).toEqual([])
		} finally {
			await rpc.stop()
		}
	})
})
