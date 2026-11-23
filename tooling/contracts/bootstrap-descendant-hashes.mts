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
	securityPoolCapitalCreationCodeFirstChunk: '0x5556a5b3b13439471050e7ad60227accbd3694b35fd208aaf57cd122952d6fa6',
	securityPoolCapitalCreationCodeSecondChunk: '0x4edb8b1f69274c3488610d7f79eeabd9e240ec576e0dd819f42a94b92a9b07e6',
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
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc198c1d980403e98a29348eb0a11ae525d70d9bd84023f9bb9c5c4a7fb9159d3',
		securityPoolDeploymentWorker: '0xe0baa0c11de0121ed7884d14e28f80146351fa1486441267e96f2a6f83a01756',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x5d9a4401cb7a5752c73cfcf5ba245db33eddaa54559bd3e10279a959725c15ee',
		securityPoolDeploymentWorker: '0x312d712890585e945b2a65ecff92b6f5b43258b9652b7166fe52e3315fa60310',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x3bf093ee6c3789a89a6abf4d23669e602b044be515a119d87925f483ab0e6223',
		securityPoolDeploymentWorker: '0x7a73cb97c03c9ff610abd56f11826ec9133c0f21f5de9766d283c2f056b43137',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x6ca8bc48c4ba4066866dd514b8242cd58ff16f17fccad1fcafde9cadd6d3bc12',
		securityPoolDeploymentWorker: '0xd839d94c66d7999a0906293d0520848b301c50f33d995c9d0f2685d9ca06cc4f',
	},
	deterministic: {
		securityPoolDeployer: '0x05abaafda0b16a34c4657b37997e21aa6bed1181157b72ccf1d014779f2ba441',
		securityPoolDeploymentWorker: '0xf837abc0d0a435a7130d5f50b41282a2440a612636cad66633c74c9220b6ccf0',
	},
	mainnet: {
		securityPoolDeployer: '0xd63a6e39b2ac50a66cac1adf1342e8ed3f40d584114ce4a2c1d8b1e8bb158ef4',
		securityPoolDeploymentWorker: '0x4cd97f31b8d663e752282a7c6dac063dd75da3ea41e8f914dd6156dbb846c59a',
	},
}
