const { assert, expect } = require("chai")
const { deployments, getNamedAccounts, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", () => {
          let deployer, lottery, vrfCoordinatorV2Mock, lotteryEntranceFee, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              lottery = await ethers.getContract("NftLottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              lotteryEntranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          describe("Constructor", () => {
              it("initialises the lottery correctly", async () => {
                  const name = await lottery.name()
                  const symbol = await lottery.symbol()
                  const tokenCounter = await lottery.getTokenCounter()
                  const lotteryState = await lottery.getRaffleState()
                  assert.equal(name, "Dogie")
                  assert.equal(symbol, "DOG")
                  assert.equal(tokenCounter.toString(), "0")
                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(interval, networkConfig[chainId]["interval"])
              })
          })

          describe("enterRaffle", () => {
              it("reverts if you have not payed enough", async () => {
                  await expect(lottery.enterRaffle()).to.be.revertedWith("NotEnoughEthEntered")
              })
              it("records players when they enter", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  const NewPlayer = await lottery.getPlayer(0)
                  assert.equal(NewPlayer, deployer)
              })
              it("emits an event on entrance", async () => {
                  await expect(lottery.enterRaffle({ value: lotteryEntranceFee })).to.emit(
                      lottery,
                      "RaffleEntered"
                  )
              })
              it("reverts if the raffle is not open", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep([])
                  await expect(
                      lottery.enterRaffle({ value: lotteryEntranceFee })
                  ).to.be.revertedWith("RaffleNotOpen")
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if raffle is not open", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep([]) // Changes lottery state to calculating.
                  const lotteryState = await lottery.getRaffleState() // Now stored the state in this script so can use it.
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                  assert.equal(lotteryState.toString() == "1", upkeepNeeded == false)
              })
              it("returns false if no one has sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                  assert(!upkeepNeeded)
              })
              it("returns false if not enough time has passed", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 2])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                  assert.equal(upkeepNeeded, false)
              })
              it("returns true if it is open, has balance, has players and time has passed", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                  assert.equal(upkeepNeeded, true)
              })
          })
          describe("performUpkeep", function () {
              it("can only run if check up keep is true", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await lottery.performUpkeep("0x")
                  assert(tx)
              })
              it("sends an error if check up keep is false", async () => {
                  await expect(lottery.performUpkeep("0x")).to.be.revertedWith("upKeepNotNeeded")
              })
              it("updates the lottery state and emits a requestId", async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", []) // entered the raffle
                  const txResponse = await lottery.performUpkeep("0x") // emits request Id
                  const txReceipt = await txResponse.wait(1) // wait 1 block
                  const lotteryState = await lottery.getRaffleState() // updates the state
                  const requestId = txReceipt.events[1].args.requestId // get the request Id
                  assert(requestId.toNumber() > 0) // make sure we have a request id
                  assert(lotteryState == 1) // 0 = open, 1 = calculating
              })
          })
          describe("fulfillRandomWords", function () {
              beforeEach(async () => {
                  await lottery.enterRaffle({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("is only called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner and resets the lottery", async () => {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedLottery = await lottery.connect(accounts[i])
                      await accountConnectedLottery.enterRaffle({ value: lotteryEntranceFee })
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp()
                  console.log("//////////////////////////////////////////////")
                  await new Promise(async (resolve, reject) => {
                      lottery.once("NftMinted", async () => {
                          console.log("Found the event!")
                          try {
                              const recentWinner = await lottery.getRecentWinner()
                              console.log(recentWinner)
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[2].address)
                              console.log(accounts[3].address)
                              const lotteryState = await lottery.getRaffleState()
                              const endingTimeStamp = await lottery.getLatestTimeStamp()
                              const numPlayers = await lottery.getNumberPlayers()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(lotteryState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const tx = await lottery.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })

              it("mints an NFT to the winner", async () => {
                  await new Promise(async (resolve, reject) => {
                      lottery.once("NftMinted", async () => {
                          try {
                              const tokenUri = await lottery.tokenURI("0")
                              const tokenCounter = await lottery.getTokenCounter()
                              assert.equal(tokenUri.toString().includes("ipfs://"), true)
                              assert.equal(tokenCounter.toString(), "1")
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const tx = await lottery.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })
          })
      })

// 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 "Winner" address
