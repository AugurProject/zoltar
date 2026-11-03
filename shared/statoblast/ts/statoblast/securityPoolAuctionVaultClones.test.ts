import { describe, expect, test } from 'bun:test'
import { getAddress, getCreate2Address, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { auctionVaultCreationCode, auctionVaultRuntimeCode, decodeAuctionVaultBindings, predictAuctionVaultAddress, verifyAuctionVaultCode } from './securityPoolAuctionVaultClones.js'

const implementation: Address = '0x1111111111111111111111111111111111111111'
const owner: Address = '0x2222222222222222222222222222222222222222'
const capital: Address = '0x3333333333333333333333333333333333333333'
const auction: Address = '0x4444444444444444444444444444444444444444'
const bindings = { implementation, owner, capital, auction, bidId: 7n }

describe('auction vault clones', () => {
	test('runtime code is the EIP-1167 forwarder followed by the four bindings', () => {
		const runtime = auctionVaultRuntimeCode(bindings)
		expect(runtime).toBe(`0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3${owner.slice(2)}${capital.slice(2)}${auction.slice(2)}${'0'.repeat(63)}7`)
		expect(runtime.length).toBe(2 + 137 * 2)
		expect(auctionVaultCreationCode(bindings)).toBe(`0x3d61008980600b3d3981f3${runtime.slice(2)}`)
	})
	test('the predicted address uses the auction as deployer and the bid as salt', () => {
		expect(predictAuctionVaultAddress(bindings)).toBe(getCreate2Address({ from: auction, salt: `0x${'0'.repeat(63)}7`, bytecode: auctionVaultCreationCode(bindings) }))
		expect(predictAuctionVaultAddress({ ...bindings, bidId: 8n })).not.toBe(predictAuctionVaultAddress(bindings))
		expect(() => predictAuctionVaultAddress({ ...bindings, bidId: -1n })).toThrow('uint256')
	})
	test('decoding accepts only exact clones and verification rejects every counterfeit', () => {
		const runtime = auctionVaultRuntimeCode(bindings)
		expect(decodeAuctionVaultBindings(runtime)).toEqual(bindings)
		const upper: Hex = `0x${runtime.slice(2).toUpperCase()}`
		expect(decodeAuctionVaultBindings(upper)).toEqual(bindings)
		expect(() => verifyAuctionVaultCode(runtime, bindings)).not.toThrow()
		for (const code of [undefined, '0x', `0x${runtime.slice(2)}00`, `0x00${runtime.slice(4)}`, auctionVaultRuntimeCode({ ...bindings, implementation: owner }), auctionVaultRuntimeCode({ ...bindings, bidId: 8n }), auctionVaultRuntimeCode({ ...bindings, owner: capital })] as const) {
			expect(decodeAuctionVaultBindings(code)).not.toEqual(bindings)
			expect(() => verifyAuctionVaultCode(code, bindings, 'position vault')).toThrow('Unrecognized position vault runtime code.')
		}
		expect(decodeAuctionVaultBindings(`0x00${runtime.slice(4)}`)).toBeUndefined()
		expect(decodeAuctionVaultBindings(auctionVaultRuntimeCode({ ...bindings, bidId: 8n }))).toEqual({ ...bindings, bidId: 8n })
		expect(decodeAuctionVaultBindings(auctionVaultRuntimeCode({ ...bindings, owner: getAddress(owner) }))?.owner).toBe(getAddress(owner))
	})
})
