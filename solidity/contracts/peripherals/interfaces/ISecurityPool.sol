// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from "../openOracle/OpenOracle.sol";
import { Auction } from "../Auction.sol";
import { IShareToken } from "./IShareToken.sol";
import { ReputationToken } from "../../ReputationToken.sol";
import { PriceOracleManagerAndOperatorQueuer } from "../PriceOracleManagerAndOperatorQueuer.sol";
import { EscalationGame } from '../EscalationGame.sol';

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
	function marketId() external view returns (uint256);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (Zoltar);
	function totalSecurityBondAllowance() external view returns (uint256);
	function completeSetCollateralAmount() external view returns (uint256);
	function poolOwnershipDenominator() external view returns (uint256);
	function securityMultiplier() external view returns (uint256);
	function totalFeesOvedToVaults() external view returns (uint256);
	function lastUpdatedFeeAccumulator() external view returns (uint256);
	function currentRetentionRate() external view returns (uint256);
	function securityVaults(address vault) external view returns (uint256 poolOwnership, uint256 securityBondAllowance, uint256 unpaidEthFees, uint256 feeIndex, uint256 lockedRepInEscalationGame);
	function claimedAuctionProceeds(address vault) external view returns (bool);
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

	// -------- Mutative Functions --------
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

	function escalationGame() external returns (EscalationGame);
	function setRetentionRate(uint256 newRetention) external;
	function setSystemState(SystemState newState) external;
	function setVaultOwnership(address vault, uint256 _poolOwnership, uint256 _securityBondAllowance) external;

	function setVaultSecurityBondAllowance(address vault, uint256 _securityBondAllowance) external;
	function addToTotalSecurityBondAllowance(uint256 securityBondAllowanceDelta) external;
	function setPoolOwnershipDenominator(uint256 _poolOwnershipDenominator) external;
	function setVaultPoolOwnership(address vault, uint256 poolOwnership) external;
	function setVaultFeeIndex(address vault, uint256 newFeeIndex) external;
	function feeIndex() external view returns (uint256);
	function setShareTokenSupply(uint256 newShareTokenSupply) external;
	function setCompleteSetCollateralAmount(uint256 newCompleteSetCollateralAmount) external;
	function setTotalSecurityBondAllowance(uint256 newTotalSecurityBondAllowance) external;

	receive() external payable;
}

interface ISecurityPoolFactory {
	function deployChildSecurityPool(IShareToken shareToken, uint248 universeId, uint256 marketId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool);
	function deployOriginSecurityPool(uint248 universeId, string memory extraInfo, uint256 marketEndDate, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool);
}
