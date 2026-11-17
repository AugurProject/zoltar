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
	escalationGameCreationCodePartOne: '0x751b397bda35e9cbb1d566bfe152c8fff349d50148c2f83693e983fb082ac8ed',
	escalationGameCreationCodePartTwo: '0xda0f685a17b91fe41c94234c902cfcbea8bbc48b914346a43a016d0fcb641dd6',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x87c68ce4be02c1314cc2a3c96d4695e5dad0f3db7ae14a73849cacbe5b31d3a6',
	securityPoolAuctionCreationCodeSecondChunk: '0xa7f49f45e915eb19883fa960924d7a1c05eebb9f5a3e2528289c35535da53e32',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x7c8ec28a6693042a8926610b4c881cd3061aaf6509908e5d7943fe10266bba52',
	securityPoolCapitalCreationCodeSecondChunk: '0x9103e96bdd650d00065a5ba80ac3f18ec1e69c0df49163dea3922a787ee09667',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0x24e14e35307cf8a58e781bb11bc122da9f030411710396e8aaac1925f1606c2d',
	securityPoolForkCreationCodeSecondChunk: '0x0596df0ea535727c1994cd09d5d50afc690f175a06ad7a0178edc0e749613ce7',
	securityPoolServicesCreationCodeFirstChunk: '0x371e8597095a8ecb960a2a782a640c210945c15604cccaba74bd2ea98b804d74',
	securityPoolServicesCreationCodeSecondChunk: '0x585dedf4cb5de39e1288ff755671dcb53942117dc99b3de2d7734ac0fc33b151',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x2e565462c2a57ee4aa914554302a4d31b221ded3528629ce04b95b76d59cdbeb',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x1036a565aa5e1c14af2c309b7338ace43e83e692ba00e3c46220094588e1075d',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xb3c0f546c68d2d1fd59114b2235a12ff8bbd66979a12acec75cc4e20fb20faa0',
		securityPoolDeploymentWorker: '0x0fc31bbb191ceed56f5dc36b8cfc40146e19aba1e5c8f3a43e5613dfe9eb93eb',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa4aa5abc5dddcd309c229dc12f53d60f2c167757c50c6bdbfea881695853ba10',
		securityPoolDeploymentWorker: '0x1b2271f07f0f7d75cba61126d18ed00a39fa3bfcb51a8caf6595578cfb221b59',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x8eddbfcb42429a7f97fcec96cd2521efbfeeac123a04c99f828aa4054b302131',
		securityPoolDeploymentWorker: '0x0f4cc7aa00fc186445dc2330026ada488732ff0faf2c3533d327c1490a3c4208',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x8336900ae67664e94d89ae8560939e7872245a89a56eb6bbc81b1acde62f66a7',
		securityPoolDeploymentWorker: '0x84c817fae06c5a6009e3e3155655e5bd6e24b7bd89ac2c2f07a964121d534715',
	},
	deterministic: {
		securityPoolDeployer: '0x1402a50f5bbd647275006aa2c7ea494beff22742b89f870adf51b33d45b05987',
		securityPoolDeploymentWorker: '0xae5573e173c003757730351b70fa77323dbe4f97db464dfeacfabcfa843a24e0',
	},
	mainnet: {
		securityPoolDeployer: '0xf5e27618d99f60ff413ff3965361d6323807bd2ab654de82219c75bf3a657680',
		securityPoolDeploymentWorker: '0x04da7c49c1dac74a9ae2ef02bd66ddb233363618735a3bc79ab8524f715a1269',
	},
}
