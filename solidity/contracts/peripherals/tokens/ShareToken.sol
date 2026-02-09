// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import '../../Constants.sol';
import './ForkedERC1155.sol';
import './TokenId.sol';
import '../../Zoltar.sol';
import '../interfaces/ISecurityPool.sol';
import '../interfaces/IShareToken.sol';

/**
* @title Share Token
* @notice ERC1155 contract to hold all share token balances
*/
contract ShareToken is ForkedERC1155, IShareToken {

	string constant public name = 'Shares';
	string constant public symbol = 'SHARE';
	Zoltar public immutable zoltar;
	mapping(address => bool) authorized;

	function universeHasForked(uint248 universeId) internal override view returns (bool) {
		return zoltar.getForkTime(universeId) > 0;
	}

	constructor(address owner, Zoltar _zoltar) {
		zoltar = _zoltar;
		authorized[owner] = true;
	}

	function authorize(ISecurityPool _securityPoolCandidate) external {
		require(authorized[msg.sender], 'caller is not owner');
		authorized[address(_securityPoolCandidate)] = true;
	}

	function getUniverseId(uint256 id) internal override pure returns (uint248 universeId) {
		assembly {
			universeId := shr(8, and(id, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00))
		}
	}

	function getChildId(uint256 originalId, uint248 newUniverse) internal override pure returns (uint256 newId) {
		assembly {
			newId := or(and(originalId, 0xFF), shl(8, and(newUniverse, 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)))
		}
	}

	function mintCompleteSets(uint248 _universeId, address _account, uint256 _cashAmount) external payable {
		require(authorized[msg.sender] == true, 'not authorized');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, YesNoMarkets.Outcome(i));
			_values[i] = _cashAmount;
		}

		_mintBatch(_account, _tokenIds, _values);
	}

	function burnCompleteSets(uint248 _universeId, address _owner, uint256 _amount) external {
		require(authorized[msg.sender] == true, 'not authorized');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, YesNoMarkets.Outcome(i));
			_values[i] = _amount;
		}

		_burnBatch(_owner, _tokenIds, _values);
	}

	function burnTokenId(uint256 _tokenId, address _owner) external returns (uint256 balance) {
		require(authorized[msg.sender] == true, 'not authorized');
		balance = balanceOf(_owner, _tokenId);
		_burn(_owner, _tokenId, balance);
	}

	function getUniverse(uint256 _tokenId) external pure returns(uint256) {
		(uint248 _universe, ) = TokenId.unpackTokenId(_tokenId);
		return _universe;
	}

	function getOutcome(uint256 _tokenId) external pure returns(YesNoMarkets.Outcome) {
		(, YesNoMarkets.Outcome _outcome) = TokenId.unpackTokenId(_tokenId);
		return _outcome;
	}

	function totalSupplyForOutcome(uint248 _universeId, YesNoMarkets.Outcome _outcome) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return totalSupply(_tokenId);
	}

	function balanceOfOutcome(uint248 _universeId, YesNoMarkets.Outcome _outcome, address _account) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return balanceOf(_account, _tokenId);
	}

	function balanceOfShares(uint248 _universeId, address _account) public view returns (uint256[3] memory balances) {
		balances[0] = balanceOf(_account, getTokenId(_universeId, YesNoMarkets.Outcome.Invalid));
		balances[1] = balanceOf(_account, getTokenId(_universeId, YesNoMarkets.Outcome.Yes));
		balances[2] = balanceOf(_account, getTokenId(_universeId, YesNoMarkets.Outcome.No));
	}

	function getTokenId(uint248 _universeId, YesNoMarkets.Outcome _outcome) public pure returns (uint256 _tokenId) {
		return TokenId.getTokenId(_universeId, _outcome);
	}

	function getTokenIds(uint248 _universeId, YesNoMarkets.Outcome[] memory _outcomes) public pure returns (uint256[] memory _tokenIds) {
		return TokenId.getTokenIds(_universeId, _outcomes);
	}

	function unpackTokenId(uint248 _tokenId) public pure returns (uint248 _universe, YesNoMarkets.Outcome _outcome) {
		return TokenId.unpackTokenId(_tokenId);
	}
}
