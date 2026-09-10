import { getCreateAddress } from '@zoltar/core-shared/evm/ethereum';
import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses';
export function createInfraContractAddressHelper(config) {
    const getInfraContractAddresses = () => {
        const addresses = {
            multicall3: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.multicall3Bytecode),
            securityPoolUtils: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolUtilsBytecode),
            openOracle: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOracleBytecode),
            zoltarQuestionData: config.getZoltarQuestionDataAddress(),
            zoltar: config.getZoltarAddress(),
            shareTokenFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getShareTokenFactoryByteCode(config.getZoltarAddress())),
            priceOracleManagerAndOperatorQueuerFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.priceOracleManagerAndOperatorQueuerFactoryBytecode()),
            securityPoolForker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getSecurityPoolForkerByteCode(config.getZoltarAddress())),
            escalationGameClaimDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.escalationGameClaimDelegateBytecode),
            scalarOutcomes: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.scalarOutcomesBytecode),
            uniformPriceDualCapBatchAuctionFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.uniformPriceDualCapBatchAuctionFactoryBytecode),
        };
        const escalationGameFactory = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate));
        const securityPoolOperationsDelegate = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolOperationsDelegateBytecode);
        const escalationGameProofVerifier = getCreateAddress({
            from: escalationGameFactory,
            nonce: 1n,
        });
        return {
            ...addresses,
            escalationGameFactory,
            escalationGameProofVerifier,
            securityPoolOperationsDelegate,
            securityPoolFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getSecurityPoolFactoryByteCode({
                escalationGameFactory,
                openOracle: addresses.openOracle,
                priceOracleManagerAndOperatorQueuerFactory: addresses.priceOracleManagerAndOperatorQueuerFactory,
                securityPoolForker: addresses.securityPoolForker,
                securityPoolOperationsDelegate,
                shareTokenFactory: addresses.shareTokenFactory,
                uniformPriceDualCapBatchAuctionFactory: addresses.uniformPriceDualCapBatchAuctionFactory,
                zoltar: addresses.zoltar,
                zoltarQuestionData: addresses.zoltarQuestionData,
            })),
        };
    };
    return {
        getInfraContractAddresses,
    };
}
