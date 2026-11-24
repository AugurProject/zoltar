import { describe, expect, test } from 'bun:test'
import { keccak256 } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalLifecycleDelegate_SecurityPoolCapitalLifecycleDelegate as lifecycleArtifact,
	statoblast_SecurityPoolCapitalRepairAuctionDelegate_SecurityPoolCapitalRepairAuctionDelegate as auctionArtifact,
} from '../../types/contractArtifact'
import { useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: production security pool module deployment', () => {
	// The fixture measures every staged deployment receipt against Osaka's
	// transaction cap, including constructor-created module descendants.
	const fixture = useSecurityPoolFixture()
	test('#1547: independent security pools share stateless delegates with isolated host state', async () => {
		const client = fixture.owner()
		const second = await fixture.deploySecurityPool()
		const firstCapital = fixture.capitalLedger
		const secondCapital = await client.readContract({ abi: securityPoolArtifact.abi, address: second, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })
		expect(secondCapital).not.toBe(firstCapital)
		for (const functionName of ['lifecycleDelegate', 'repairAuctionDelegate'] as const) {
			const first = await client.readContract({ abi: capitalArtifact.abi, address: firstCapital, functionName })
			expect(await client.readContract({ abi: capitalArtifact.abi, address: secondCapital, functionName })).toBe(first)
		}
		await fixture.deposit()
		expect(await client.readContract({ abi: capitalArtifact.abi, address: secondCapital, functionName: 'totalFreeAttoRep' })).toBe(0n)
		await fixture.deposit(200n, client, second)
		await client.writeContract({ abi: capitalArtifact.abi, address: firstCapital, functionName: 'setHealthTarget', args: [15_000n] }).then(hash => client.waitForTransactionReceipt({ hash }))
		const firstOwner = await client.readContract({ abi: capitalArtifact.abi, address: firstCapital, functionName: 'ownerAccount', args: [client.account.address] })
		const secondOwner = await client.readContract({ abi: capitalArtifact.abi, address: secondCapital, functionName: 'ownerAccount', args: [client.account.address] })
		expect(firstOwner.targetHealthFactorBps).toBe(15_000n)
		expect(secondOwner.targetHealthFactorBps).not.toBe(15_000n)
		expect(secondOwner.freeAttoRep).toBe(200n)
		const lifecycle = await client.readContract({ abi: capitalArtifact.abi, address: firstCapital, functionName: 'lifecycleDelegate' })
		const auction = await client.readContract({ abi: capitalArtifact.abi, address: firstCapital, functionName: 'repairAuctionDelegate' })
		await expect(client.writeContract({ abi: lifecycleArtifact.abi, address: lifecycle, functionName: 'setHealthTarget', args: [15_000n] })).rejects.toThrow('Only capital delegatecall')
		await expect(client.writeContract({ abi: auctionArtifact.abi, address: auction, functionName: 'install', args: [firstCapital, 1n, 1n, 1n, 1n] })).rejects.toThrow('Only capital delegatecall')
	})

	test('staged setup creates correctly bound lifecycle and reporting modules with runtime headroom', async () => {
		const client = fixture.owner()
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const services = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		const lifecycle = await client.readContract({ ...capital, functionName: 'lifecycleDelegate' })
		const auction = await client.readContract({ ...capital, functionName: 'repairAuctionDelegate' })
		expect(await client.readContract({ ...capital, functionName: 'securityPool' })).toBe(fixture.securityPool)
		expect(await client.readContract({ abi: lifecycleArtifact.abi, address: lifecycle, functionName: 'implementation' })).toBe(lifecycle)
		expect(await client.readContract({ abi: auctionArtifact.abi, address: auction, functionName: 'implementation' })).toBe(auction)
		const observations = []
		for (const [name, address] of [
			['capital clone', fixture.capitalLedger],
			['capital implementation', await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'capitalImplementation' })],
			['services', services],
			['lifecycle', lifecycle],
			['auction', auction],
		] as const) {
			const code = await client.getCode({ address })
			if (code === undefined || code === '0x') throw new Error(`Production ${name} runtime missing`)
			const runtimeBytes = (code.length - 2) / 2
			expect(runtimeBytes).toBeLessThanOrEqual(name === 'capital implementation' ? 24_576 : 24_576 - 1_024)
			observations.push({ name, address, runtimeBytes, runtimeHash: keccak256(code) })
		}
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ productionSecurityPoolModules: observations })
	})
})
