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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x8903ae3fb778f64f52cd9fb0de21ad48750589a306a7bbecb226249cb329ae0d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x08d55607462bc937a3228a07ab4a4c8294403476e31187a00d5473ef343a7d51',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x40315b6aaa941ad5656f153c8ecb8b4d3c9ce34041b6c272762ee28c99adc607',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfcab2e9b86f2058bfaf64cf234b9bc544aa599e89fb8dfbc928ba644fdd7f8d3',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x129208ee27758e653089d3a3dcae76b1cb60a3b79e9d61d40f259629b8e4ffcb',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x69a63f992d87a62fee2d69a62cac13c134bff237d42255020673beace31f51d0',
		securityPoolDeploymentWorker: '0xb55b629196420f9343810e4cb63c8dda7207f6cbd218f4a45ffcb18a2ee5c6a8',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x910446985dfa69f5f84aaa730a0570d9b10f855f0da19a15972dc7d1c446a5bf',
		securityPoolDeploymentWorker: '0x7e7425b35be075f481df0c95dc6e2b4f65945a45c135b3ebf38621b745077892',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x89e8c8ef6dbea81ef9d2b9ed6ccc1ee7d163ffd19fb9530d3d46c30fa217ed29',
		securityPoolDeploymentWorker: '0x48562e9002999c10b325418098cfaf5e4a93e5ce7666b4f7d7c5ce1c5de55d3a',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x7f790dbad501adf2dedea1928b5b9c837e97c75ed5b1d9a6bd7f476ddf2a1c24',
		securityPoolDeploymentWorker: '0x40ed43a488803f86bb59e79c7b0a5ba48ab35a1ec4e75a45e3c7da389333a8c4',
	},
	deterministic: {
		securityPoolDeployer: '0xd119b16bd76b42ebb20db6e47e01701904ec94071702082514551c99f4eaf7e8',
		securityPoolDeploymentWorker: '0x9d5e6847037b0df2335e09e22746c45eebc19a220fb13c22fe84c8fd09027bee',
	},
	mainnet: {
		securityPoolDeployer: '0x034d733c448f6665fdf634b4b49b5be648ce64cae4064a2f319b4ef26f17e667',
		securityPoolDeploymentWorker: '0x0eb1071e6d5e947720dfbeb55fda5e76423614e0dc2f8736ed16a41759ffa8de',
	},
}
