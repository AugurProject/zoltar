// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from "../openOracle/OpenOracle.sol";
import { UniformPriceDualCapBatchAuction } from "../UniformPriceDualCapBatchAuction.sol";
import { IShareToken } from './IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';

struct SecurityVault {
	uint256 poolOwnership;
	uint256 securityBondAllowance;
	uint256 unpaidEthFees;
	uint256 feeIndex;
	uint256 lockedRepInEscalationGame;
}

enum SystemState {
	Operational,
	PoolForked,
	ForkMigration,
	ForkTruthAuction
}

enum QuestionOutcome {
	Invalid,
	Yes,
	No
}

interface ISecurityPool {

	// -------- View Functions --------
	function questionId() external view returns (uint256);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (Zoltar);
	function totalSecurityBondAllowance() external view returns (uint256);
	function completeSetCollateralAmount() external view returns (uint256);
	function poolOwnershipDenominator() external view returns (uint256);
	function securityMultiplier() external view returns (uint256);
	function totalFeesOwedToVaults() external view returns (uint256);
	function lastUpdatedFeeAccumulator() external view returns (uint256);
	function currentRetentionRate() external view returns (uint256);
	function securityVaults(address vault) external view returns (uint256 poolOwnership, uint256 securityBondAllowance, uint256 unpaidEthFees, uint256 feeIndex, uint256 lockedRepInEscalationGame);
	function parent() external view returns (ISecurityPool);
	function systemState() external view returns (SystemState);
	function shareToken() external view returns (IShareToken);
	function repToken() external view returns (ReputationToken);
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function priceOracleManagerAndOperatorQueuer() external view returns (PriceOracleManagerAndOperatorQueuer);
	function openOracle() external view returns (OpenOracle);
	function shareTokenSupply() external view returns (uint256);

	function sharesToCash(uint256 completeSetAmount) external view returns (uint256);
	function cashToShares(uint256 eth) external view returns (uint256);

	function repToPoolOwnership(uint256 repAmount) external view returns (uint256);
	function poolOwnershipToRep(uint256 poolOwnership) external view returns (uint256);

	function setStartingParams(uint256 currentRetentionRate, uint256 repEthPrice, uint256 completeSetCollateralAmount) external;

	function updateCollateralAmount() external;
	function updateRetentionRate() external;
	function updateVaultFees(address vault) external;
	function redeemFees(address vault) external;

	function performWithdrawRep(address vault, uint256 repAmount) external;
	function depositRep(uint256 repAmount) external;
	function redeemRep(address vault) external;
	function performLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount) external;
	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) external;

	function createCompleteSet() external payable;
	function redeemCompleteSet(uint256 amount) external;

	function escalationGame() external view returns (EscalationGame);
	function activateForkMode() external;
	function setSystemState(SystemState newState) external;
	function configureVault(address vault, uint256 poolOwnership, uint256 securityBondAllowance, uint256 feeIndex) external;
	function setOwnershipDenominator(uint256 newDenominator) external;
	function feeIndex() external view returns (uint256);
	function setTotalShares(uint256 newTotalShares) external;
	function setPoolFinancials(uint256 newCollateral, uint256 newTotalBondAllowance) external;
	function authorizeChildPool(ISecurityPool pool) external;
	function questionData() external view returns (ZoltarQuestionData);
	function drainAllRep() external;
	function transferEth(address payable receiver, uint256 amount) external;

	function securityPoolForker() external view returns (address);

	receive() external payable;
}

interface ISecurityPoolFactory {
	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction);
	function deployOriginSecurityPool(uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice) external returns (ISecurityPool securityPool);
}
