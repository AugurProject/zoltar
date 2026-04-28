// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import '../../Constants.sol';
import './TokenId.sol';
import '../../Zoltar.sol';
import '../interfaces/ISecurityPool.sol';
import '../interfaces/IShareToken.sol';
import '../BinaryOutcomes.sol';
import './ERC1155.sol';

/**
* @title Share Token
* @notice ERC1155 contract to hold all share token balances
*/
contract ShareToken is ERC1155, IShareToken {

	string public name;
	string public symbol;
	Zoltar public immutable zoltar;
	mapping(address => bool) authorized;
	event Authorized(address indexed securityPool);
	event Migrate(address migrator, uint256 fromId, uint256 toId, uint256 fromIdBalance);

	function universeHasForked(uint248 universeId) internal view returns (bool) {
		return zoltar.getForkTime(universeId) > 0;
	}

	constructor(address owner, Zoltar _zoltar, uint256 questionId) {
		zoltar = _zoltar;
		string memory questionIdString = uintToString(questionId);
		name = string.concat('Shares-', questionIdString);
		symbol = string.concat('SHARE-', questionIdString);
		authorized[owner] = true;
	}

	function uintToString(uint256 value) internal pure returns (string memory) {
		if (value == 0) return '0';

		uint256 digits = 0;
		uint256 temp = value;
		while (temp != 0) {
			digits++;
			temp /= 10;
		}

		bytes memory buffer = new bytes(digits);
		while (value != 0) {
			digits--;
			buffer[digits] = bytes1(uint8(48 + value % 10));
			value /= 10;
		}
		return string(buffer);
	}

	function authorize(ISecurityPool _securityPoolCandidate) external {
		require(authorized[msg.sender], 'not authorized');
		authorized[address(_securityPoolCandidate)] = true;
		emit Authorized(address(_securityPoolCandidate));
	}

	function getUniverseId(uint256 id) internal pure returns (uint248 universeId) {
		assembly {
			universeId := shr(8, and(id, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00))
		}
	}

	function getChildId(uint256 originalId, uint248 newUniverse) internal pure returns (uint256 newId) {
		assembly {
			newId := or(and(originalId, 0xFF), shl(8, and(newUniverse, 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)))
		}
	}

	function mintCompleteSets(uint248 _universeId, address _account, uint256 _cashAmount) external {
		require(authorized[msg.sender] == true, 'not authorized');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, BinaryOutcomes.BinaryOutcome(i));
			_values[i] = _cashAmount;
		}

		_mintBatch(_account, _tokenIds, _values);
	}

	function burnCompleteSets(uint248 _universeId, address _owner, uint256 _amount) external {
		require(authorized[msg.sender] == true, 'not authorized');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, BinaryOutcomes.BinaryOutcome(i));
			_values[i] = _amount;
		}

		_burnBatch(_owner, _tokenIds, _values);
	}

	function burnTokenId(uint256 _tokenId, address _owner) external returns (uint256 balance) {
		require(authorized[msg.sender] == true, 'not authorized');
		balance = balanceOf(_owner, _tokenId);
		_burn(_owner, _tokenId, balance);
	}

	function getChildUniverseId(uint248 universeId, uint256 outcomeIndex) public pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
	}

	function totalSupplyForOutcome(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return totalSupply(_tokenId);
	}

	function balanceOfOutcome(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome, address _account) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return balanceOf(_account, _tokenId);
	}

	function balanceOfShares(uint248 _universeId, address _account) public view returns (uint256[3] memory balances) {
		balances[0] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.Invalid));
		balances[1] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.Yes));
		balances[2] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.No));
	}

	function getTokenId(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) public pure returns (uint256 _tokenId) {
		return TokenId.getTokenId(_universeId, _outcome);
	}

	function getTokenIds(uint248 _universeId, BinaryOutcomes.BinaryOutcome[] memory _outcomes) public pure returns (uint256[] memory _tokenIds) {
		return TokenId.getTokenIds(_universeId, _outcomes);
	}

	function unpackTokenId(uint256 _tokenId) public pure returns (uint248 _universe, BinaryOutcomes.BinaryOutcome _outcome) {
		return TokenId.unpackTokenId(_tokenId);
	}

	function migrate(uint256 fromId, uint256[] memory targetOutcomeIndexes) external {
		uint248 universeId = getUniverseId(fromId);
		require(universeHasForked(universeId), 'Universe has not forked');
		require(targetOutcomeIndexes.length > 0, 'No target outcomes');

		uint256 fromIdBalance = balanceOf(msg.sender, fromId);
		require(fromIdBalance > 0, 'No balance to migrate');

		// Burn from the old token ID using the base ERC1155 _burn function
		_burn(msg.sender, fromId, fromIdBalance);

		(, uint256 questionId, , , ) = zoltar.universes(universeId);
		for (uint256 i = 0; i < targetOutcomeIndexes.length; i++) {
			uint256 outcomeIndex = targetOutcomeIndexes[i];
			require(!zoltar.zoltarQuestionData().isMalformedAnswerOption(questionId, outcomeIndex), 'Malformed');

			for (uint256 j = 0; j < i; j++) {
				require(targetOutcomeIndexes[j] != outcomeIndex, 'Duplicate target outcome');
			}

			uint256 toId = getChildId(fromId, getChildUniverseId(universeId, outcomeIndex));
			_mint(msg.sender, toId, fromIdBalance);
			emit Migrate(msg.sender, fromId, toId, fromIdBalance);
		}
	}
}
