// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import '../interfaces/ISecurityPool.sol';
import '../../Zoltar.sol';

/**
* @title IShareToken
* @notice Interface for the ShareToken contract
*/
interface IShareToken {

	// Read-only metadata
	function name() external view returns (string memory);
	function symbol() external view returns (string memory);
	function zoltar() external view returns (Zoltar);

	// Security pool registration
	function authorize(ISecurityPool _securityPoolCandidate) external;

	// Question operations
	function mintCompleteSets(uint192 _universeId, address _account, uint256 _cashAmount) external payable;
	function burnCompleteSets(uint192 _universeId, address _owner, uint256 _amount) external;
	function burnTokenId(uint256 _tokenId, address _owner) external returns (uint256);

	// TokenId information helpers
	function getUniverse(uint256 _tokenId) external pure returns (uint256);
	function getOutcome(uint256 _tokenId) external pure returns (Zoltar.Outcome);

	// Balance and supply queries
	function totalSupplyForOutcome(uint192 _universeId, Zoltar.Outcome _outcome) external view returns (uint256);
	function balanceOfOutcome(uint192 _universeId, Zoltar.Outcome _outcome, address _account) external view returns (uint256);
	function balanceOfShares(uint192 _universeId, address _account) external view returns (uint256[3] memory balances);

	// Token ID encoding/decoding
	function getTokenId(uint192 _universeId, Zoltar.Outcome _outcome) external pure returns (uint256 _tokenId);
	function getTokenIds(uint192 _universeId, Zoltar.Outcome[] memory _outcomes) external pure returns (uint256[] memory _tokenIds);
	function unpackTokenId(uint256 _tokenId) external pure returns (uint256 _universe, Zoltar.Outcome _outcome);
}
