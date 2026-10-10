import { SEPOLIA_REP_ALLOCATIONS } from '@zoltar/zoltar-shared/deployment/sepoliaRepAllocations'
import { encodeDeployData, getCreate2Address, toHex } from '@zoltar/core-shared/evm/ethereum'
import { GenesisReputationToken_GenesisReputationToken } from '../contractArtifact.js'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'

const PROXY_DEPLOYER_ADDRESS = '0x7A0D94F55792C434D74A40883c6ED8545e406D12'
const ZERO_SALT = toHex(0, { size: 32 })

function genesisRepInitCode(outcome: GenesisOutcome) {
	// The proxy deployer always uses salt zero. Reversing the constructor lists
	// gives No its own token while preserving every holder's allocation.
	const allocations = outcome === 'yes' ? SEPOLIA_REP_ALLOCATIONS : [...SEPOLIA_REP_ALLOCATIONS].reverse()
	return encodeDeployData({
		abi: GenesisReputationToken_GenesisReputationToken.abi,
		bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
		args: [allocations.map(allocation => allocation.address), allocations.map(allocation => allocation.amount)],
	})
}

export const SEPOLIA_GENESIS_REP_ADDRESS = getSepoliaGenesisRepDeployment('yes').address

export function getSepoliaGenesisRepDeployment(outcome: GenesisOutcome) {
	const initCode = genesisRepInitCode(outcome)
	return {
		address: getCreate2Address({ bytecode: initCode, from: PROXY_DEPLOYER_ADDRESS, salt: ZERO_SALT }),
		initCode,
		salt: ZERO_SALT,
	}
}
