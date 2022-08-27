const { network, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../helper-hardhat-config")

const VRF_SUB_FUND_AMOUNT = ethers.utils.parseEther("2")

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId

    let vrfCoordinatorV2Address, subscriptionId
    const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")

    log("--------------------------------------------------")

    if (developmentChains.includes(network.name)) {
        vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address
        const txResponse = await vrfCoordinatorV2Mock.createSubscription()
        const txReceipt = await txResponse.wait(1)
        subscriptionId = txReceipt.events[0].args.subId
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMOUNT)
    } else {
        vrfCoordinatorV2Address = networkConfig[chainId]["vrfCoordinatorV2"]
        subscriptionId = networkConfig[chainId]["subscriptionId"]
    }

    log("--------------------------------------------------")

    const entranceFee = networkConfig[chainId]["raffleEntranceFee"]
    const keyHash = networkConfig[chainId]["keyHash"]
    const callbackGasLimit = networkConfig[chainId]["callbackGasLimit"]
    const interval = networkConfig[chainId]["interval"]

    args = [
        vrfCoordinatorV2Address,
        subscriptionId,
        keyHash,
        interval,
        entranceFee,
        callbackGasLimit,
    ]

    log("--------------------------------------------------")
    log("Deploying Lottery")

    const nftLottery = await deploy("NftLottery", {
        from: deployer,
        args: args,
        log: true,
    })

    log("--------------------------------------------------")

    if (chainId == 31337) {
        await vrfCoordinatorV2Mock.addConsumer(subscriptionId.toNumber(), nftLottery.address)
    }
}

module.exports.tags = ["all", "lottery"]
