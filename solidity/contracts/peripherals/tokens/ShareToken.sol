// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import '../../Constants.sol';
import './ForkedERC1155.sol';
import './TokenId.sol';
import '../../Zoltar.sol';
import '../interfaces/ISecurityPool.sol';

/**
* @title Share Token
* @notice ERC1155 contract to hold all share token balances
*/
contract ShareToken is ForkedERC1155, IShareToken {

	string constant public name = "Shares";
	string constant public symbol = "SHARE";
	Zoltar public immutable zoltar;
	uint56 public immutable questionId;
	mapping(address => bool) authorized;

	function universeHasForked(uint192 universeId) internal override view returns (bool) {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		return forkTime > 0;
	}

	constructor(address owner, Zoltar _zoltar, uint56 _questionId) {
		zoltar = _zoltar;
		questionId = _questionId;
		authorized[owner] = true;
	}

	function authorize(ISecurityPool _securityPoolCandidate) external {
		require(authorized[msg.sender], 'caller is not owner');
		authorized[address(_securityPoolCandidate)] = true;
	}

	function getUniverseId(uint256 id) internal override pure returns (uint192 universeId) {
		assembly {
			universeId := shr(64, and(id, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000000000000000))
		}
	}

	function getChildId(uint256 originalId, uint192 newUniverse) internal override pure returns (uint256 newId) {
		assembly {
			newId := or(shr(192, shl(192, originalId)), shl(64, newUniverse))
		}
	}

	function mintCompleteSets(uint192 _universeId, address _account, uint256 _cashAmount) external payable {
		require(authorized[msg.sender] == true, 'not authorized');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, Zoltar.Outcome(i));
			_values[i] = _cashAmount;
		}

		_mintBatch(_account, _tokenIds, _values);
	}

	function burnCompleteSets(uint192 _universeId, address _owner, uint256 _amount) external {
		require(authorized[msg.sender] == true, 'not authorized');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, Zoltar.Outcome(i));
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
		(uint192 _universe, ) = TokenId.unpackTokenId(_tokenId);
		return _universe;
	}

	function getOutcome(uint256 _tokenId) external pure returns(Zoltar.Outcome) {
		(, Zoltar.Outcome _outcome) = TokenId.unpackTokenId(_tokenId);
		return _outcome;
	}

	function totalSupplyForOutcome(uint192 _universeId, Zoltar.Outcome _outcome) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return totalSupply(_tokenId);
	}

	function totalSupplyForUniverse(uint192 _universeId) public view returns (uint256) {
		// todo, here we might want the getWinningOutcome to just return none if not finalized?
		if (zoltar.isFinalized(_universeId, questionId)) {
			return totalSupply(getTokenId(_universeId, zoltar.getWinningOutcome(_universeId, questionId)));
		}
		return totalSupply(getTokenId(_universeId, Zoltar.Outcome.Yes));
	}

	function balanceOfOutcome(uint192 _universeId, Zoltar.Outcome _outcome, address _account) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return balanceOf(_account, _tokenId);
	}

	function balanceOfShares(uint192 _universeId, address _account) public view returns (uint256[3] memory balances) {
		balances[0] = balanceOf(_account, getTokenId(_universeId, Zoltar.Outcome.Invalid));
		balances[1] = balanceOf(_account, getTokenId(_universeId, Zoltar.Outcome.Yes));
		balances[2] = balanceOf(_account, getTokenId(_universeId, Zoltar.Outcome.No));
	}

	function getTokenId(uint192 _universeId, Zoltar.Outcome _outcome) public pure returns (uint256 _tokenId) {
		return TokenId.getTokenId(_universeId, _outcome);
	}

	function getTokenIds(uint192 _universeId, Zoltar.Outcome[] memory _outcomes) public pure returns (uint256[] memory _tokenIds) {
		return TokenId.getTokenIds(_universeId, _outcomes);
	}

	function unpackTokenId(uint256 _tokenId) public pure returns (uint256 _universe, Zoltar.Outcome _outcome) {
		return TokenId.unpackTokenId(_tokenId);
	}
}
