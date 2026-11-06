import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { getContractOutput, getRecord, getString, loadContractsJson } from './contractArtifactHelpers'
const auctionSource = 'contracts/statoblast/SecurityPoolUniformPriceAuction.sol'
const auctionName = 'SecurityPoolUniformPriceAuction'
const eip170RuntimeCodeLimitBytes = 24_576

test('auction runtime stays within the EIP-170 limit', () => {
	const auction = getContractOutput(loadContractsJson(import.meta.dir), auctionSource, auctionName)
	const evm = getRecord(auction['evm'], 'Auction output is missing EVM bytecode')
	const deployedBytecode = getRecord(evm['deployedBytecode'], 'Auction output is missing deployed bytecode')
	const object = getString(deployedBytecode['object'], 'Auction deployed bytecode object missing')
	const deployedBytes = object.length / 2
	assert.ok(deployedBytes <= eip170RuntimeCodeLimitBytes, `auction runtime bytecode exceeds EIP-170 ${eip170RuntimeCodeLimitBytes.toString()} bytes: ${deployedBytes.toString()}`)
})
