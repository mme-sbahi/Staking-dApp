import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { time, loadFixture } = networkHelpers;

const e = (n: string | number) => ethers.parseEther(String(n));
// 1 staked token earns 0.001 reward tokens per second.
const RATE = 10n ** 15n;
const PRECISION = 10n ** 18n;

/** Expected reward for `amount` staked over `seconds` at `rate`. */
const accrued = (amount: bigint, seconds: number, rate = RATE) => (amount * rate * BigInt(seconds)) / PRECISION;

describe("StakingRewards", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();
    const token = await ethers.deployContract("TestToken", [e(10_000_000)]);
    const staking = await ethers.deployContract("StakingRewards", [
      await token.getAddress(),
      await token.getAddress(),
      RATE,
      owner.address,
    ]);
    const stakingAddress = await staking.getAddress();

    // Fund users and the reward pool.
    for (const user of [alice, bob]) {
      await token.transfer(user.address, e(10_000));
      await token.connect(user).approve(stakingAddress, ethers.MaxUint256);
    }
    await token.approve(stakingAddress, ethers.MaxUint256);
    await staking.fundRewardPool(e(100_000));

    return { token, staking, owner, alice, bob };
  }

  /** Mine the next transaction exactly `seconds` after the latest block. */
  async function after(seconds: number) {
    await time.setNextBlockTimestamp((await time.latest()) + seconds);
  }

  describe("deployment", function () {
    it("stores the tokens, rate and owner", async function () {
      const { token, staking, owner } = await loadFixture(deployFixture);
      expect(await staking.stakingToken()).to.equal(await token.getAddress());
      expect(await staking.rewardToken()).to.equal(await token.getAddress());
      expect(await staking.rewardRate()).to.equal(RATE);
      expect(await staking.owner()).to.equal(owner.address);
    });

    it("rejects zero token addresses", async function () {
      const { staking, owner } = await loadFixture(deployFixture);
      await expect(
        ethers.deployContract("StakingRewards", [ethers.ZeroAddress, ethers.ZeroAddress, RATE, owner.address]),
      ).to.be.revertedWithCustomError(staking, "ZeroAddress");
    });
  });

  describe("stake", function () {
    it("moves tokens in and updates balances", async function () {
      const { token, staking, alice } = await loadFixture(deployFixture);
      await expect(staking.connect(alice).stake(e(100)))
        .to.emit(staking, "Staked")
        .withArgs(alice.address, e(100));
      expect(await staking.stakedBalance(alice.address)).to.equal(e(100));
      expect(await staking.totalStaked()).to.equal(e(100));
      expect(await token.balanceOf(alice.address)).to.equal(e(9_900));
    });

    it("rejects a zero amount", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await expect(staking.connect(alice).stake(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("reverts without enough allowance", async function () {
      const { token, staking, alice } = await loadFixture(deployFixture);
      await token.connect(alice).approve(await staking.getAddress(), 0);
      await expect(staking.connect(alice).stake(e(1))).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance",
      );
    });
  });

  describe("reward accrual", function () {
    it("accrues linearly with time", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));

      await time.increase(100);
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 100));

      await time.increase(400);
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 500));
    });

    it("does not compound: claimed rewards are not restaked", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(100);
      await staking.connect(alice).claim();

      await time.increase(100);
      // Second period earns on the original 100 only.
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 100));
    });

    it("tracks each user independently", async function () {
      const { staking, alice, bob } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(50);
      await staking.connect(bob).stake(e(300));

      await time.increase(100);
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 150));
      expect(await staking.earned(bob.address)).to.equal(accrued(e(300), 100));
    });

    it("adds to a position without losing rewards already earned", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(100);
      await staking.connect(alice).stake(e(100));

      await time.increase(100);
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 100) + accrued(e(200), 100));
    });

    it("applies a rate change only from the moment it is made", async function () {
      const { staking, owner, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(100);
      await expect(staking.connect(owner).setRewardRate(RATE * 2n))
        .to.emit(staking, "RewardRateUpdated")
        .withArgs(RATE, RATE * 2n);

      await time.increase(100);
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 100) + accrued(e(100), 100, RATE * 2n));
    });
  });

  describe("claim", function () {
    it("pays out accrued rewards and resets them", async function () {
      const { token, staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(200);
      const expected = accrued(e(100), 200);

      await expect(staking.connect(alice).claim())
        .to.emit(staking, "RewardClaimed")
        .withArgs(alice.address, expected);
      expect(await token.balanceOf(alice.address)).to.equal(e(9_900) + expected);
      expect(await staking.rewards(alice.address)).to.equal(0);
      expect(await staking.rewardPool()).to.equal(e(100_000) - expected);
    });

    it("rejects a double claim in the same block", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await time.increase(100);

      await networkHelpers.mine(0);
      await ethers.provider.send("evm_setAutomine", [false]);
      const first = await staking.connect(alice).claim();
      const second = await staking.connect(alice).claim({ gasLimit: 200_000 });
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_setAutomine", [true]);

      expect((await first.wait())?.status).to.equal(1);
      await expect(second.wait()).to.be.rejected;
    });

    it("rejects a claim with nothing earned", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await expect(staking.connect(alice).claim()).to.be.revertedWithCustomError(staking, "NothingToClaim");
    });

    it("rejects a claim the reward pool cannot cover, and keeps the reward owed", async function () {
      const { token, staking, owner, alice } = await loadFixture(deployFixture);
      const empty = await ethers.deployContract("StakingRewards", [
        await token.getAddress(),
        await token.getAddress(),
        RATE,
        owner.address,
      ]);
      await token.connect(alice).approve(await empty.getAddress(), ethers.MaxUint256);
      await empty.connect(alice).stake(e(100));
      await time.increase(100);

      await expect(empty.connect(alice).claim()).to.be.revertedWithCustomError(empty, "InsufficientRewardPool");
      expect(await empty.earned(alice.address)).to.be.greaterThan(0n);
    });
  });

  describe("unstake", function () {
    it("returns principal and keeps rewards claimable", async function () {
      const { token, staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(100);

      await expect(staking.connect(alice).unstake(e(100)))
        .to.emit(staking, "Unstaked")
        .withArgs(alice.address, e(100));
      expect(await token.balanceOf(alice.address)).to.equal(e(10_000));
      expect(await staking.totalStaked()).to.equal(0);

      // No more accrual once fully unstaked.
      await time.increase(1_000);
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 100));
    });

    it("supports partial unstaking", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await after(100);
      await staking.connect(alice).unstake(e(40));

      await time.increase(100);
      expect(await staking.stakedBalance(alice.address)).to.equal(e(60));
      expect(await staking.earned(alice.address)).to.equal(accrued(e(100), 100) + accrued(e(60), 100));
    });

    it("rejects a zero amount", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await expect(staking.connect(alice).unstake(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("rejects unstaking more than staked", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await staking.connect(alice).stake(e(100));
      await expect(staking.connect(alice).unstake(e(101)))
        .to.be.revertedWithCustomError(staking, "InsufficientStake")
        .withArgs(e(101), e(100));
    });

    it("never pays principal out as rewards when both tokens are the same", async function () {
      const { token, staking, owner, alice, bob } = await loadFixture(deployFixture);
      // A pool with only 1 token of rewards, while users hold 1,000 staked.
      const small = await ethers.deployContract("StakingRewards", [
        await token.getAddress(),
        await token.getAddress(),
        RATE,
        owner.address,
      ]);
      const smallAddress = await small.getAddress();
      await token.approve(smallAddress, ethers.MaxUint256);
      await small.fundRewardPool(e(1));
      for (const user of [alice, bob]) await token.connect(user).approve(smallAddress, ethers.MaxUint256);
      await small.connect(alice).stake(e(500));
      await small.connect(bob).stake(e(500));
      await time.increase(1_000);

      await expect(small.connect(alice).claim()).to.be.revertedWithCustomError(small, "InsufficientRewardPool");
      await small.connect(alice).unstake(e(500));
      await small.connect(bob).unstake(e(500));
      expect(await token.balanceOf(smallAddress)).to.equal(e(1));
    });
  });

  describe("owner functions", function () {
    it("lets the owner fund the reward pool", async function () {
      const { staking, owner } = await loadFixture(deployFixture);
      await expect(staking.connect(owner).fundRewardPool(e(50)))
        .to.emit(staking, "RewardPoolFunded")
        .withArgs(e(50));
      expect(await staking.rewardPool()).to.equal(e(100_050));
    });

    it("rejects funding with zero", async function () {
      const { staking, owner } = await loadFixture(deployFixture);
      await expect(staking.connect(owner).fundRewardPool(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("blocks non-owners from owner functions", async function () {
      const { staking, alice } = await loadFixture(deployFixture);
      await expect(staking.connect(alice).fundRewardPool(e(1))).to.be.revertedWithCustomError(
        staking,
        "OwnableUnauthorizedAccount",
      );
      await expect(staking.connect(alice).setRewardRate(1)).to.be.revertedWithCustomError(
        staking,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});

describe("TestToken faucet", function () {
  it("mints once per cooldown", async function () {
    const [, alice] = await ethers.getSigners();
    const token = await ethers.deployContract("TestToken", [0]);
    await token.connect(alice).faucet();
    expect(await token.balanceOf(alice.address)).to.equal(e(1_000));
    await expect(token.connect(alice).faucet()).to.be.revertedWithCustomError(token, "FaucetCooldown");

    await time.increase(3_600);
    await token.connect(alice).faucet();
    expect(await token.balanceOf(alice.address)).to.equal(e(2_000));
  });
});
