import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the security pool deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	escalationGameCreationCodePartOne: '0x9ce8bbbbb58322c517113486ffda6c8284009b056162d94d4884389716298dea',
	escalationGameCreationCodePartTwo: '0x10145f21db700f5ff094978a8a052d22b05b4fce18411596e0a68e642de3b8ac',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x9b15366af2f5f73eadb261dc037082e3d1e0b7ba293cf92498cc1579024c0809',
	priceCoordinatorCreationCodeSecondChunk: '0xc2b31bdf6480d9d297ed73ae8eadca6724d8ab0f7ed5a8b15d641d4f6979b984',
	securityPoolAuctionCreationCodeFirstChunk: '0x1dc1aa02b800ccab080a5560e47123bb734bd89e281f93497134da9bc99c2806',
	securityPoolAuctionCreationCodeSecondChunk: '0xe547d6ee4f33bb41ae52ba0783c81a06c5c77c44cc5f1710e5bfc2c0d3614ed2',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x9d8aacc0c3e7b1f188037ddfe11f920e8781255d4ebc6a9d2761e0562060b817',
	securityPoolCapitalCreationCodeSecondChunk: '0xc516cce7c8d53bcfaafa4fc7305ddaf86ee0b120486a2984e44287504c30a4f9',
	securityPoolCreationCodeFirstChunk: '0x8efd1f85a6788769b72b3c45aca4d527b5e5c4e83c0bdd5126032735b630607c',
	securityPoolCreationCodeSecondChunk: '0xb6742714ec4a3509af11d8f81f63903e7fa774f277e6d994fe81fef300818c84',
	securityPoolForkCreationCodeFirstChunk: '0x544fd4541944bda324764167f9f42a7303169a7bdde8636cec2de1c0d11085fb',
	securityPoolForkCreationCodeSecondChunk: '0x88df96a29690b05009fcbda1d32e9b85618bae99a720e514009dc0c43402b531',
	securityPoolServicesCreationCodeFirstChunk: '0xe1f96579951849055f2be1561b348dd3d44f31f972b577093f53b03314747e54',
	securityPoolServicesCreationCodeSecondChunk: '0xb4cef0895618d155492a4dd0f502792e8e2d39174dae4715c82924a355fb8f5d',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xbfc5e663f337c9ea5a0e814134d836340260554bc482b4b16ef4de83bc3da102',
	securityPoolSettlementBookCreationCodeSecondChunk: '0xe9329ac5abf2b0fe93ac231cd5978298e4691669aeaed8f051bce2bfc717c88d',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x40315b6aaa941ad5656f153c8ecb8b4d3c9ce34041b6c272762ee28c99adc607',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfcab2e9b86f2058bfaf64cf234b9bc544aa599e89fb8dfbc928ba644fdd7f8d3',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x746e5fca0778d7b6218df2b501bc2d4e23a22aeffbe232db642a934f95da7f90',
		securityPoolDeploymentWorker: '0x6d05f53d47f9cf94f977be6732545bd00c5715630bb4281f3649778a818266eb',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd51ffff681c09ee5ab68fc98328a9c9ab9249b36922341cad0ea3c342387bae1',
		securityPoolDeploymentWorker: '0x43f54c681707c3ed8c3f3a565fbe163c590124e06f6b5f5388117f8e30622099',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x88d567a370d14e4bc072cdd3b18eb6989b2a31c392158d218b7e026b7a907ae5',
		securityPoolDeploymentWorker: '0xdf0bf289e84c257f2d57f787a6f77323b4118361dfa4b704926f387e08c63f3b',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xa8ac5fbc7bdaed064e3eb787d82f5026a7c84422a9bf2a35a8242ae8e3858e88',
		securityPoolDeploymentWorker: '0x5a2f89e8233fac8fa9f99eb3b4e7268437f3be8e9e40a8f519ec387ac6cb126b',
	},
	deterministic: {
		securityPoolDeployer: '0x7472f9fb852069b86f21ce0adba7d87426e340d72395cde2920c989631a8de1a',
		securityPoolDeploymentWorker: '0xafc0a6233eb7dcce5bfa99bdc71f9d5c4cd1dfd3f0e03a12f0b727b75428afa4',
	},
	mainnet: {
		securityPoolDeployer: '0x025dc23d3bc84a6dd637d98d81c23f3eb90ee5c2ebbf766bcded9ef31d65ff5c',
		securityPoolDeploymentWorker: '0xe52a7e510697d5e7fca949898b4665d95b8e8c6d437bd204931a86ca6d6818dd',
	},
}
