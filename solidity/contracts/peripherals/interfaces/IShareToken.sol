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
	function mintCompleteSets(uint248 _universeId, address _account, uint256 _cashAmount) external;
	function burnCompleteSets(uint248 _universeId, address _owner, uint256 _amount) external;
	function burnTokenIdAndGetRemainingSupply(
		uint256 _tokenId,
		address _owner
	) external returns (uint256 balance, uint256 remainingSupply);
	function totalSupplyForOutcome(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome
	) external view returns (uint256);
	function maximumOutcomeSupply(uint248 _universeId) external view returns (uint256);
	function balanceOfOutcome(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome,
		address _account
	) external view returns (uint256);
	function balanceOfShares(uint248 _universeId, address _account) external view returns (uint256[3] memory balances);
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
