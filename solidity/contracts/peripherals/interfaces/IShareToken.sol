// SPDX-License-Identifier: UNLICENSE
pragma solidity 0.8.33;

import '../../Zoltar.sol';
import '../interfaces/ISecurityPool.sol';
import '../tokens/TokenId.sol';

interface IShareToken {
	function authorize(ISecurityPool _securityPoolCandidate) external;
	function mintCompleteSets(uint248 _universeId, address _account, uint256 _cashAmount) external payable;
	function burnCompleteSets(uint248 _universeId, address _owner, uint256 _amount) external;
	function burnTokenId(uint256 _tokenId, address _owner) external returns (uint256 balance);
	function getUniverse(uint256 _tokenId) external pure returns(uint256);
	function getOutcome(uint256 _tokenId) external pure returns(YesNoMarkets.Outcome);
	function totalSupplyForOutcome(uint248 _universeId, YesNoMarkets.Outcome _outcome) external view returns (uint256);
	function balanceOfOutcome(uint248 _universeId, YesNoMarkets.Outcome _outcome, address _account) external view returns (uint256);
	function balanceOfShares(uint248 _universeId, address _account) external view returns (uint256[3] memory balances);
	function getTokenId(uint248 _universeId, YesNoMarkets.Outcome _outcome) external pure returns (uint256 _tokenId);
	function getTokenIds(uint248 _universeId, YesNoMarkets.Outcome[] memory _outcomes) external pure returns (uint256[] memory _tokenIds);
	function unpackTokenId(uint248 _tokenId) external pure returns (uint248 _universe, YesNoMarkets.Outcome _outcome);
}
