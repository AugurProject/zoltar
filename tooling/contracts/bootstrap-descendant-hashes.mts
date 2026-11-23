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
	securityPoolCapitalCreationCodeFirstChunk: '0xddad5595574f79420a0b0178401d4b97362b9de49ba9daab5ad2c502577dd5c2',
	securityPoolCapitalCreationCodeSecondChunk: '0xfaa734c4f2a47aa17d234b44e095e42cd2ca314b051c56cf26ec2aed6436df40',
	securityPoolCreationCodeFirstChunk: '0x8efd1f85a6788769b72b3c45aca4d527b5e5c4e83c0bdd5126032735b630607c',
	securityPoolCreationCodeSecondChunk: '0xb6742714ec4a3509af11d8f81f63903e7fa774f277e6d994fe81fef300818c84',
	securityPoolForkCreationCodeFirstChunk: '0x544fd4541944bda324764167f9f42a7303169a7bdde8636cec2de1c0d11085fb',
	securityPoolForkCreationCodeSecondChunk: '0x88df96a29690b05009fcbda1d32e9b85618bae99a720e514009dc0c43402b531',
	securityPoolServicesCreationCodeFirstChunk: '0xe1f96579951849055f2be1561b348dd3d44f31f972b577093f53b03314747e54',
	securityPoolServicesCreationCodeSecondChunk: '0xb4cef0895618d155492a4dd0f502792e8e2d39174dae4715c82924a355fb8f5d',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xa6fa3f61abbc12017690fd9757923b2656d9b79288943d608ee1dcced1df5b67',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x00e72fd44837644dcaa517572d628231b4b80fab587184d3dde2ad39d6cf7709',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x40315b6aaa941ad5656f153c8ecb8b4d3c9ce34041b6c272762ee28c99adc607',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfcab2e9b86f2058bfaf64cf234b9bc544aa599e89fb8dfbc928ba644fdd7f8d3',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x129208ee27758e653089d3a3dcae76b1cb60a3b79e9d61d40f259629b8e4ffcb',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x3275e09b9d52c699aab520a5c93bd19201880beb401247273afd725e29bb4ec4',
		securityPoolDeploymentWorker: '0x421fcd9db8aec2c940009d4000598ec1ed18bd7993b3c8cd57759baef16b2f9c',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x445c538a5e7bfb2ea407651b815b7123c1bfb47f4f7c550f88a690df1ff7fe60',
		securityPoolDeploymentWorker: '0xd71b79b4697c6238750b739b2ef2652a77ec27ec5f5b97f4c419cfbb3e8de9ec',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x78e215242969a0bdf18385e1cd5dd6cc799bf9a36fbab4d4f1fae730bae9d681',
		securityPoolDeploymentWorker: '0x98a149996de2df7beea19f4a32bdbfea00e983f9eee88b436be9d4718cdf0ea9',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x725b819ae5f48aba467c54fd482e75edf2be9230fd5ebc4f97d8d079a95bc5d1',
		securityPoolDeploymentWorker: '0x33a748fd40895dc19829d7f612404571eb31bf61a7148ff6a42c9b060da2661a',
	},
	deterministic: {
		securityPoolDeployer: '0x1acd7ba5aec0a7b7c3370336e94f4080c7dfd94a758dac1bef1d4860338ab0df',
		securityPoolDeploymentWorker: '0xb74fa372da8576164495e76a2fb0dec8a0b289653df8ae78203f9d469a364775',
	},
	mainnet: {
		securityPoolDeployer: '0xe2169a865fd9473ba630f80c2f4f47827caeb710847dad5ebf98c53d98480a39',
		securityPoolDeploymentWorker: '0x2f94853e7bcfa1ef17f06ff73246035392014b5cd49ff2f1aa730e842c49c7a0',
	},
}
