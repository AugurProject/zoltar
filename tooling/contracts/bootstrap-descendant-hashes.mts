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
	securityPoolAuctionCreationCodeFirstChunk: '0x47d9fa8acd196d5d9fc471e20d6f2b6a3c619eebe5b1c0c0491712213e858673',
	securityPoolAuctionCreationCodeSecondChunk: '0xd5a7fc6106d229f78f6618850e5cdbe012bafd48134b2580e71c04858cc3457a',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x6b9dfaf589800052661ace577daf2ac7e7bb2343edcbacc57bc8c8c8c74d766a',
	securityPoolCapitalCreationCodeSecondChunk: '0xa72f84ae7410e9df3c92f8ed5a29c6081156c5b20d4a1093abf5bb8a8335627b',
	securityPoolCreationCodeFirstChunk: '0x8efd1f85a6788769b72b3c45aca4d527b5e5c4e83c0bdd5126032735b630607c',
	securityPoolCreationCodeSecondChunk: '0xb6742714ec4a3509af11d8f81f63903e7fa774f277e6d994fe81fef300818c84',
	securityPoolForkCreationCodeFirstChunk: '0x544fd4541944bda324764167f9f42a7303169a7bdde8636cec2de1c0d11085fb',
	securityPoolForkCreationCodeSecondChunk: '0x88df96a29690b05009fcbda1d32e9b85618bae99a720e514009dc0c43402b531',
	securityPoolServicesCreationCodeFirstChunk: '0x41c9c934fb9c8c7e2e298052060021d9e8ca3b06eadc6c1f0e52edf4acbdb0ca',
	securityPoolServicesCreationCodeSecondChunk: '0x9ed519bd621f709bf32fd20f42b9b2c737ec7362dd236089df96ca87370da694',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x0d15ad7ffdd68e196ce13bbc5e2e25b4d9c0a1b1a54b8bab60e478fbb6c961c7',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x6f6a3f77e05696d6760e20c7013acfd144ebbe39178ddaacff5f858349b87f45',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x253d40a26406943fe8e8be99681866a842d114a7b9c9bbd69ef789c94362d8dc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xf933c10391e3508d350fe2b78c9cad8d6c40a4971deba5605233077e1ef65b58',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xac3af5c14e7823e4d2bca08b330e98fcc554aeb54cbcd6fcbf85ee5da0f7cb5a',
		securityPoolDeploymentWorker: '0x9908665fc8f7dcd675d2cf17a2ebc2b16ced9f8379ab46d26e7509cfc77b1ec9',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x72300cb3c01463c91ed9ab65c8e670dc3450d7058bde285314d7a58b5c92ef6e',
		securityPoolDeploymentWorker: '0x925e298466e54aba3fcb171eefd0f2a8f267dd141384d57d2cd76e1fda09826e',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc43cac1fbf499963a5e74146085f6b96e617261b60842b8e612ca6a866c10eed',
		securityPoolDeploymentWorker: '0xbb8e1467d4f56b56cbb3b73c8469dd76080137c2dff98888a7d0b3d043fd8dea',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x9f47ec8ae455516c711a40219d439c9e605dd256b3c518825c9aef9d978c7598',
		securityPoolDeploymentWorker: '0x166d9871025b2253ec95cc637aa5aa1560ce940c4dcf937d50e9ca9b03f880f1',
	},
	deterministic: {
		securityPoolDeployer: '0x4b7024e84d16170bd84c83e759f74890c2e4c0968ccc95061cb867cbca7832a9',
		securityPoolDeploymentWorker: '0x25acddcb482c22e27d3698d4fe2f528227c0fb9c4051dd1e4930f41a2d664444',
	},
	mainnet: {
		securityPoolDeployer: '0xf43565d4757af8f5a6b71f7bf2d91dcd5db5c8a968081d8d2a0192c658c4d16e',
		securityPoolDeploymentWorker: '0x0a018613c8486296f402d7f8ca208028190131953208512881eb8e3ed25ee0dd',
	},
}
