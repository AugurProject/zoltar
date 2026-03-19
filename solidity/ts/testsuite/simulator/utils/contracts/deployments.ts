import { applyLibraries, getInfraContractAddresses } from './deployPeripherals'
import { bytes32String } from '../bigint'
import { Address, encodeDeployData, getCreate2Address } from 'viem'
import { peripherals_DualCapBatchAuction_DualCapBatchAuction } from '../../../../types/contractArtifact'

export const getDualCapBatchAuctionAddress = (owner: Address) => getCreate2Address({
	bytecode: encodeDeployData({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		bytecode: applyLibraries(peripherals_DualCapBatchAuction_DualCapBatchAuction.evm.bytecode.object),
		args: [owner],
	}),
	from: getInfraContractAddresses().dualCapBatchAuctionFactory,
	salt: bytes32String(0n),
})
