// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../interfaces/ISecurityPool.sol';
import '../BinaryOutcomes.sol';

interface IShareToken {
	/// @notice Resulting authorization for `account`.
	/// @param actor Constructor deployer for the initial owner authorization; already-authorized caller thereafter.
	event AuthorizationUpdated(address indexed account, address indexed actor, bool authorized);

	function authorize(ISecurityPool _securityPoolCandidate) external;
	function isAuthorized(address account) external view returns (bool);
	function canonicalPoolByUniverse(uint248 universeId) external view returns (ISecurityPool);
	function mintCompleteSets(uint248 _universeId, address _account, uint256 amountAttoShares) external;
	function burnCompleteSets(uint248 _universeId, address _owner, uint256 amountAttoShares) external;
	function burnTokenIdAndGetRemainingSupply(
		uint256 _tokenId,
		address _owner
	) external returns (uint256 balanceAttoShares, uint256 remainingSupplyAttoShares);
	function totalSupplyForOutcome(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome
	) external view returns (uint256 totalSupplyAttoShares);
	function maximumOutcomeSupply(uint248 _universeId) external view returns (uint256 maximumSupplyAttoShares);
	function balanceOfOutcome(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome,
		address _account
	) external view returns (uint256 balanceAttoShares);
	function balanceOfShares(
		uint248 _universeId,
		address _account
	) external view returns (uint256[3] memory balancesAttoShares);
	function getMigratedShareAmountAttoShares(
		uint256 fromId,
		uint248 targetUniverseId,
		address account
	) external view returns (uint256);
	function getTokenId(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome
	) external pure returns (uint256 _tokenId);
	function getTokenIds(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome[] calldata _outcomes
	) external pure returns (uint256[] memory _tokenIds);
	function unpackTokenId(
		uint256 _tokenId
	) external pure returns (uint248 _universe, BinaryOutcomes.BinaryOutcome _outcome);
	function migrate(uint256 fromId, uint256[] calldata targetOutcomeIndexes) external;
}
