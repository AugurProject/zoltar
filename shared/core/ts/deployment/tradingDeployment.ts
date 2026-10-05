import { type Abi, type Address, encodeDeployData, getCreate2Address, type Hex, toHex } from '../evm/ethereum.js'

type DeploymentArtifact = Readonly<{ abi: Abi; bytecode: Hex }>

/** Canonical Trading roots use the proxy deployer, zero salt, and a 0.30% fee. */
export const CANONICAL_TRADING_FEE_BPS = 30

export function tradingDeploymentData(proxyDeployer: Address, securityPoolFactory: Address, feeBps: number, factory: DeploymentArtifact, router: DeploymentArtifact) {
	if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	const salt = toHex(0, { size: 32 })
	const factoryData = encodeDeployData({ abi: factory.abi, bytecode: factory.bytecode, args: [securityPoolFactory, BigInt(feeBps)] })
	const factoryAddress = getCreate2Address({ bytecode: factoryData, from: proxyDeployer, salt })
	const routerData = encodeDeployData({ abi: router.abi, bytecode: router.bytecode, args: [factoryAddress] })
	const routerAddress = getCreate2Address({ bytecode: routerData, from: proxyDeployer, salt })
	return { factoryAddress, factoryData, routerAddress, routerData }
}
