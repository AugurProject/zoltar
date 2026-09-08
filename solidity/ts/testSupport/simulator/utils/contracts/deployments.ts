import { applyLibraries, getInfraContractAddresses } from './deployStatoblast'
import { addressString, bytes32String } from '../bigint'
import { getCallerScopedSalt } from '@zoltar/core-shared/evm/addressDerivation'
import { Address, encodeDeployData, getCreate2Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../../types/contractArtifact'
import { TEST_ADDRESSES } from '../constants'

export const getUniformPriceDualCapBatchAuctionAddress = (owner: Address, deployer: Address = addressString(TEST_ADDRESSES[0])) =>
	getCreate2Address({
		bytecode: encodeDeployData({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			bytecode: applyLibraries(statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.evm.bytecode.object),
			args: [owner],
		}),
		from: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
		salt: getCallerScopedSalt(deployer, bytes32String(0n)),
	})
