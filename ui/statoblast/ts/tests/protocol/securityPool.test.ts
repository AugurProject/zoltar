import { expect, test } from 'bun:test'
import { loadSecurityPoolAccount, loadSecurityPoolSetup, verifyRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { capitalClient, modules } from '../features/security-pools/capitalClient.js'
import { capitalSnapshot, owner, securityPool, capital, index } from '../features/security-pools/capitalFixture.js'
test('custody authentication and bounded accounting pin every read to one mined block', async () => {
	const fixture = capitalClient(capitalSnapshot({ questionCount: 10_000n }))
	const snapshot = await loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)
	expect(snapshot.positions).toHaveLength(1)
	expect(fixture.reads.filter(read => read.name === 'capitalLedger' && read.args === undefined)).toHaveLength(2)
	expect(snapshot.questions).toHaveLength(64)
	expect(new Set(fixture.reads.map(read => read.blockNumber))).toEqual(new Set([10n]))
	expect(fixture.reads.length).toBeLessThan(86)
})
test('a spoofed module fails closed before approvals can be offered', async () => {
	const fixture = capitalClient()
	fixture.codes.set(modules.engine, '0x6000')
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('settlement engine runtime')
})
test('an unrecognized capital lifecycle delegate fails closed before approvals', async () => {
	const fixture = capitalClient()
	fixture.setRead('lifecycleDelegate', modules.engine)
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('capital lifecycle delegate runtime')
})
test('a lifecycle delegate whose implementation getter points elsewhere fails authentication', async () => {
	const fixture = capitalClient()
	fixture.setRead('implementation', modules.engine, modules.lifecycle)
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('capital lifecycle delegate belongs to another authority')
})
test('an unrecognized capital auction delegate fails closed before approvals', async () => {
	const fixture = capitalClient()
	fixture.setRead('repairAuctionDelegate', modules.engine)
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('capital auction delegate runtime')
})
test('an auction delegate whose implementation getter points elsewhere fails authentication', async () => {
	const fixture = capitalClient()
	fixture.setRead('implementation', modules.engine, modules.repairAuctionDelegate)
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('capital auction delegate belongs to another authority')
})
test('setup and account authentication reject an unrecognized future auction deployer', async () => {
	const fixture = capitalClient()
	fixture.setRead('repairAuctionDeployer', modules.engine)
	await expect(loadSecurityPoolSetup(fixture.client, securityPool, owner)).rejects.toThrow('unrecognized auction deployer')
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('unrecognized auction deployer')
})
test('genuine runtime code the canonical factory did not deploy fails setup and account authentication', async () => {
	// Runtime code and getters match a real security pool; only the factory record separates it from one built with other module deployers.
	const fixture = capitalClient()
	fixture.setRead('isSecurityPool', false)
	const codeTargets: string[] = []
	const client = fixture.client.extend(() => ({
		getCode: async (request: Parameters<typeof fixture.client.getCode>[0]) => {
			codeTargets.push(request.address)
			return await fixture.client.getCode(request)
		},
	}))
	await expect(loadSecurityPoolSetup(client, securityPool, owner)).rejects.toThrow('not deployed by the canonical factory')
	await expect(loadSecurityPoolAccount(client, securityPool, owner, 0n)).rejects.toThrow('not deployed by the canonical factory')
	expect(codeTargets).toEqual([])
	expect(fixture.reads.map(read => read.name)).toEqual(['isSecurityPool', 'isSecurityPool'])
	expect(fixture.reads.filter(read => read.name === 'isSecurityPool').map(read => [read.args, read.blockNumber])).toEqual([
		[[securityPool], 10n],
		[[securityPool], 10n],
	])
})

test.each([
	['0x', 'No contract exists at this address.'],
	['0x6000', 'This isn’t a Statoblast security pool.'],
] as const)('direct pool setup explains an unverified address with runtime code %s', async (code, message) => {
	const fixture = capitalClient()
	fixture.setRead('isSecurityPool', false)
	const client = fixture.client.extend(() => ({ getCode: async () => code }))
	await expect(loadSecurityPoolSetup(client, securityPool, owner, true)).rejects.toThrow(message)
})
test('a genuine capital ledger cannot nominate an unrelated fork authority', async () => {
	const fixture = capitalClient()
	fixture.setRead('forkAuthority', modules.engine)
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('Capital ledger uses another fork authority')
})
test('capital accounting must use the security pool services authority', async () => {
	const fixture = capitalClient()
	fixture.setRead('services', modules.engine, capital)
	await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow('Capital ledger uses another services authority')
})

for (const [module, label] of [
	[modules.services, 'security pool services'],
	[modules.premium, 'resolution premium book'],
] as const) {
	test(`unrecognized ${label} code blocks security pool approval`, async () => {
		const fixture = capitalClient()
		fixture.codes.set(module, '0x6000')
		await expect(loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)).rejects.toThrow(`${label} runtime`)
	})
}
test('runtime masking requires repeated immutable instances to agree', () => {
	const refs = {
		'1': [
			{ start: 1, length: 1 },
			{ start: 3, length: 1 },
		],
	}
	expect(() => verifyRuntimeCode('0x60aa60aa', '0x60006000', refs, 'module')).not.toThrow()
	expect(() => verifyRuntimeCode('0x60aa60bb', '0x60006000', refs, 'module')).toThrow('Inconsistent')
	expect(() => verifyRuntimeCode('0x61aa60aa', '0x60006000', refs, 'module')).toThrow('Unrecognized')
})

test('setup readiness includes the separate fourth price-feed stage and rejects out-of-range stages', async () => {
	const fixture = capitalClient()
	fixture.setSetupStage(3n)
	expect((await loadSecurityPoolSetup(fixture.client, securityPool, owner)).stage).toBe(3)
	fixture.setSetupStage(4n)
	expect((await loadSecurityPoolSetup(fixture.client, securityPool, owner)).stage).toBe(4)
	fixture.setSetupStage(5n)
	await expect(loadSecurityPoolSetup(fixture.client, securityPool, owner)).rejects.toThrow('Invalid security pool setup stage')
})

test('claimable earnings include what the next checkpoint credits, read at the snapshot block', async () => {
	const fixture = capitalClient(capitalSnapshot())
	const credited = await loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)
	const position = credited.positions[0]
	if (position === undefined) throw new Error('Missing position')
	fixture.setRead('checkpoint', undefined)
	fixture.setRead('ownerAccount', { ...credited.ownerAccount, feesAttoEth: credited.ownerAccount.feesAttoEth + 5n, feesAttoRep: credited.ownerAccount.feesAttoRep })
	fixture.setRead('accountOf', { owner, batch: position.batch, rep: position.rep, commitment: position.commitment, maxHealthyPrice: position.maxHealthyPrice, releasedRep: position.releasedRep, ethFees: position.feesAttoEth + 2n, repFees: position.feesAttoRep + 3n, remainingCommitment: position.remainingCommitment })
	fixture.setRead('ownerAccount', credited.ownerAccount, capital)
	fixture.setRead('accountOf', { owner, batch: position.batch, rep: position.rep, commitment: position.commitment, maxHealthyPrice: position.maxHealthyPrice, releasedRep: position.releasedRep, ethFees: position.feesAttoEth, repFees: position.feesAttoRep, remainingCommitment: position.remainingCommitment }, index)
	const snapshot = await loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)
	expect(snapshot.accruedFeesAttoEth).toBe(credited.accruedFeesAttoEth)
	expect(snapshot.claimableEarnings).toEqual({ attoEth: credited.accruedFeesAttoEth + 7n, attoRep: credited.accruedFeesAttoRep + 3n })
	expect(new Set(fixture.multicallBlocks)).toEqual(new Set([snapshot.blockNumber]))
})

test('a failed earnings preview falls back to the credited amounts instead of hiding the account', async () => {
	const fixture = capitalClient(capitalSnapshot())
	const snapshot = await loadSecurityPoolAccount(fixture.client, securityPool, owner, 0n)
	expect(snapshot.claimableEarnings).toBeUndefined()
	expect(snapshot.positions).toHaveLength(1)
})
