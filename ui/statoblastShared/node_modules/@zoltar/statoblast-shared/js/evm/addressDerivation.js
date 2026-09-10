import { encodeAbiParameters, getCreate2Address, getCreateAddress, keccak256, numberToBytes, zeroAddress } from '@zoltar/core-shared/evm/ethereum';
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '../initialReport/oracleInitialReport.js';
import { getCallerScopedSalt } from '@zoltar/core-shared/evm/addressDerivation';
function getSecurityPoolSalt(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas) {
    return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas]));
}
export function getSecurityPoolOriginId(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) {
    return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId]));
}
function getSecurityPoolDeployerAddress(securityPoolFactory) {
    return getCreateAddress({
        from: securityPoolFactory,
        // The factory creates only its deployment helper.
        nonce: 1n,
    });
}
function getSecurityPoolDeploymentWorkerAddress(securityPoolFactory) {
    return getCreateAddress({
        from: getSecurityPoolDeployerAddress(securityPoolFactory),
        // The deployer creates the event emitter, then its deployment worker.
        nonce: 2n,
    });
}
export function createSecurityPoolAddressHelper(config) {
    const getSecurityPoolAddresses = (parent, universeId, questionId, statoblastSecurityMultiplierBps, originUniverseId = 0n, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) => {
        const infraContracts = config.getInfraContracts();
        const securityPoolSalt = getSecurityPoolSalt(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
        const securityPoolSaltWithMsgSender = getCallerScopedSalt(infraContracts.securityPoolFactory, securityPoolSalt);
        const repToken = config.getRepTokenAddress(universeId);
        const priceOracleManagerAndOperatorQueuer = getCreate2Address({
            bytecode: config.getPriceOracleManagerAndOperatorQueuerInitCode(infraContracts.openOracle, repToken, initialReportPriorityFeeAttoEthPerGas),
            // The factory creates the registry deployer first and the coordinator
            // deployment worker second in its constructor.
            from: getCreateAddress({ from: infraContracts.priceOracleManagerAndOperatorQueuerFactory, nonce: 2n }),
            salt: securityPoolSaltWithMsgSender,
        });
        const shareToken = getCreate2Address({
            bytecode: config.getShareTokenInitCode(infraContracts.securityPoolFactory, infraContracts.zoltar, questionId),
            from: infraContracts.shareTokenFactory,
            salt: getSecurityPoolOriginId(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas),
        });
        const truthAuction = parent === zeroAddress
            ? zeroAddress
            : getCreate2Address({
                bytecode: config.getTruthAuctionInitCode(infraContracts.securityPoolForker),
                from: infraContracts.uniformPriceDualCapBatchAuctionFactory,
                salt: securityPoolSaltWithMsgSender,
            });
        const securityPool = getCreate2Address({
            bytecode: config.getSecurityPoolInitCode({
                escalationGameFactory: infraContracts.escalationGameFactory,
                openOracle: infraContracts.openOracle,
                parent,
                priceOracleManagerAndOperatorQueuer,
                questionId,
                statoblastSecurityMultiplierBps,
                securityPoolFactory: infraContracts.securityPoolFactory,
                securityPoolForker: infraContracts.securityPoolForker,
                shareToken,
                truthAuction,
                universeId,
                zoltar: infraContracts.zoltar,
                zoltarQuestionData: infraContracts.zoltarQuestionData,
            }),
            from: getSecurityPoolDeploymentWorkerAddress(infraContracts.securityPoolFactory),
            salt: numberToBytes(0, { size: 32 }),
        });
        const escalationGame = getCreate2Address({
            bytecode: config.getEscalationGameInitCode(securityPool, repToken, infraContracts.escalationGameProofVerifier),
            from: infraContracts.escalationGameFactory,
            salt: numberToBytes(0, { size: 32 }),
        });
        return {
            escalationGame,
            priceOracleManagerAndOperatorQueuer,
            securityPool,
            shareToken,
            truthAuction,
        };
    };
    return {
        getSecurityPoolAddresses,
    };
}
