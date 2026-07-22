// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../Constants.sol';
import './TokenId.sol';
import '../../Zoltar.sol';
import '../interfaces/ISecurityPool.sol';
import '../interfaces/ISecurityPoolForker.sol';
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
	mapping(address => bool) private authorized;
	mapping(uint248 => ISecurityPool) public canonicalPoolByUniverse;
	// Forked source shares remain as branch-independent entitlements. Once an
	// account materializes any branch, its source balance is locked so a transfer
	// cannot let both sender and receiver reproduce the same claim.
	mapping(uint256 => mapping(uint248 => mapping(address => uint256))) private migratedShareAmount;
	mapping(uint256 => mapping(address => bool)) private migratedSourceBalanceLocked;
	event Migrate(address indexed migrator, uint256 indexed fromId, uint256 indexed toId, uint256 shareAmount);

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
		require(
			address(_securityPoolCandidate.shareToken()) == address(this),
			'ShareToken candidate must use this share token'
		);
		uint248 candidateUniverseId = _securityPoolCandidate.universeId();
		ISecurityPool currentCanonicalPool = canonicalPoolByUniverse[candidateUniverseId];
		require(
			address(currentCanonicalPool) == address(0x0) ||
				address(currentCanonicalPool) == address(_securityPoolCandidate),
			'ShareToken universe already has a canonical pool'
		);
		if (authorized[address(_securityPoolCandidate)]) return;
		canonicalPoolByUniverse[candidateUniverseId] = _securityPoolCandidate;
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

	function getMigratedShareAmount(
		uint256 fromId,
		uint248 targetUniverseId,
		address account
	) external view returns (uint256) {
		return migratedShareAmount[fromId][targetUniverseId][account];
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
		require(zoltar.getForkTime(universeId) > 0, 'ShareToken universe has not forked, so shares cannot migrate');
		require(targetOutcomeIndexes.length > 0, 'ShareToken migration requires at least one target outcome');

		uint256 fromIdBalance = balanceOf(msg.sender, fromId);
		require(fromIdBalance > 0, 'ShareToken holder has no balance to migrate from the source token id');

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
		}

		ISecurityPool sourcePool = canonicalPoolByUniverse[universeId];
		require(address(sourcePool) != address(0x0), 'ShareToken source universe is missing a canonical pool');
		ISecurityPoolForker forker = ISecurityPoolForker(sourcePool.securityPoolForker());
		if (sourcePool.systemState() == SystemState.Operational) {
			forker.initiateSecurityPoolFork(sourcePool);
		}
		require(sourcePool.systemState() == SystemState.PoolForked, 'ShareToken source pool cannot migrate');

		uint248[] memory targetUniverseIds = new uint248[](targetOutcomeIndexesLength);
		for (uint256 i = 0; i < targetOutcomeIndexesLength; i++) {
			uint256 outcomeIndex = targetOutcomeIndexes[i];
			uint248 targetUniverseId = getChildUniverseId(universeId, outcomeIndex);
			ISecurityPool targetPool = canonicalPoolByUniverse[targetUniverseId];
			if (address(targetPool) == address(0x0)) {
				require(targetOutcomeIndexesLength == 1, 'ShareToken bulk migration requires canonical child pools');
				forker.createChildUniverse(sourcePool, outcomeIndex);
				targetPool = canonicalPoolByUniverse[targetUniverseId];
			}
			require(
				address(targetPool) != address(0x0) && address(targetPool.parent()) == address(sourcePool),
				'ShareToken destination is missing a canonical child pool'
			);
			targetUniverseIds[i] = targetUniverseId;
		}

		bool migratedAnyShares;
		for (uint256 i = 0; i < targetOutcomeIndexesLength; i++) {
			uint248 targetUniverseId = targetUniverseIds[i];
			uint256 alreadyMigratedAmount = migratedShareAmount[fromId][targetUniverseId][msg.sender];
			require(alreadyMigratedAmount <= fromIdBalance, 'ShareToken migrated amount exceeds source balance');
			uint256 shareAmount = fromIdBalance - alreadyMigratedAmount;
			if (shareAmount == 0) continue;
			migratedShareAmount[fromId][targetUniverseId][msg.sender] = fromIdBalance;
			migratedSourceBalanceLocked[fromId][msg.sender] = true;
			migratedAnyShares = true;
			uint256 toId = getChildId(fromId, targetUniverseId);
			_mint(msg.sender, toId, shareAmount);
			emit Migrate(msg.sender, fromId, toId, shareAmount);
		}
		require(migratedAnyShares, 'ShareToken has no new shares to migrate');
	}

	function _internalTransferFrom(
		address from,
		address to,
		uint256 id,
		uint256 value,
		bytes memory data
	) internal override {
		require(!migratedSourceBalanceLocked[id][from], 'ShareToken migrated source balance is locked');
		super._internalTransferFrom(from, to, id, value, data);
	}

	function _internalBatchTransferFrom(
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory values,
		bytes memory data
	) internal override {
		for (uint256 i = 0; i < ids.length; i++) {
			require(!migratedSourceBalanceLocked[ids[i]][from], 'ShareToken migrated source balance is locked');
		}
		super._internalBatchTransferFrom(from, to, ids, values, data);
	}
}
