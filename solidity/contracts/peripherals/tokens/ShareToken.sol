// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../Constants.sol';
import './TokenId.sol';
import '../../Zoltar.sol';
import '../interfaces/ISecurityPool.sol';
import '../interfaces/IShareToken.sol';
import '../BinaryOutcomes.sol';
import '../SecurityPoolUtils.sol';
import './ERC1155.sol';

/**
 * @title Share Token
 * @notice ERC1155 contract to hold all share token balances
 */
contract ShareToken is ERC1155, IShareToken {
	string public name;
	string public symbol;
	Zoltar public immutable zoltar;
	mapping(address => bool) private authorized;
	event Migrate(address indexed migrator, uint256 indexed fromId, uint256 indexed toId, uint256 fromIdBalance);

	constructor(address owner, Zoltar _zoltar, uint256 questionId) {
		zoltar = _zoltar;
		string memory questionIdString = uintToString(questionId);
		name = string.concat('Shares-', questionIdString);
		symbol = string.concat('SHARE-', questionIdString);
		authorized[owner] = true;
		emit AuthorizationUpdated(owner, msg.sender, true);
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
			buffer[digits] = bytes1(uint8(48 + (value % 10)));
			value /= 10;
		}
		return string(buffer);
	}

	function authorize(ISecurityPool _securityPoolCandidate) external {
		require(authorized[msg.sender], 'ShareToken caller is not authorized to add another authorized pool');
		if (authorized[address(_securityPoolCandidate)]) return;
		authorized[address(_securityPoolCandidate)] = true;
		emit AuthorizationUpdated(address(_securityPoolCandidate), msg.sender, true);
	}

	function isAuthorized(address account) external view returns (bool) {
		return authorized[account];
	}

	function getUniverseId(uint256 id) internal pure returns (uint248 universeId) {
		assembly {
			universeId := shr(8, and(id, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00))
		}
	}

	function getChildId(uint256 originalId, uint248 newUniverse) internal pure returns (uint256 newId) {
		assembly {
			newId := or(
				and(originalId, 0xFF),
				shl(8, and(newUniverse, 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF))
			)
		}
	}

	function mintCompleteSets(uint248 _universeId, address _account, uint256 _cashAmount) external {
		require(authorized[msg.sender] == true, 'ShareToken caller is not authorized to mint complete sets');
		(bool isReconciled, ) = _getActualCompleteSetSupply(_universeId);
		require(isReconciled, 'Share supply mismatch');
		require(_cashAmount > 0, 'Exchange rate undefined');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, BinaryOutcomes.BinaryOutcome(i));
			_values[i] = _cashAmount;
		}

		_mintBatch(_account, _tokenIds, _values);
	}

	function burnCompleteSets(uint248 _universeId, address _owner, uint256 _amount) external {
		require(authorized[msg.sender] == true, 'ShareToken caller is not authorized to burn complete sets');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, BinaryOutcomes.BinaryOutcome(i));
			_values[i] = _amount;
		}

		_burnBatch(_owner, _tokenIds, _values);
	}

	function burnTokenIdAndGetRemainingSupply(
		uint256 _tokenId,
		address _owner
	) external returns (uint256 balance, uint256 remainingSupply) {
		require(authorized[msg.sender] == true, 'ShareToken caller is not authorized to burn this token id');
		balance = balanceOf(_owner, _tokenId);
		_burn(_owner, _tokenId, balance);
		remainingSupply = totalSupply(_tokenId);
	}

	function getChildUniverseId(uint248 universeId, uint256 outcomeIndex) public pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
	}

	function totalSupplyForOutcome(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome
	) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return totalSupply(_tokenId);
	}

	function _getActualCompleteSetSupply(
		uint248 _universeId
	) private view returns (bool isReconciled, uint256 actualSupply) {
		actualSupply = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.Invalid);
		uint256 yesSupply = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.Yes);
		uint256 noSupply = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.No);
		isReconciled = actualSupply == yesSupply && yesSupply == noSupply;
	}

	function maximumOutcomeSupply(uint248 _universeId) external view returns (uint256 maximumSupply) {
		maximumSupply = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.Invalid);
		uint256 yesSupply = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.Yes);
		uint256 noSupply = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.No);
		if (yesSupply > maximumSupply) maximumSupply = yesSupply;
		if (noSupply > maximumSupply) maximumSupply = noSupply;
	}

	function balanceOfOutcome(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome,
		address _account
	) public view returns (uint256) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return balanceOf(_account, _tokenId);
	}

	function balanceOfShares(uint248 _universeId, address _account) public view returns (uint256[3] memory balances) {
		balances[0] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.Invalid));
		balances[1] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.Yes));
		balances[2] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.No));
	}

	function getTokenId(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome _outcome
	) public pure returns (uint256 _tokenId) {
		return TokenId.getTokenId(_universeId, _outcome);
	}

	function getTokenIds(
		uint248 _universeId,
		BinaryOutcomes.BinaryOutcome[] calldata _outcomes
	) external pure returns (uint256[] memory _tokenIds) {
		return TokenId.getTokenIds(_universeId, _outcomes);
	}

	function unpackTokenId(
		uint256 _tokenId
	) public pure returns (uint248 _universe, BinaryOutcomes.BinaryOutcome _outcome) {
		return TokenId.unpackTokenId(_tokenId);
	}

	function migrate(uint256 fromId, uint256[] calldata targetOutcomeIndexes) external {
		uint248 universeId = getUniverseId(fromId);
		uint256 forkTime = zoltar.getForkTime(universeId);
		require(forkTime > 0, 'ShareToken universe has not forked, so shares cannot migrate');
		require(block.timestamp <= forkTime + SecurityPoolUtils.MIGRATION_TIME, 'ShareToken migration window closed');
		require(targetOutcomeIndexes.length > 0, 'ShareToken migration requires at least one target outcome');

		uint256 fromIdBalance = balanceOf(msg.sender, fromId);
		require(fromIdBalance > 0, 'ShareToken holder has no balance to migrate from the source token id');

		// Burn from the old token ID using the base ERC1155 _burn function
		_burn(msg.sender, fromId, fromIdBalance);

		(, uint256 questionId, , , ) = zoltar.universes(universeId);
		uint256 targetOutcomeIndexesLength = targetOutcomeIndexes.length;
		uint256 previousOutcomeIndex;
		for (uint256 i = 0; i < targetOutcomeIndexesLength; i++) {
			uint256 outcomeIndex = targetOutcomeIndexes[i];
			require(
				!zoltar.zoltarQuestionData().isMalformedAnswerOption(questionId, outcomeIndex),
				'ShareToken target outcome is malformed for the fork question'
			);
			if (i > 0)
				require(
					outcomeIndex > previousOutcomeIndex,
					'ShareToken target outcomes must be provided in strictly increasing order'
				);
			previousOutcomeIndex = outcomeIndex;

			uint256 toId = getChildId(fromId, getChildUniverseId(universeId, outcomeIndex));
			_mint(msg.sender, toId, fromIdBalance);
			emit Migrate(msg.sender, fromId, toId, fromIdBalance);
		}
	}
}
