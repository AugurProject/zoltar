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
	escalationGameCreationCodePartOne: '0x47b7df45744196388360a847f5bae40b39c25ceeea5af62f009ffb59b5c86cd3',
	escalationGameCreationCodePartTwo: '0x4353b6da3ced3961cfdfb922ca5498413b337e55bfa8341d5e31d4b38d8f0697',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
	oracleReportDelegate: '0xfe9632a17fb2292d3e7b5cc7b1060e0a4b06a12c5ba3a9e13fba15335d3f4092',
	priceCoordinatorCreationCodeFirstChunk: '0xd3be043ebe146053bcecfb6c0d4a14d3bf7f958508e3307980c648f56a45df95',
	priceCoordinatorCreationCodeSecondChunk: '0x70b4c429a27b733e17e494f36dc073daeb1c46927f5a4f94e694409f535007c7',
	securityPoolAuctionCreationCodeFirstChunk: '0xa4d131b6fd2dc31538ca28ee1f9fe758442b771fa8696331e5c76e5f2dd95748',
	securityPoolAuctionCreationCodeSecondChunk: '0xbb3d5959b2440cf48be49bdbb280db2538e364ddfc6fca38aa4125abc17c555c',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x4cd6636d44914f008e55434a789dba346c13a6146e25b3b94d9fbe93483ff8de',
	securityPoolCapitalCreationCodeSecondChunk: '0x69e781aa005f8742d8a3cdfb26c4b902eed7032dd24efeebd6a90b1444fae0b3',
	securityPoolCreationCodeFirstChunk: '0x01f1d4d61ef7c12d5a795b4fdb851dd337c30d5f937fd7e0c17a46eee3d50042',
	securityPoolCreationCodeSecondChunk: '0x521cf4be74b3f7e40f5f8d6f7e6669b6c73aaccba1bdeebab2779b2f552939a9',
	securityPoolForkCreationCodeFirstChunk: '0x24e14e35307cf8a58e781bb11bc122da9f030411710396e8aaac1925f1606c2d',
	securityPoolForkCreationCodeSecondChunk: '0x0596df0ea535727c1994cd09d5d50afc690f175a06ad7a0178edc0e749613ce7',
	securityPoolServicesCreationCodeFirstChunk: '0x55a33d73b9f42e4d6f703c077213edf4abad4c6ebe1416933b213cdb28539851',
	securityPoolServicesCreationCodeSecondChunk: '0x800f8c538ff1d99ffa134d806226a8a902f74f890edf08b411c0c0307b89309c',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b7f917f29579365b68d9694e306170f26471f15f190726952bd9ce9dd21a967',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfb43ef5f9b1dbcf433c8ca859fa67f4150f4499fa6dc8229e788dacc4466fc76',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x273c3b8f503ff165cb82c3dd1894ac8951f4702ff8fbb1f9c384c3d7abb0256b',
		securityPoolDeploymentWorker: '0x29be6703391e27f6a13fb1f1e5359713075783b59609151370075edbd26ee741',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x0187980f9644ae62e0ccbd6905aa318d050b36783e934b32ff0a3f99cde27f62',
		securityPoolDeploymentWorker: '0x3d99859c24969ba5fc973c27c5afb76c131ed1b7f14f714da48fd5669dce71f7',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd8ed01dbd6312aeeda9af1c7cd0d1916dbbb02b3ed5114d7082b2543a75cebe3',
		securityPoolDeploymentWorker: '0xeb6df062dda20dd017b23484812d3c45128d9bc9ddd8ef024dcc18e24de6ba91',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x773a51e2dafc617fe5cadeb87aba80916d98df0c23646d3e903e53f06375a82a',
		securityPoolDeploymentWorker: '0x2d859c5a4a06989579300796fb04111ccfdb1f8d77dfc86c34f352f652457c9a',
	},
	deterministic: {
		securityPoolDeployer: '0x22006f73470ff3d7a4de2afd9aaffcae8315e25839047e7005cb17df72a9ab03',
		securityPoolDeploymentWorker: '0x296db0121a61d53c021fed4f064dfb16eca2a5c5ce7c614a0a99dc5ed58b9138',
	},
	mainnet: {
		securityPoolDeployer: '0x109a4839d3f0600f1ebfd1fc3476e4486bb72dded80bb730f6818c4d74e92c12',
		securityPoolDeploymentWorker: '0xdf3be829acfa7c70350153618372fec1c47fd7bcc9505601e2be90450c66581e',
	},
}
