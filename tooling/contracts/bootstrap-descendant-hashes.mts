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
	securityPoolCapitalCreationCodeFirstChunk: '0xee2838d3c9358112036693a336d88d9ea594dc610c07ec51c31679eec0017760',
	securityPoolCapitalCreationCodeSecondChunk: '0x3d4a25469d37bf2a940c133fb08a5a280e0ebe03a6a78225a1c0651af00e1d8b',
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
		securityPoolDeployer: '0x955375bfa53837410c6ed868e5ec49be895ff19cee9f8ddfabe4966f15b04467',
		securityPoolDeploymentWorker: '0x2a9a82a637e16f15dc0cb45aef462f09630a119d2f6433efca3c866b1f028d2d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xed835b2baa21ef206615e7653b919e2bd4d14e6fed114188c8110f89d2268e6c',
		securityPoolDeploymentWorker: '0x440600e25b6ef68c55072dfb4c37993036f806f997dab36f2ef8bd446bdc2cfa',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc7d7938932e7ef3b1efd7b69d7982402416cd6745460323f961270f509224c6a',
		securityPoolDeploymentWorker: '0xe609e272e0dd5e8071adb0246406bdc4265580b83a9556c964e80eeb675ad5fa',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x11dde9c9454d7c29bf9c1978df6792cad86ed5eb1598e554dd089008171615cf',
		securityPoolDeploymentWorker: '0x3eb1b64b9fa2c1e559362b03dcb756626e4941fd3ad62d27a72e0e9386588e7b',
	},
	deterministic: {
		securityPoolDeployer: '0xb494d3cfe93d7d28d14b43aef91f7abb3816d69b79a921071a9c9b7f033d5df5',
		securityPoolDeploymentWorker: '0x63aecedf01b1eb973dd165e87dd3db537a77e3bd6f956cabdc9aac0dd6d971a2',
	},
	mainnet: {
		securityPoolDeployer: '0x93323dbdc95903abaadb0a150fab516d2d5b14d48b4d3b9f2a2a6cc2801a667f',
		securityPoolDeploymentWorker: '0x26ff34503946d8675dd2d3869e128c83cf342e3b9101affdcd6b39e53de1a1bc',
	},
}
