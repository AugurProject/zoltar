import { applyLibraries, getInfraContractAddresses } from './deployPeripherals'
import { bytes32String } from '../bigint'
import { Address, encodeDeployData, getCreate2Address } from 'viem'
import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../../types/contractArtifact'

export const getUniformPriceDualCapBatchAuctionAddress = (owner: Address) =>
	getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			bytecode: applyLibraries(peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.evm.bytecode.object),
			args: [owner],
		}),
		from: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
		salt: bytes32String(0n),
	})
