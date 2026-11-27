// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger } from '../interfaces/IQuestionLedger.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';

interface IShareToken {
	function balanceOfSecurityPoolRecoveryRights(uint248 sourceUniverse, address holder) external view returns (uint256[3] memory amountsAttoShares);
	function isSecurityPoolRecoveryEligible(uint248 sourceUniverse) external view returns (bool);
	function transferSecurityPoolRecoveryRights(uint248 sourceUniverse, address recipient, uint256[3] calldata amountsAttoShares) external;
	function consumeSecurityPoolRecoveryCompleteSets(uint248 sourceUniverse, address holder, uint256 amountAttoShares) external returns (uint256 cumulativeClaimedAttoShares);
	function recoveredCompleteSetShares(uint248 sourceUniverse, address holder) external view returns (uint256);
	/// @notice Resulting authorization for `account`.
	/// @param actor Constructor deployer for the initial owner authorization; already-authorized caller thereafter.
	event AuthorizationUpdated(address indexed account, address indexed actor, bool authorized);

	function authorize(IQuestionLedger _questionLedgerCandidate) external;
	function isAuthorized(address account) external view returns (bool);
	function canonicalQuestionLedgerByUniverse(uint248 universeId) external view returns (IQuestionLedger);
	function mintCompleteSets(uint248 _universeId, address _account, uint256 amountAttoShares) external;
	function burnCompleteSets(uint248 _universeId, address _owner, uint256 amountAttoShares) external;
	function burnTokenIdAndGetRemainingSupply(uint256 _tokenId, address _owner) external returns (uint256 balanceAttoShares, uint256 remainingSupplyAttoShares);
	function totalSupplyForOutcome(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) external view returns (uint256 totalSupplyAttoShares);
	function maximumOutcomeSupply(uint248 _universeId) external view returns (uint256 maximumSupplyAttoShares);
	function balanceOfOutcome(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome, address _account) external view returns (uint256 balanceAttoShares);
	function balanceOfShares(uint248 _universeId, address _account) external view returns (uint256[3] memory balancesAttoShares);
	function getMigratedShareAmountAttoShares(uint256 fromId, uint248 targetUniverseId, address account) external view returns (uint256);
	function getTokenId(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) external pure returns (uint256 _tokenId);
	function migrate(uint256 fromId, uint256[] calldata targetOutcomeIndexes) external;
}
