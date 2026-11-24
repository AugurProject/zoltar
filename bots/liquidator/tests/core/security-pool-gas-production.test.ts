import { SECURITY_POOL_CHECKPOINT_GAS_RESERVE } from '../../src/execution/gas-estimate.ts'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { capitalUnit as E, useCapitalTestFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolCapitalTestFixture'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { executeSecurityPoolTakeover, type refreshSecurityPoolExecution } from '../../src/execution/security-pool-executor.ts'
import { securityPoolTakeoverPlan } from '../../src/core/security-pool-strategy.ts'
import { submitCall } from '../../src/execution/submit-call.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolObservation, securityPoolSettings } from '../support/security-pool-observation.ts'
import { useSecurityPoolFixture } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'

// The harness supplies book/price authority; Ledger, Index, signing, simulation,
// public submission and durable receipt settlement all run their real code.
// Factory authentication is covered separately by security-pool-production.test.ts.
describe('security pool operator production gas execution', () => {
	const fixture = useCapitalTestFixture()
	test('a funded fragmented-book takeover estimates, signs and completes with its required upfront gas', async () => {
		const ethereum = fixture.getAnvilWindowEthereum()
		const sender = fixture.client()
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		const buyer = createWriteClient(ethereum, BigInt(account.address))
		await ethereum.impersonateAccount(account.address)
		await ethereum.setBalance(account.address, 10_000n * E)
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'beginImport' }))
		for (let start = 0; start < 64; start += 8) await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'importChoices', args: [BigInt(start), 8n, true] }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'finishImport', args: [1280n * E] }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'mint', args: [account.address, 1000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.token, functionName: 'approve', args: [fixture.capital.address, 1000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.capital, functionName: 'depositAndSetHealthTarget', args: [100n * E, 15_000n] }))
		for (let epoch = 0; epoch < 6; epoch++) {
			await fixture.price(epoch % 2 === 0 ? E : 4n * E + (64n * 10n ** 12n) / (21n * BigInt(epoch + 1)))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundFees', value: 64n * E }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundRepFees', args: [64n * E] }))
			await ethereum.advanceTime(18_000n)
		}
		await fixture.price(2n * E)
		await ethereum.advanceTime(18_000n)
		const directory = await mkdtemp(join(tmpdir(), 'security-pool-production-gas-'))
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
		const settings = securityPoolSettings()
		const endpoint = `http://127.0.0.1:${server.port}`
		settings.runtime.execute = true
		settings.runtime.stateFile = join(directory, 'state.json')
		settings.runtime.pollMilliseconds = 100
		settings.strategy.maximumGasCostAttoEth = E / 50n
		settings.connectivity.readRpcUrl = endpoint
		settings.connectivity.quorumRpcUrls = []
		settings.connectivity.publicRpcUrls = [endpoint]
		settings.connectivity.rpcQuorum = 1
		settings.selectedSecurityPools = [{ address: fixture.harness.address, universeId: 1n }]
		settings.approvedUniverses = [1n]
		const pool = createRpcEndpointPool([endpoint])
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(ethereum) })
		const state = initialRuntimeState(false, account.address, 1)
		const sourceId = 33n
		// Only authenticated discovery is injected. Every changing quote field is
		// reread from the deployed contracts before the real submission path runs.
		const refresh: typeof refreshSecurityPoolExecution = async () => {
			const observation = securityPoolObservation()
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
					liquidationStarted: await sender.readContract({ ...fixture.capital, functionName: 'liquidationStarted', args: [sourceId] }),
					retirementStatus: 'Retiring',
					stalledRetirement: false,
				},
			]
			const snapshot = observation.snapshot
			snapshot.securityPool = fixture.harness.address
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
			return { observation, totalPrincipal: snapshot.ownerPrincipalAttoRep, allowance: await sender.readContract({ ...fixture.token, functionName: 'allowance', args: [account.address, fixture.capital.address] }) }
		}
		try {
			const target = await refresh(wallet, settings, [], pool, securityPoolObservation(), sourceId)
			state.securityPoolScopes = [target.observation.nextScope]
			const source = await fixture.position(sourceId)
			await executeSecurityPoolTakeover(wallet, settings, state, pool, target.observation, sourceId, async () => true, { refresh, submit: submitCall })
			const confirmed = state.activities.find(activity => activity.status === 'confirmed')
			if (confirmed?.hash === undefined) throw new Error('Production takeover did not finalize')
			const transaction = await sender.getTransaction({ hash: confirmed.hash })
			const receipt = await sender.waitForTransactionReceipt({ hash: confirmed.hash })
			const estimate = estimates.at(-1)
			if (estimate === undefined) throw new Error('Production takeover did not estimate upfront gas')
			expect(estimate.block).toBe(`0x${target.observation.snapshot.blockNumber.toString(16)}`)
			expect(transaction.gas).toBe(paddedTransactionGas(estimate.gas + SECURITY_POOL_CHECKPOINT_GAS_RESERVE))
			expect(receipt.status).toBe('success')
			expect(estimate.gas).toBeGreaterThan(receipt.gasUsed)
			expect((await fixture.position(sourceId)).rep).toBe(0n)
			expect((await fixture.position(sourceId)).commitment).toBe(0n)
			const receiver = await sender.readContract({ ...fixture.capital, functionName: 'ownerAccount', args: [account.address] })
			const repaired = await fixture.position(receiver.positionId)
			expect(repaired).toMatchObject({ owner: account.address, rep: 100n * E + source.rep, batch: source.batch })
			expect(repaired.commitment + (await fixture.position(sourceId)).commitment).toBe(source.commitment)
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

describe('atomic unpaid cure and security pool takeover', () => {
	const fixture = useCapitalTestFixture()
	for (const retainedCommitment of [0n, 90n * E])
		test(`acquires an insolvent residual atomically after unpaid cure (retained commitment ${retainedCommitment})`, async () => {
			const ethereum = fixture.getAnvilWindowEthereum()
			const sender = fixture.client()
			const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
			await ethereum.impersonateAccount(account.address)
			await ethereum.setBalance(account.address, 100n * E)
			const buyer = createWriteClient(ethereum, BigInt(account.address))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'beginImport' }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'importChoice', args: [sender.account.address, { rep: 105n * E, commitment: 100n * E, batch: retainedCommitment === 0n ? 0n : 1n, remainingCommitment: retainedCommitment, retirementOrder: 0n }, 10_000n] }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'mint', args: [fixture.capital.address, 105n * E] }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'finishImport', args: [90n * E] }))
			await fixture.price(2n * E)
			await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'mint', args: [account.address, 201n * E] }))
			await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.token, functionName: 'approve', args: [fixture.capital.address, 200n * E] }))
			await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.capital, functionName: 'depositAndSetHealthTarget', args: [200n * E, 15_000n] }))
			await fixture.price(2n * E)
			await ethereum.advanceTime(3601n)
			const wallet = createWalletClient({ account, chain: mainnet, transport: custom(ethereum) })
			const settings = securityPoolSettings()
			settings.runtime.execute = true
			const state = initialRuntimeState(false, account.address, 1)
			const pool = createRpcEndpointPool(['https://unused.example'])
			const refresh: typeof refreshSecurityPoolExecution = async () => {
				const observation = securityPoolObservation()
				const source = await fixture.position(1n)
				const owner = await buyer.readContract({ ...fixture.capital, functionName: 'ownerAccount', args: [account.address] })
				const block = await buyer.getBlock()
				if (block.number === undefined || block.hash === undefined) throw new Error('Missing test block')
				observation.acceptedPriceEpoch = await buyer.readContract({ ...fixture.capital, functionName: 'acceptedPriceEpoch' })
				observation.walletRep = await buyer.readContract({ ...fixture.token, functionName: 'balanceOf', args: [account.address] })
				observation.walletAttoEth = await buyer.getBalance({ address: account.address })
				observation.positions = [{ ...source, id: 1n, liquidationStarted: await buyer.readContract({ ...fixture.capital, functionName: 'liquidationStarted', args: [1n] }), retirementStatus: 'No pending reduction', stalledRetirement: false }]
				Object.assign(observation.snapshot, {
					owner: account.address,
					repToken: fixture.token.address,
					capitalLedger: fixture.capital.address,
					blockNumber: block.number,
					blockHash: block.hash,
					timestamp: block.timestamp,
					acceptedPrice: 2n * E,
					conservativePrice: 2n * E,
					ownerConservativePrice: 2n * E,
					liquidationPrice: 2n * E,
					ownerAccount: owner,
					ownerPrincipalAttoRep: owner.freeAttoRep,
					priceValidUntil: block.timestamp + 1000n,
				})
				observation.snapshot.totalCommitmentAttoEth = (await buyer.readContract({ ...fixture.capital, functionName: 'totals' }))[1]
				observation.snapshot.demandAttoEth = await buyer.readContract({ ...fixture.capital, functionName: 'demandAttoEth' })
				observation.snapshot.economics.minimumCommitmentAttoEth = 10n ** 15n
				return { observation, totalPrincipal: owner.freeAttoRep, allowance: 0n }
			}
			const current = await refresh(wallet, settings, [], pool, securityPoolObservation(), 1n)
			const target = current.observation.positions[0]
			if (target === undefined) throw new Error('Missing test target')
			expect(target).toMatchObject({ rep: 105n * E, commitment: 100n * E, batch: retainedCommitment === 0n ? 0n : 1n, remainingCommitment: retainedCommitment })
			expect(securityPoolTakeoverPlan(current.observation, target, settings, current.totalPrincipal, true).plan).toMatchObject({ commitment: 90n * E, minimumAward: 105n * E, ownFunding: 0n, expectedSourceBatch: 0n })
			let submitted = 0
			const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
				await call.preSubmit?.()
				await buyer.call({ to: call.to, data: call.data, value: call.value })
				const hash = await buyer.sendTransaction({ to: call.to, data: call.data, value: call.value })
				expect((await buyer.waitForTransactionReceipt({ hash })).status).toBe('success')
				submitted++
				return hash
			}
			await executeSecurityPoolTakeover(wallet, settings, state, pool, current.observation, 1n, async () => true, { refresh, submit })
			expect(submitted).toBe(1)
			expect(await fixture.position(1n)).toMatchObject({ rep: 0n, commitment: 0n })
			const receiver = await buyer.readContract({ ...fixture.capital, functionName: 'ownerAccount', args: [account.address] })
			expect(receiver.feesAttoRep).toBe(0n)
			expect(await fixture.position(receiver.positionId)).toMatchObject({ rep: 305n * E, commitment: 90n * E, batch: 0n, remainingCommitment: 0n })
		})
})

describe('direct takeover against a holding-fee security pool', () => {
	const fixture = useSecurityPoolFixture()

	test('the checkpoint clamps a quote across elapsed holding fees and the keeper still completes (#1350, #1373)', async () => {
		const source = fixture.owner()
		const buyer = fixture.other()
		await fixture.prepare(300n * E, 100n * E)
		await fixture.mint(90n * E)
		await fixture.deposit(900n * E, buyer)
		await writeContractAndWait(buyer, () => buyer.writeContract({ abi: securityPoolCapitalLedgerAbi, address: fixture.capitalLedger, functionName: 'setHealthTarget', args: [15_000n] }))
		await fixture.refreshPrice(fixture.base.questionId, 3n * E)
		const settings = securityPoolSettings()
		settings.runtime.execute = true
		const { securityPoolFactory, zoltar } = getInfraContractAddresses()
		settings.deployment = { ...settings.deployment, securityPoolFactory, zoltar }
		const scope = { address: fixture.securityPool, universeId: fixture.base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.selectedSecurityPools = [scope]
		settings.approvedUniverses = [scope.universeId]
		const wallet = createWalletClient({ account: buyer.account, chain: mainnet, transport: custom(fixture.base.mockWindow) })
		const state = initialRuntimeState(false, buyer.account.address, 1)
		const pool = createRpcEndpointPool(['https://unused.example'])
		const id = 1n
		const observe = async () => {
			const block = await buyer.getBlock()
			if (block.number === undefined) throw new Error('Missing test block')
			return loadSecurityPoolObservation(buyer, settings, buyer.account.address, scope, block.number, [id])
		}
		const first = await observe()
		const target = first.positions[0]
		if (target === undefined) throw new Error('Missing keeper target')
		const { plan, reason } = securityPoolTakeoverPlan(first, target, settings, first.managedPrincipalAttoRep ?? 0n, true)
		if (plan === undefined) throw new Error(`Keeper could not quote the distressed position: ${reason}`)
		expect(plan.minimumAward).toBe(0n)
		expect(plan.requestedCommitment).toBeGreaterThan(plan.commitment)
		expect(plan.ownFunding).toBe(0n)
		const refresh: typeof refreshSecurityPoolExecution = async () => {
			const observation = await observe()
			return { observation, totalPrincipal: observation.managedPrincipalAttoRep ?? 0n, allowance: 0n }
		}
		let transactions = 0
		const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
			await buyer.call({ to: call.to, data: call.data, value: call.value })
			await call.preSubmit?.()
			await fixture.base.mockWindow.advanceTime(60n)
			const hash = await writeContractAndWait(buyer, () => buyer.sendTransaction({ to: call.to, data: call.data, value: call.value }))
			transactions++
			return hash
		}
		await executeSecurityPoolTakeover(wallet, settings, state, pool, first, id, async () => true, { refresh, submit })
		const after = await observe()
		expect(transactions).toBe(1)
		expect(state.paused).toBe(false)
		expect(after.snapshot.demandAttoEth).toBeLessThan(first.snapshot.demandAttoEth)
		expect(after.snapshot.ownerCommitmentAttoEth).toBeGreaterThan(0n)
		expect(after.snapshot.ownerCommitmentAttoEth).toBeLessThanOrEqual(plan.requestedCommitment ?? plan.commitment)
		expect((after.positions.find(position => position.owner === source.account.address)?.rep ?? 0n) + after.snapshot.ownerPrincipalAttoRep).toBe(target.rep + first.snapshot.ownerPrincipalAttoRep)
	})
})
