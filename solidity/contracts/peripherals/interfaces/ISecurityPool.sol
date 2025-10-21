// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from "../openOracle/OpenOracle.sol";
import { Auction } from "../Auction.sol";
import { CompleteSet } from "../CompleteSet.sol";
import { ReputationToken } from "../../ReputationToken.sol";
import { PriceOracleManagerAndOperatorQueuer } from "../PriceOracleManagerAndOperatorQueuer.sol";

struct SecurityVault {
	uint256 repDepositShare;
	uint256 securityBondAllowance;
	uint256 unpaidEthFees;
	uint256 feeAccumulator;
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
	function questionId() external view returns (uint56);
	function universeId() external view returns (uint192);
	function zoltar() external view returns (Zoltar);
	function securityBondAllowance() external view returns (uint256);
	function completeSetCollateralAmount() external view returns (uint256);
	function repDenominator() external view returns (uint256);
	function repAtFork() external view returns (uint256);
	function migratedRep() external view returns (uint256);
	function securityMultiplier() external view returns (uint256);
	function feesAccrued() external view returns (uint256);
	function lastUpdatedFeeAccumulator() external view returns (uint256);
	function currentRetentionRate() external view returns (uint256);
	function securityPoolForkTriggeredTimestamp() external view returns (uint256);
	function securityVaults(address vault) external view returns (uint256 repDepositShare, uint256 securityBondAllowance, uint256 unpaidEthFees, uint256 feeAccumulator);
	function claimedAuctionProceeds(address vault) external view returns (bool);
	function children(uint256 index) external view returns (ISecurityPool);
	function parent() external view returns (ISecurityPool);
	function truthAuctionStarted() external view returns (uint256);
	function systemState() external view returns (SystemState);
	function completeSet() external view returns (CompleteSet);
	function truthAuction() external view returns (Auction);
	function repToken() external view returns (ReputationToken);
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function priceOracleManagerAndOperatorQueuer() external view returns (PriceOracleManagerAndOperatorQueuer);
	function openOracle() external view returns (OpenOracle);

	function repSharesToRep(uint256 repShares) external view returns (uint256);
	function repToRepShares(uint256 repAmount) external view returns (uint256);

	// -------- Mutative Functions --------
	function setStartingParams(uint256 currentRetentionRate, uint256 repEthPrice, uint256 completeSetCollateralAmount) external;

	function updateCollateralAmount() external;
	function updateRetentionRate() external;
	function updateVaultFees(address vault) external;
	function redeemFees(address vault) external;

	function performWithdrawRep(address vault, uint256 repAmount) external;
	function depositRep(uint256 repAmount) external;
	function performLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount) external;
	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) external;

	function createCompleteSet() external payable;
	function redeemCompleteSet(uint256 amount) external;

	function forkSecurityPool() external;
	function migrateVault(QuestionOutcome outcome) external;
	function migrateRepFromParent(address vault) external;
	function startTruthAuction() external;
	function finalizeTruthAuction() external;
	function claimAuctionProceeds(address vault) external;

	receive() external payable;
}

interface ISecurityPoolFactory {
	function deploySecurityPool(OpenOracle openOracle, ISecurityPool parent, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPoolAddress);
}
