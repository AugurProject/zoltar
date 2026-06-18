import { applyLibraries, getInfraContractAddresses } from './deployPeripherals'
import { addressString, bytes32String } from '../bigint'
import { Address, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256 } from 'viem'
import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../../types/contractArtifact'
import { TEST_ADDRESSES } from '../constants'

export const getUniformPriceDualCapBatchAuctionAddress = (owner: Address, deployer: Address = addressString(TEST_ADDRESSES[0])) =>
	getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			bytecode: applyLibraries(peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.evm.bytecode.object),
			args: [owner],
		}),
		from: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
		salt: keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [deployer, bytes32String(0n)])),
	})
