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
	escalationGameCreationCodePartOne: '0xa07e152eaaee71039f89c1695ed96109c8fa5908d05d790a17adb1b02b72285f',
	escalationGameCreationCodePartTwo: '0xc58ba6aca30341eec66fc0fe245a7cb71acee8b06522c84b2d5269c246e6b8cd',
	escalationGameProofVerifier: '0x235118b92a5f4ccb5bb1ac27c7a3b46b1cb6ad08be2b5886ccf4a6f1d1574ad6',
	oracleReportDelegate: '0xefbc6256374267222b817f248cd7e59f1c0016aad69d03c028bd6aac2df5799e',
	priceCoordinatorCreationCodeFirstChunk: '0x69162fb9de65d0be10f739cfc2b63a461bf8ba8c264cad368dd089c156dba69c',
	priceCoordinatorCreationCodeSecondChunk: '0xdc50e4bf21c357ae88b36f64a808080cb695c28cc8d87393ce2f85119466060a',
	securityPoolAuctionCreationCodeFirstChunk: '0x64bc27f7987124acbc90a501f5af33708f998a812585d13b87744cbadd62edaa',
	securityPoolAuctionCreationCodeSecondChunk: '0x4c49590f8ca0a3a7225c0b22089172a6c35b7877cda18c5779bc153bb5a8a7f1',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x956857d60021b6384489560dd975c2a54110a2416a533fbd99f6e42fe2e2fec7',
	securityPoolCapitalCreationCodeSecondChunk: '0x1119d15b091f17c1179af6d85fb08bc6519d393c24cccf7542daafbb49ffa725',
	securityPoolCreationCodeFirstChunk: '0xa000cc7f9bf499633704f00cd69e7b81dbc484daf15f04d751bc6d683cfc416c',
	securityPoolCreationCodeSecondChunk: '0x8e2a373091e94120de726c9b8a7465c1e318d6e837bde3ddf7788b34c5fe6592',
	securityPoolForkCreationCodeFirstChunk: '0x03d4635993dc0b32cb5b36ca808319c43af1d80b15e1a65f8191d59c4cd90802',
	securityPoolForkCreationCodeSecondChunk: '0x1b3725b94aca0348ee54a973d2a92cab3a358509ade7bc9e1be778fa43f01d60',
	securityPoolServicesCreationCodeFirstChunk: '0xf34248553721e52ff790e2504e107182afdf53bbcfd35dfb34a1b50bb754333e',
	securityPoolServicesCreationCodeSecondChunk: '0x220503ab6b663858a9795d25329ce9cfeeac5695a00a0615ffabc1898c3d7c57',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xeca24a606cc6bef597506b06cf42291a9a0c1be691bc1fbddc7444892f0a870d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6770c7d2ce26afd14cd9fd17ecf7927010588cb41c515d36e40afe71ba16f8bf',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xea8a47d9363a8fa402a054dd78f6123aa85d498fc42465c8311ce75fb7025124',
	securityPoolCapitalFeeStreamsImplementation: '0x125afc056b05c8f7f4dfbf1a57886981429f8cede7c35ed85748f0ec63a12846',
	securityPoolCommitmentIndexImplementation: '0x053295b8a0ea2eb8602df08e4833e99a0fbcebf9edb0db8454df34948850239f',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x8e3763678feaee71d1c627b183f4ae0634e198a6d185b19a08e1e44161d81371',
		securityPoolDeploymentWorker: '0xa1c2b4e0f1df9cc4b3a456c9b2e3710b5d1e0896d3d445d49ecaef5ca44acea6',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x137c75cc55ce63eb60d87b768ef789731d711869cd7d79380a3c05618771943f',
		securityPoolDeploymentWorker: '0x1ce34b1dbd7d1fefb8ac667a8029bfefe60286e2ff78504ce335ffcd3c5e319b',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x61e69afd72e48995283040020f666806566fa271a790490f39c2bf3345433012',
		securityPoolDeploymentWorker: '0x63cbadb299c5835c765121c872209bdf03ff28a4c1e0ebc5538a24db109fad75',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x4448e8fde64381b433283a1a04e0c1c60a3ed3dd5d4b1ae2c71774799442d4fe',
		securityPoolDeploymentWorker: '0xc96f24255752fc1c283fdf67f82d5d9da0e2b580d9f1f2f66f469a8afdee7cbb',
	},
	deterministic: {
		securityPoolDeployer: '0xc0d754045772e7f47f8b8b5daa5ea94c9d8266d0d505ed0fbf05d032a006e52e',
		securityPoolDeploymentWorker: '0x778cd913f89719d92116bfc8389dac432b2b9d7c3aa100445e491485455a7178',
	},
	mainnet: {
		securityPoolDeployer: '0xbf79e724c4022a21c37091e75737804d60273706d7e7dc4842022b7c6cd73136',
		securityPoolDeploymentWorker: '0x243a20b81486953ab6fdeef05f873138ef5fb2344c36025f7d746df9d4cb53f1',
	},
}
