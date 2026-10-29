import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, hexToBytes, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './securityPoolCapitalTestFixture'

describe('Statoblast: composed capital economics and fork intent', () => {
	const fixture = useCapitalTestFixture()
	test('lifecycle delegate rejects direct price updates, authorization/import and an authenticated foreign host', async () => {
		const sender = fixture.client()
		const delegate = await sender.readContract({ ...fixture.capital, functionName: 'lifecycleDelegate' })
		const delegateAbi = parseAbi([
			'function acceptPrice(address feed,uint256 price,uint48 validUntil)',
			'function beginForkImport()',
			'function authorize(uint256 commitment,uint256 reportId,bool useReport,uint256 minimumCommitment)',
			'function importChoice(address owner,(uint256 rep,uint256 commitment,uint96 batch,uint256 executionReserveAttoEth,uint256 remainingCommitment) position,uint256 target) payable',
		])
		for (const data of [
			encodeFunctionData({ abi: delegateAbi, functionName: 'acceptPrice', args: [fixture.harness.address, E, 1_000_000] }),
			encodeFunctionData({ abi: delegateAbi, functionName: 'beginForkImport' }),
			encodeFunctionData({ abi: delegateAbi, functionName: 'authorize', args: [E, 0n, false, E / 1_000n] }),
			encodeFunctionData({ abi: delegateAbi, functionName: 'importChoice', args: [sender.account.address, { rep: 2n * E, commitment: E, batch: 0n, executionReserveAttoEth: E / 10n, remainingCommitment: 0n }, 10_000n] }),
		])
			await expect(sender.call({ to: delegate, data })).rejects.toThrow('Only capital ledger context')
		const runtime = await sender.getCode({ address: fixture.capital.address })
		if (runtime === undefined) throw new Error('Ledger runtime unavailable for foreign-context regression')
		const foreign = '0x000000000000000000000000000000000000f00d' as const
		await fixture.getAnvilWindowEthereum().addStateOverrides({ [foreign]: { code: hexToBytes(runtime) } })
		await expect(sender.call({ account: fixture.harness.address, to: foreign, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'beginForkImport' }) })).rejects.toThrow('Only capital ledger context')
	})
	test('fork backing release leaves free principal and already retired cash separately withdrawable', async () => {
		const sender = fixture.client()
		await fixture.fundOwners()
		await fixture.deposit(0, 210n * E)
		await fixture.deposit(1, 105n * E)
		await fixture.deposit(2, 315n * E)
		await fixture.authorize(0, 100n * E)
		const retired = await fixture.authorize(2, 100n * E)
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'setDemand', args: [200n * E] }))
		await writeContractAndWait(fixture.client(2), () => fixture.client(2).writeContract({ ...fixture.capital, functionName: 'requestRetirement', args: [retired, 0n] }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'setDemand', args: [100n * E] }))
		expect(await fixture.position(retired)).toMatchObject({ commitment: 0n, releasedRep: 315n * E })
		expect(await sender.readContract({ ...fixture.capital, functionName: 'retirementCashAttoRep' })).toBe(315n * E)
		await writeContractAndWait(sender, async () => sender.writeContract({ ...fixture.harness, functionName: 'setFork', args: [(await sender.getBlock()).timestamp] }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'releaseForkBacking' }))
		expect(await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.harness.address] })).toBe(210n * E)
		expect(await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.capital.address] })).toBe(420n * E)
		for (const owner of [0, 1, 2]) await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'exportChoice', args: [fixture.client(owner).account.address] }))
		expect((await fixture.owner(1)).freeAttoRep).toBe(105n * E)
		expect((await fixture.owner(2)).freeAttoRep).toBe(315n * E)
		expect(await sender.readContract({ ...fixture.capital, functionName: 'retirementCashAttoRep' })).toBe(0n)
		for (const [owner, amount] of [
			[1, 105n * E],
			[2, 315n * E],
		] as const) {
			const holder = fixture.client(owner)
			const before = await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [holder.account.address] })
			await writeContractAndWait(holder, () => holder.writeContract({ ...fixture.capital, functionName: 'withdrawPrincipal', args: [amount, holder.account.address] }))
			expect(await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [holder.account.address] })).toBe(before + amount)
			await expect(writeContractAndWait(holder, () => holder.writeContract({ ...fixture.capital, functionName: 'withdrawExecutionReserve', args: [1n] }))).rejects.toThrow('Reserve follows fork choice')
		}
		expect(await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.capital.address] })).toBe(0n)
		expect(await sender.readContract({ ...fixture.capital, functionName: 'totalFreeAttoRep' })).toBe(0n)
	})
	for (const scale of [1n, 3n]) {
		test(`mixed custody actions conserve principal, income and fork retirement intent (scale ${scale})`, async () => {
			const sender = fixture.client()
			const ethereum = fixture.getAnvilWindowEthereum()
			const U = E * scale
			const expected = [
				{ principal: 126n * U, commitment: 100n * U, remaining: 0n, queued: false },
				{ principal: 420n * U, commitment: 100n * U, remaining: 0n, queued: false },
				{ principal: 500n * U, commitment: 0n, remaining: 0n, queued: false },
				{ principal: 300n * U, commitment: 100n * U, remaining: 0n, queued: false },
			]
			const alice = expected[0]
			const bob = expected[1]
			const keeper = expected[2]
			const carol = expected[3]
			if (alice === undefined || bob === undefined || keeper === undefined || carol === undefined) throw new Error('Missing economic model owner')
			await fixture.fundOwners()
			for (let i = 0; i < expected.length; i++) {
				const entry = expected[i]
				if (entry === undefined) throw new Error('Missing principal model')
				await fixture.deposit(i, entry.principal)
				if (entry.commitment !== 0n) await fixture.authorize(i, entry.commitment)
			}
			const ids = await Promise.all([0, 1, 2, 3].map(async i => (await fixture.owner(i)).positionId))
			const aliceId = ids[0]
			const bobId = ids[1]
			const carolId = ids[3]
			if (aliceId === undefined || bobId === undefined || carolId === undefined) throw new Error('Missing economic model position')
			let price = E
			let fundedEth = 0n
			let fundedRep = 0n
			let paidEth = 0n
			let paidRep = 0n
			const principal = 1346n * U
			const initialSupply = await sender.readContract({ ...fixture.token, functionName: 'totalSupply' })
			const streams = { abi: streamsArtifact.abi, address: await sender.readContract({ ...fixture.capital, functionName: 'feeStreams' }) }
			const trace: string[] = []
			const check = async () => {
				let feesEth = 0n
				let feesRep = 0n
				let healthy = 0n
				let active = 0n
				let totalK = 0n
				for (let i = 0; i < expected.length; i++) {
					const entry = expected[i]
					if (entry === undefined) throw new Error('Missing custody expectation')
					const owner = await fixture.owner(i)
					const position = await fixture.position(owner.positionId)
					const collateral = await sender.readContract({ ...fixture.capital, functionName: 'ownerCollateral', args: [fixture.client(i).account.address] })
					expect(collateral[0]).toBe(entry.principal)
					expect(collateral[1]).toBe(entry.commitment)
					expect(position.remainingCommitment).toBe(entry.remaining)
					if (entry.commitment !== 0n) expect(position.batch !== 0n).toBe(entry.queued)
					feesEth += owner.feesAttoEth + position.ethFees
					feesRep += owner.feesAttoRep + position.repFees
					totalK += entry.commitment
					if (entry.commitment !== 0n && (((entry.principal * 10_000n) / 10_500n) * E) / entry.commitment >= price) {
						healthy += entry.commitment
						active += entry.queued ? entry.remaining : entry.commitment
					}
				}
				const outstandingEth = await sender.readContract({ ...streams, functionName: 'outstandingEth' })
				const outstandingRep = await sender.readContract({ ...streams, functionName: 'outstandingRep' })
				const custodyRep = (await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.capital.address] })) + (await sender.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.harness.address] }))
				const reserve = (
					await Promise.all(
						[0, 1, 2, 3].map(async i => {
							const owner = await fixture.owner(i)
							return owner.executionReserveAttoEth + (await sender.readContract({ ...fixture.capital, functionName: 'positionExecutionReserveAttoEth', args: [owner.positionId] }))
						}),
					)
				).reduce((a, b) => a + b, 0n)
				expect((await sender.readContract({ ...fixture.capital, functionName: 'totals' }))[1]).toBe(totalK)
				expect(await sender.readContract({ ...fixture.commitments, functionName: 'eligibleCommitment', args: [price] })).toBe(healthy)
				expect(await sender.readContract({ ...fixture.commitments, functionName: 'eligibleActiveCommitment', args: [price] })).toBe(active)
				expect(custodyRep).toBe(principal + feesRep + outstandingRep)
				const burnedRep = initialSupply + fundedRep - (await sender.readContract({ ...fixture.token, functionName: 'totalSupply' }))
				expect(fundedRep).toBe(feesRep + outstandingRep + paidRep + burnedRep)
				expect(await sender.getBalance({ address: fixture.capital.address })).toBe(reserve + feesEth + outstandingEth)
				expect((await sender.getBalance({ address: fixture.capital.address })) + (await sender.getBalance({ address: fixture.harness.address })) + paidEth).toBe(400n * E + fundedEth)
			}
			const action = async (label: string, execute: () => Promise<unknown>, update: () => void = () => {}) => {
				trace.push(label)
				try {
					await execute()
					update()
					await check()
				} catch (cause) {
					throw new Error(`Economic trace scale=${scale}\n${trace.join('\n')}`, { cause })
				}
			}
			const demand = (value: bigint) => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'setDemand', args: [value] }))
			await check()
			await action('target alice 12000', () => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.capital, functionName: 'setHealthTarget', args: [12_000n] })))
			await action(
				'adverse price with unused nominal capacity',
				() => fixture.price(2n * E),
				() => {
					price = 2n * E
				},
			)
			await action(
				'minimal cure pays progress without moving owner principal',
				() => writeContractAndWait(fixture.client(2), () => fixture.client(2).writeContract({ ...fixture.capital, functionName: 'cure', args: [aliceId] })),
				() => {
					alice.commitment = 60n * U
				},
			)
			await action(
				'recovery before fresh authorization',
				() => fixture.price(E),
				() => {
					price = E
				},
			)
			await action(
				'authorize restored capacity funds its execution reserve again',
				() => fixture.authorize(0, 100n * U),
				() => {
					alice.commitment = 100n * U
				},
			)
			await action('demand 300', () => demand(300n * U))
			await action(
				'fund ETH fees',
				() => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundFees', value: 30n * U })),
				() => {
					fundedEth += 30n * U
				},
			)
			await action(
				'fund REP fees',
				() => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundRepFees', args: [90n * U] })),
				() => {
					fundedRep += 90n * U
				},
			)
			await action(
				'alice partial exit',
				() => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.capital, functionName: 'requestRetirement', args: [aliceId, 60n * U] })),
				() => {
					alice.remaining = 60n * U
					alice.queued = true
				},
			)
			await action(
				'bob full exit newer cohort',
				() => writeContractAndWait(fixture.client(1), () => fixture.client(1).writeContract({ ...fixture.capital, functionName: 'requestRetirement', args: [bobId, 0n] })),
				() => {
					bob.queued = true
				},
			)
			await ethereum.advanceTime(600n)
			await action(
				'adverse price',
				() => fixture.price(2n * E),
				() => {
					price = 2n * E
				},
			)
			await action('cure without nominal headroom', () => writeContractAndWait(fixture.client(2), () => fixture.client(2).writeContract({ ...fixture.capital, functionName: 'cure', args: [aliceId] })))
			await action('raise healthy owner target', () => writeContractAndWait(fixture.client(3), () => fixture.client(3).writeContract({ ...fixture.capital, functionName: 'setHealthTarget', args: [12_000n] })))
			await ethereum.advanceTime(3601n)
			await action(
				'takeover transfers queued reduction and inherited residual intent',
				() => writeContractAndWait(fixture.client(2), () => fixture.client(2).writeContract({ ...fixture.capital, functionName: 'takeOver', args: [aliceId, 50n * U, 63n * U, 500n * U] })),
				() => {
					alice.principal = 63n * U
					alice.commitment = 50n * U
					alice.remaining = 0n
					alice.queued = false
					keeper.principal = 563n * U
					keeper.commitment = 50n * U
					keeper.remaining = 10n * U
					keeper.queued = true
				},
			)
			await action(
				'price recovery',
				() => fixture.price(E),
				() => {
					price = E
				},
			)
			await action(
				'demand release services only older residual frontier',
				() => demand(250n * U),
				() => {
					keeper.commitment = 10n * U
					keeper.remaining = 0n
					keeper.queued = false
				},
			)
			await action(
				'global service reaches one newer full-exit boundary',
				() => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.capital, functionName: 'serveRetirement', args: [0n] })),
				() => {
					bob.commitment = 90n * U
				},
			)
			await action('targeted service cannot consume retained demand', () => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.capital, functionName: 'serveRetirement', args: [bobId] })))
			await action(
				'carol requests partial retirement',
				() => writeContractAndWait(fixture.client(3), () => fixture.client(3).writeContract({ ...fixture.capital, functionName: 'requestRetirement', args: [carolId, 50n * U] })),
				() => {
					carol.queued = true
					carol.remaining = 50n * U
				},
			)
			await action(
				'carol cancels',
				() => writeContractAndWait(fixture.client(3), () => fixture.client(3).writeContract({ ...fixture.capital, functionName: 'cancelRetirement', args: [carolId] })),
				() => {
					carol.queued = false
					carol.remaining = 0n
				},
			)
			await action(
				'carol requeues behind existing closed cohort',
				() => writeContractAndWait(fixture.client(3), () => fixture.client(3).writeContract({ ...fixture.capital, functionName: 'requestRetirement', args: [carolId, 50n * U] })),
				() => {
					carol.queued = true
					carol.remaining = 50n * U
				},
			)
			await ethereum.advanceTime(86_401n)
			await action('checkpoint all mature income', () => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.capital, functionName: 'checkpoint' })))
			const forkTime = (await sender.getBlock()).timestamp
			await action('freeze parent', () => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'setFork', args: [forkTime] })))
			const child = await fixture.deploy()
			const childHarness = { abi: harnessArtifact.abi, address: child.address }
			await writeContractAndWait(sender, () => sender.writeContract({ ...childHarness, functionName: 'setPrice', args: [E, Number(forkTime + 1_000_000n)] }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...childHarness, functionName: 'beginImport' }))
			const current = await sender.readContract({ ...fixture.commitments, functionName: 'currentBatch' })
			for (let i = 0; i < expected.length; i++) {
				const owner = await fixture.owner(i)
				const position = await fixture.position(owner.positionId)
				const reserve = await sender.readContract({ ...fixture.capital, functionName: 'positionExecutionReserveAttoEth', args: [owner.positionId] })
				let importedBatch = 0n
				if (position.batch !== 0n) importedBatch = position.batch === current ? 1n : 2n
				await action(`export choice owner ${i}`, () => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'exportChoice', args: [fixture.client(i).account.address] })))
				await expect(writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'exportChoice', args: [fixture.client(i).account.address] }))).rejects.toThrow('Fork choice unavailable')
				await writeContractAndWait(sender, () =>
					sender.writeContract({
						...childHarness,
						functionName: 'importChoice',
						args: [fixture.client(i).account.address, { rep: position.rep, commitment: position.commitment, batch: importedBatch, executionReserveAttoEth: reserve, remainingCommitment: position.remainingCommitment }, owner.targetHealthFactorBps || 10_000n],
						value: reserve + owner.executionReserveAttoEth,
					}),
				)
			}
			await action('release exact frozen backing', () => writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'releaseForkBacking' })))
			await expect(writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'releaseForkBacking' }))).rejects.toThrow('Fork backing release unavailable')
			await writeContractAndWait(sender, () => sender.writeContract({ ...childHarness, functionName: 'mint', args: [child.ledger, principal] }))
			await writeContractAndWait(sender, () => sender.writeContract({ ...childHarness, functionName: 'finishImport', args: [250n * U] }))
			for (let i = 0; i < expected.length; i++) {
				const entry = expected[i]
				if (entry === undefined) throw new Error('Child model owner missing')
				const owner = await sender.readContract({ abi: capitalArtifact.abi, address: child.ledger, functionName: 'ownerAccount', args: [fixture.client(i).account.address] })
				expect(await sender.readContract({ abi: indexArtifact.abi, address: child.index, functionName: 'accountOf', args: [owner.positionId] })).toMatchObject({ rep: entry.principal, commitment: entry.commitment, remainingCommitment: entry.remaining, ethFees: 0n, repFees: 0n })
			}
			await writeContractAndWait(sender, () => sender.writeContract({ ...childHarness, functionName: 'setDemand', args: [160n * U] }))
			expect(await sender.readContract({ abi: indexArtifact.abi, address: child.index, functionName: 'accountOf', args: [2n] })).toMatchObject({ commitment: 0n, releasedRep: 420n * U })
			expect(await sender.readContract({ abi: indexArtifact.abi, address: child.index, functionName: 'accountOf', args: [4n] })).toMatchObject({ commitment: 100n * U, remainingCommitment: 50n * U, batch: 2n })
			await writeContractAndWait(sender, () => sender.writeContract({ ...childHarness, functionName: 'setDemand', args: [110n * U] }))
			expect(await sender.readContract({ abi: indexArtifact.abi, address: child.index, functionName: 'accountOf', args: [4n] })).toMatchObject({ commitment: 50n * U, rep: 300n * U, remainingCommitment: 0n, batch: 0n })
			expect(await sender.readContract({ abi: tokenArtifact.abi, address: child.token, functionName: 'balanceOf', args: [child.ledger] })).toBe(principal)
			await writeContractAndWait(fixture.client(1), () => fixture.client(1).writeContract({ abi: capitalArtifact.abi, address: child.ledger, functionName: 'withdrawPrincipal', args: [420n * U, fixture.client(1).account.address] }))
			expect(await sender.readContract({ abi: tokenArtifact.abi, address: child.token, functionName: 'balanceOf', args: [fixture.client(1).account.address] })).toBe(420n * U)
			expect(await sender.readContract({ abi: tokenArtifact.abi, address: child.token, functionName: 'balanceOf', args: [child.ledger] })).toBe(principal - 420n * U)
			expect(await sender.readContract({ abi: capitalArtifact.abi, address: child.ledger, functionName: 'ownerAccount', args: [fixture.client(1).account.address] })).toMatchObject({ positionId: 0n, freeAttoRep: 0n, executionReserveAttoEth: 100n * E })
			for (let i = 0; i < expected.length; i++) {
				const owner = await fixture.owner(i)
				const position = await fixture.position(owner.positionId)
				const eth = owner.feesAttoEth + position.ethFees
				const rep = owner.feesAttoRep + position.repFees
				await action(
					`claim old parent income ${i}`,
					() => writeContractAndWait(fixture.client(i), () => fixture.client(i).writeContract({ ...fixture.capital, functionName: 'claimEarnings' })),
					() => {
						paidEth += eth
						paidRep += rep
					},
				)
			}
		})
	}
})
