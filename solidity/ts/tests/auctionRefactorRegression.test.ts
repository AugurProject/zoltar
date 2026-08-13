import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

const auctionSource = 'contracts/peripherals/UniformPriceDualCapBatchAuction.sol'
const auctionName = 'UniformPriceDualCapBatchAuction'
const auctionRuntimeBytecodeBudgetBytes = 15_360

test('auction storage extraction preserves every host slot and node field position', () => {
	const auction = getContractOutput(loadContractsJson(import.meta.dir), auctionSource, auctionName)
	const layout = normalizeStorageLayout(auction)
	assert.deepStrictEqual(
		layout.map(entry => ({ label: entry.label, slot: entry.slot, offset: entry.offset })),
		[
			{ label: 'nodes', slot: '0', offset: 0 },
			{ label: 'bidsAtTick', slot: '1', offset: 0 },
			{ label: 'refundedBidPrefixTree', slot: '2', offset: 0 },
			{ label: 'root', slot: '3', offset: 0 },
			{ label: 'nextId', slot: '4', offset: 0 },
			{ label: 'maxAttoRepBeingSold', slot: '5', offset: 0 },
			{ label: 'attoEthRaiseCap', slot: '5', offset: 11 },
			{ label: 'finalized', slot: '5', offset: 27 },
			{ label: 'clearingTick', slot: '5', offset: 28 },
			{ label: 'ethFilledAtClearingAttoEth', slot: '6', offset: 0 },
			{ label: 'totalAttoRepPurchased', slot: '6', offset: 16 },
			{ label: 'attoEthRaised', slot: '7', offset: 0 },
			{ label: 'auctionStarted', slot: '8', offset: 0 },
			{ label: 'minBidSizeAttoEth', slot: '8', offset: 6 },
			{ label: 'underfunded', slot: '8', offset: 22 },
			{ label: 'underfundedThreshold', slot: '9', offset: 0 },
			{ label: 'underfundedWinningAttoEth', slot: '10', offset: 0 },
			{ label: 'activeTickCount', slot: '11', offset: 0 },
			{ label: 'seenTicks', slot: '12', offset: 0 },
			{ label: 'hasSeenTick', slot: '13', offset: 0 },
			{ label: 'bidderBidRefs', slot: '14', offset: 0 },
			{ label: 'pendingEthRefundsAttoEth', slot: '15', offset: 0 },
		],
	)
	const nodes = layout[0]
	if (nodes === undefined || !('value' in nodes.type)) throw new Error('Auction node mapping layout is missing')
	const nodeType = getRecord(nodes.type.value, 'Auction node mapping value is invalid')
	const members = getArray(nodeType.members, 'Auction node layout is missing members')
	assert.deepStrictEqual(
		members.map((member, index) => {
			const value = getRecord(member, `Invalid auction node member ${index.toString()}`)
			return { label: getString(value.label, 'Auction node member label missing'), slot: getString(value.slot, 'Auction node member slot missing'), offset: value.offset }
		}),
		[
			{ label: 'tick', slot: '0', offset: 0 },
			{ label: 'totalBidAttoEth', slot: '1', offset: 0 },
			{ label: 'subtreeBidAttoEth', slot: '2', offset: 0 },
			{ label: 'left', slot: '3', offset: 0 },
			{ label: 'right', slot: '4', offset: 0 },
			{ label: 'height', slot: '5', offset: 0 },
			{ label: 'subtreeClearingBidAttoEth', slot: '6', offset: 0 },
			{ label: 'minClearingTick', slot: '7', offset: 0 },
		],
	)
})

test('auction extraction stays inside the audited runtime bytecode budget', () => {
	const auction = getContractOutput(loadContractsJson(import.meta.dir), auctionSource, auctionName)
	const evm = getRecord(auction.evm, 'Auction output is missing EVM bytecode')
	const deployedBytecode = getRecord(evm.deployedBytecode, 'Auction output is missing deployed bytecode')
	const object = getString(deployedBytecode.object, 'Auction deployed bytecode object missing')
	const deployedBytes = object.length / 2
	assert.ok(deployedBytes <= auctionRuntimeBytecodeBudgetBytes, `auction runtime bytecode exceeds ${auctionRuntimeBytecodeBudgetBytes.toString()} bytes: ${deployedBytes.toString()}`)
})

test('liquidation boundaries expose one typed request with one nested snapshot', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const boundaries: Array<[string, string, string, number]> = [
		['contracts/peripherals/SecurityPool.sol', 'SecurityPool', 'performLiquidation', 8],
		['contracts/peripherals/SecurityPoolLiquidationDelegate.sol', 'SecurityPoolLiquidationDelegate', 'performBundledLiquidation', 8],
	]
	for (const [source, contract, functionName, expectedTopLevelComponents] of boundaries) {
		const output = getContractOutput(artifacts, source, contract)
		const abi = getArray(output.abi, `${contract} ABI missing`)
		const entry = abi.map((item, index) => getRecord(item, `${contract} ABI entry ${index.toString()} invalid`)).find(item => item.type === 'function' && item.name === functionName)
		if (entry === undefined) throw new Error(`${contract}.${functionName} ABI missing`)
		const inputs = getArray(entry.inputs, `${contract}.${functionName} inputs missing`)
		assert.strictEqual(inputs.length, 1, `${contract}.${functionName} should accept one typed request`)
		const request = getRecord(inputs[0], `${contract}.${functionName} request input invalid`)
		assert.strictEqual(getArray(request.components, `${contract}.${functionName} request components missing`).length, expectedTopLevelComponents)
	}
})
