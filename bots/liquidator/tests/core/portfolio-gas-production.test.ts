import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { capitalUnit as E, useCapitalTestFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolCapitalTestFixture'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { executePortfolioTakeover, type refreshPortfolioExecution } from '../../src/execution/portfolio-executor.ts'
import { submitCall } from '../../src/execution/liquidation-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings } from '../support/portfolio-observation.ts'

// The harness supplies book/price authority; Ledger, Index, signing, simulation,
// public submission and durable receipt settlement all run their real code.
// Factory authentication is covered separately by portfolio-production.test.ts.
describe('portfolio operator production gas execution', () => {
	const fixture = useCapitalTestFixture()
	test('a funded fragmented-book takeover estimates, signs and completes with its required upfront gas', async () => {
		const ethereum = fixture.getAnvilWindowEthereum()
		const sender = fixture.client()
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		const buyer = createWriteClient(ethereum, BigInt(account.address))
		await ethereum.impersonateAccount(account.address)
		await ethereum.setBalance(account.address, 10_000n * E)
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'beginImport' }))
		for (let start = 0; start < 64; start += 8) await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'importChoices', args: [BigInt(start), 8n, true], value: 16n * E }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'finishImport', args: [1280n * E] }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'mint', args: [account.address, 1000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.token, functionName: 'approve', args: [fixture.capital.address, 1000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.capital, functionName: 'depositAndSetHealthTarget', args: [100n * E, 15_000n] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.capital, functionName: 'fundExecutionReserve', args: [account.address], value: 100n * E }))
		for (let epoch = 0; epoch < 6; epoch++) {
			await fixture.price(epoch % 2 === 0 ? E : 4n * E + (64n * 10n ** 12n) / (21n * BigInt(epoch + 1)))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundFees', value: 64n * E }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundRepFees', args: [64n * E] }))
			await ethereum.advanceTime(18_000n)
		}
		await fixture.price(2n * E)
		await ethereum.advanceTime(18_000n)
		const directory = await mkdtemp(join(tmpdir(), 'portfolio-production-gas-'))
		const estimates: { block: unknown; gas: bigint }[] = []
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const body: unknown = await request.json()
				if (typeof body !== 'object' || body === null || !('method' in body) || typeof body.method !== 'string' || !('params' in body) || !Array.isArray(body.params) || !('id' in body)) throw new Error('Invalid local RPC request')
				try {
					const result = await ethereum.request({ method: body.method, params: body.params })
					if (body.method === 'eth_estimateGas') {
						if (typeof result !== 'string') throw new Error('Missing local gas estimate')
						estimates.push({ block: body.params[1], gas: BigInt(result) })
					}
					if (body.method === 'eth_sendRawTransaction') await ethereum.request({ method: 'anvil_mine', params: ['0xc'] })
					return Response.json({ jsonrpc: '2.0', id: body.id, result })
				} catch (error) {
					const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : -32000
					return Response.json({ jsonrpc: '2.0', id: body.id, error: { code, message: error instanceof Error ? error.message : String(error) } })
				}
			},
		})
		const settings = portfolioSettings()
		const endpoint = `http://127.0.0.1:${server.port}`
		settings.runtime.execute = true
		settings.runtime.stateFile = join(directory, 'state.json')
		settings.runtime.pollMilliseconds = 100
		settings.strategy.maximumGasCostAttoEth = E / 50n
		settings.connectivity.readRpcUrl = endpoint
		settings.connectivity.quorumRpcUrls = []
		settings.connectivity.publicRpcUrls = [endpoint]
		settings.connectivity.rpcQuorum = 1
		settings.selectedPortfolios = [{ address: fixture.harness.address, universeId: 1n }]
		settings.approvedUniverses = [1n]
		const pool = createRpcEndpointPool([endpoint])
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(ethereum) })
		const state = initialRuntimeState(false, account.address, 1)
		const sourceId = 33n
		// Only authenticated discovery is injected. Every changing quote field is
		// reread from the deployed contracts before the real submission path runs.
		const refresh: typeof refreshPortfolioExecution = async () => {
			const observation = portfolioObservation()
			const block = await sender.getBlock()
			if (block.number === undefined || block.hash === undefined) throw new Error('Missing production fixture block')
			const source = await fixture.position(sourceId)
			const owner = await sender.readContract({ ...fixture.capital, functionName: 'ownerAccount', args: [account.address] })
			const totals = await sender.readContract({ ...fixture.capital, functionName: 'totals' })
			observation.selection = { address: fixture.harness.address, universeId: 1n }
			observation.nextScope = { ...observation.selection, nextPositionId: 1n, sweepEnd: 64n }
			observation.knownPositionCount = 64n
			observation.acceptedPriceEpoch = await sender.readContract({ ...fixture.capital, functionName: 'acceptedPriceEpoch' })
			observation.walletRep = await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [account.address] })
			observation.walletAttoEth = await sender.getBalance({ address: account.address })
			observation.positions = [
				{
					...source,
					id: sourceId,
					executionReserveAttoEth: await sender.readContract({ ...fixture.capital, functionName: 'positionExecutionReserveAttoEth', args: [sourceId] }),
					requiredExecutionReserveAttoEth: await sender.readContract({ ...fixture.capital, functionName: 'requiredExecutionReserve', args: [source.commitment] }),
					liquidationStarted: await sender.readContract({ ...fixture.capital, functionName: 'liquidationStarted', args: [sourceId] }),
					retirementStatus: 'Retiring',
					stalledRetirement: false,
				},
			]
			const snapshot = observation.snapshot
			snapshot.portfolio = fixture.harness.address
			snapshot.universeId = 1n
			snapshot.owner = account.address
			snapshot.capitalLedger = fixture.capital.address
			snapshot.commitmentIndex = fixture.commitments.address
			snapshot.repToken = fixture.token.address
			snapshot.blockNumber = block.number
			snapshot.blockHash = block.hash
			snapshot.timestamp = block.timestamp
			snapshot.acceptedPrice = await sender.readContract({ ...fixture.capital, functionName: 'acceptedPrice' })
			snapshot.conservativePrice = await sender.readContract({ ...fixture.capital, functionName: 'conservativePrice' })
			snapshot.ownerConservativePrice = snapshot.conservativePrice
			snapshot.liquidationPrice = await sender.readContract({ ...fixture.capital, functionName: 'liquidationPrice' })
			snapshot.priceValidUntil = await sender.readContract({ ...fixture.capital, functionName: 'priceValidUntil' })
			snapshot.priceValid = await sender.readContract({ ...fixture.capital, functionName: 'isPriceValid' })
			snapshot.demandAttoEth = await sender.readContract({ ...fixture.capital, functionName: 'demandAttoEth' })
			snapshot.totalPledgedAttoRep = totals[0]
			snapshot.totalCommitmentAttoEth = totals[1]
			snapshot.ownerAccount = owner
			snapshot.ownerPrincipalAttoRep = owner.freeAttoRep
			snapshot.ownerCommitmentAttoEth = 0n
			snapshot.positions = []
			// Constructor economics of CapitalLedgerHarness (no public getters).
			snapshot.economics.minimumCommitmentAttoEth = 10n ** 15n
			snapshot.economics.minimumExecutionReserveAttoEth = 10n ** 14n
			return { observation, totalPrincipal: snapshot.ownerPrincipalAttoRep, allowance: await sender.readContract({ ...fixture.token, functionName: 'allowance', args: [account.address, fixture.capital.address] }) }
		}
		try {
			const target = await refresh(wallet, settings, [], pool, portfolioObservation(), sourceId)
			state.portfolioScopes = [target.observation.nextScope]
			const source = await fixture.position(sourceId)
			await executePortfolioTakeover(wallet, settings, state, pool, target.observation, sourceId, async () => true, { refresh, submit: submitCall })
			const confirmed = state.activities.find(activity => activity.status === 'confirmed')
			if (confirmed?.hash === undefined) throw new Error('Production takeover did not finalize')
			const transaction = await sender.getTransaction({ hash: confirmed.hash })
			const receipt = await sender.waitForTransactionReceipt({ hash: confirmed.hash })
			const estimate = estimates.at(-1)
			if (estimate === undefined) throw new Error('Production takeover did not estimate upfront gas')
			expect(estimate.block).toBe(`0x${target.observation.snapshot.blockNumber.toString(16)}`)
			expect(transaction.gas).toBe(paddedTransactionGas(estimate.gas))
			expect(receipt.status).toBe('success')
			expect(estimate.gas).toBeGreaterThan(receipt.gasUsed)
			expect(await fixture.position(sourceId)).toMatchObject({ rep: 0n, commitment: 0n })
			const receiver = await sender.readContract({ ...fixture.capital, functionName: 'ownerAccount', args: [account.address] })
			expect(await fixture.position(receiver.positionId)).toMatchObject({ owner: account.address, rep: 100n * E + source.rep, commitment: source.commitment, batch: source.batch, remainingCommitment: source.remainingCommitment })
			expect(state.pendingTransactions).toHaveLength(0)
			expect(state.paused).toBe(false)
			const durable: unknown = JSON.parse(await readFile(settings.runtime.stateFile, 'utf8'))
			expect(durable).toMatchObject({ pendingTransactions: [], activities: expect.arrayContaining([expect.objectContaining({ hash: confirmed.hash, status: 'confirmed' })]) })
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ productionOperatorTakeoverGas: { estimate: estimate.gas, signed: transaction.gas, used: receipt.gasUsed } })
		} finally {
			await server.stop(true)
			await rm(directory, { recursive: true, force: true })
		}
	})
})
