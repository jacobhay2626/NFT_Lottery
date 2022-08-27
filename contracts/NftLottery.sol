// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

error NotEnoughEthEntered();
error RaffleNotOpen();
error upKeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);
error NotOwner();

contract NftLottery is VRFConsumerBaseV2, KeeperCompatibleInterface, ERC721 {
    enum RaffleState {
        OPEN,
        CALCULATING
    }

    // LOTTERY VARIABLES
    uint256 immutable i_entranceFee;
    RaffleState private s_raffleState;
    address private s_recentWinner;
    uint256 private s_lastTimeStamp;
    uint256 private immutable i_interval;
    address public immutable i_owner;

    // STATE VARIABLES
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_keyHash;
    uint64 private immutable i_subscriptionId;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;
    address payable[] private s_players;

    // NFT VARIABLES
    uint256 public s_tokenCounter;
    string public constant TOKEN_URI =
        "ipfs://bafybeig37ioir76s7mg5oobetncojcm3c3hxasyd4rvid4jqhy4gkaheg4/?filename=0-PUG.json";

    // ------------------------------------------------------------

    //EVENTS
    event RaffleEntered(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event NftMinted(address winner, string TOKEN_URI);

    // ------------------------------------------------------------
    // LOTTERY

    constructor(
        address vrfCoordinatorV2,
        uint64 subscriptionId,
        bytes32 keyHash,
        uint256 interval,
        uint256 entranceFee,
        uint32 callbackGasLimit
    ) VRFConsumerBaseV2(vrfCoordinatorV2) ERC721("Dogie", "DOG") {
        i_entranceFee = entranceFee;
        s_raffleState = RaffleState.OPEN;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_keyHash = keyHash;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        i_interval = interval;
        s_tokenCounter = 0;
        s_lastTimeStamp = block.timestamp;
        i_owner = msg.sender;
    }

    // function that allows users to enter the raffle. When entering we want there to be an error if the amount they are paying is
    // below the entrance fee. Want players to only enter when we have the raffle open and once they are added we want to add them to
    // a list of players and emit an event.

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert NotEnoughEthEntered();
        }

        if (s_raffleState != RaffleState.OPEN) {
            revert RaffleNotOpen();
        }
        s_players.push(payable(msg.sender));

        emit RaffleEntered(msg.sender);
    }

    // Need this raffle to run automatically. Keeper Compatible Interface. checkUpkeep used to set some variables that are required in order for a random number request to be sent
    // When that request is sent a winner is then picked. Now need to try and add an NFT to the contract and assign the winner as the new owner of that minted NFT.
    // May be worth adding a withdraw function so that the Owner can take the funds from the raffle.

    function checkUpkeep(
        bytes memory /* checkData */
    )
        public
        view
        override
        returns (
            bool upkeepNeeded,
            bytes memory /** performData */
        )
    {
        bool isOpen = RaffleState.OPEN == s_raffleState;
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = s_players.length > 0;
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
    }

    function performUpkeep(
        bytes calldata /** performData */
    ) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert upKeepNotNeeded(address(this).balance, s_players.length, uint256(s_raffleState));
        }
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_keyHash,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );

        emit RequestedRaffleWinner(requestId);
    }

    function fulfillRandomWords(
        uint256, /*requestId*/
        uint256[] memory randomWords
    ) internal override {
        uint256 newTokenId = s_tokenCounter;
        uint256 indexofWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexofWinner];
        s_recentWinner = recentWinner;
        s_tokenCounter = s_tokenCounter + 1;

        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        s_players = new address payable[](0);

        _safeMint(recentWinner, newTokenId);

        emit NftMinted(recentWinner, TOKEN_URI);
    }

    // ------------------------------------------------------------
    // Getter functions

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS;
    }

    function getNumberPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    // ------------------------------------------------------------
    // NFT
    function tokenURI(
        uint256 /**  tokenId */
    ) public pure override returns (string memory) {
        return TOKEN_URI;
    }

    function getTokenCounter() public view returns (uint256) {
        return s_tokenCounter;
    }

    // ------------------------------------------------------------
}
