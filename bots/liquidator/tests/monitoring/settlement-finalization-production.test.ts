import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, securityPoolAbi, securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { scanSettlementFinalizations } from '../../src/monitoring/settlement-finalization.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'

describe('portfolio settlement finalization keeper', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test('only selects funded claims past the strict deadline and releases demand permissionlessly', async () => {
		const owner = fixture.owner()
		const keeper = fixture.other()
		const { genesisUniverse, mockWindow, questionData, questionId } = fixture.base
		const pool = fixture.poolFor(questionId).securityPool
		const scan = async (minimum: bigint) => {
			const matches = []
			for await (const candidate of scanSettlementFinalizations(keeper, fixture.portfolio, minimum)) matches.push(candidate)
			return matches
		}
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(20n * unit, fixture.secondQuestionId)
		expect(await scan(1n)).toEqual([])
		await approveToken(owner, getRepTokenAddress(genesisUniverse), pool)
		await mockWindow.setTime(questionData.endTime + 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ address: pool, abi: securityPoolAbi, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await owner.readContract({ address: pool, abi: securityPoolAbi, functionName: 'escalationGame' })
		const deadline = await owner.readContract({ address: game, abi: escalationGameAbi, functionName: 'getEscalationGameEndDate' })
		await mockWindow.setTime(deadline)
		expect(await scan(1n)).toEqual([])
		await mockWindow.setTime(deadline + 1n)
		expect(await scan(10n * unit + 1n)).toEqual([])
		expect(await scan(10n * unit)).toEqual([{ pool, universeId: genesisUniverse, questionId, cash: 10n * unit }])
		const capital = { abi: securityPoolCapitalLedgerAbi, address: fixture.capitalLedger, functionName: 'demandAttoEth' as const }
		expect(await keeper.readContract(capital)).toBe(30n * unit)
		const privateKey = `0x${'03'.repeat(32)}` as const
		const account = privateKeyToAccount(privateKey)
		await mockWindow.setBalance(account.address, unit)
		const settings = portfolioSettings()
		const scope = { address: fixture.portfolio, universeId: genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		const rpc = await serveMockChainRpc(mockWindow, settings, account.address, scope)
		try {
			const script = fileURLToPath(new URL('../../src/cli/finalize-settlement.ts', import.meta.url))
			const chainId = await keeper.getChainId()
			const run = async (maximumGas: string) => {
				const process = Bun.spawn([Bun.argv[0] ?? 'bun', script], {
					env: {
						SETTLEMENT_RPC_URL: settings.connectivity.readRpcUrl,
						SETTLEMENT_CHAIN_ID: String(chainId),
						SETTLEMENT_PORTFOLIO: fixture.portfolio,
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
				if (status !== 0) throw new Error(`Settlement keeper exited with ${status}: ${errors}`)
				return output
			}
			expect(await run('1')).not.toContain('Submitted settlement finalization')
			expect(await keeper.readContract(capital)).toBe(30n * unit)
			expect(await run('2000000')).toContain('Submitted settlement finalization')
			expect(await keeper.readContract(capital)).toBe(20n * unit)
			expect(await scan(1n)).toEqual([])
		} finally {
			await rpc.stop()
		}
	})
})
