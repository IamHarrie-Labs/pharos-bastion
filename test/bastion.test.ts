import { expect } from "chai";
import hardhat from "hardhat";
const { ethers } = hardhat;

const APPROVE_SELECTOR = "0x095ea7b3";
const NO_SELECTOR = "0x00000000";
const UNLIMITED = (1n << 256n) - 1n;
const ZERO = "0x0000000000000000000000000000000000000000";

describe("GuardianPolicy", () => {
  async function deploy() {
    const [owner, other, target] = await ethers.getSigners();
    const Policy = await ethers.getContractFactory("GuardianPolicy");
    const policy = await Policy.deploy();
    return { policy, owner, other, target };
  }

  it("fails closed when no policy is configured", async () => {
    const { policy, owner, target } = await deploy();
    const [allowed, reason] = await policy.check(owner.address, target.address, 0, NO_SELECTOR, 0);
    expect(allowed).to.equal(false);
    expect(reason).to.equal("NO_POLICY");
  });

  it("allows a compliant native transfer", async () => {
    const { policy, owner, target } = await deploy();
    // maxValuePerTx = 1 ether, no daily limit, no allowlist
    await policy.setPolicy(ethers.parseEther("1"), 0, false, 0, false);
    const [allowed, reason] = await policy.check(
      owner.address,
      target.address,
      ethers.parseEther("0.5"),
      NO_SELECTOR,
      0
    );
    expect(allowed).to.equal(true);
    expect(reason).to.equal("OK");
  });

  it("denies value above the per-tx cap", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("1"), 0, false, 0, false);
    const [allowed, reason] = await policy.check(
      owner.address,
      target.address,
      ethers.parseEther("2"),
      NO_SELECTOR,
      0
    );
    expect(allowed).to.equal(false);
    expect(reason).to.equal("MAX_VALUE_PER_TX");
  });

  it("denies unlimited approvals when disallowed", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("1"), 0, false, 0, false);
    const [allowed, reason] = await policy.check(owner.address, target.address, 0, APPROVE_SELECTOR, UNLIMITED);
    expect(allowed).to.equal(false);
    expect(reason).to.equal("ERC20_UNLIMITED_APPROVAL");
  });

  it("permits unlimited approvals when explicitly enabled", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("1"), 0, true, 0, false);
    const [allowed] = await policy.check(owner.address, target.address, 0, APPROVE_SELECTOR, UNLIMITED);
    expect(allowed).to.equal(true);
  });

  it("enforces a bounded approval cap", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("1"), 0, false, 1000n, false);
    const [denied, reason] = await policy.check(owner.address, target.address, 0, APPROVE_SELECTOR, 5000n);
    expect(denied).to.equal(false);
    expect(reason).to.equal("ERC20_APPROVAL_LIMIT");
    const [allowed] = await policy.check(owner.address, target.address, 0, APPROVE_SELECTOR, 500n);
    expect(allowed).to.equal(true);
  });

  it("enforces denylist over everything", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("1"), 0, true, 0, false);
    await policy.setTargetDenied(target.address, true);
    const [allowed, reason] = await policy.check(owner.address, target.address, 0, NO_SELECTOR, 0);
    expect(allowed).to.equal(false);
    expect(reason).to.equal("TARGET_DENYLISTED");
  });

  it("enforces allowlist mode", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("1"), 0, false, 0, true);
    let [allowed, reason] = await policy.check(owner.address, target.address, 0, NO_SELECTOR, 0);
    expect(allowed).to.equal(false);
    expect(reason).to.equal("TARGET_NOT_ALLOWLISTED");

    await policy.setTargetAllowed(target.address, true);
    [allowed] = await policy.check(owner.address, target.address, 0, NO_SELECTOR, 0);
    expect(allowed).to.equal(true);
  });

  it("accrues daily spend and denies once the limit is crossed", async () => {
    const { policy, owner, target } = await deploy();
    await policy.setPolicy(ethers.parseEther("10"), ethers.parseEther("1"), false, 0, false);

    // First 0.6 ether is fine.
    let [allowed] = await policy.check(owner.address, target.address, ethers.parseEther("0.6"), NO_SELECTOR, 0);
    expect(allowed).to.equal(true);
    await policy.recordSpend(ethers.parseEther("0.6"));

    // Another 0.6 would cross the 1 ether daily limit.
    let [denied, reason] = await policy.check(owner.address, target.address, ethers.parseEther("0.6"), NO_SELECTOR, 0);
    expect(denied).to.equal(false);
    expect(reason).to.equal("DAILY_LIMIT_EXCEEDED");
  });
});

describe("GuardianRegistry", () => {
  it("logs and reads back an immutable decision", async () => {
    const [signer, account, target] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("GuardianRegistry");
    const registry = await Registry.deploy();

    const policyCode = ethers.encodeBytes32String("ERC20_UNLIMITED_APPROVAL");
    const intentHash = ethers.id("some-intent");

    await expect(registry.logDecision(account.address, target.address, 0, 2, 95, policyCode, intentHash))
      .to.emit(registry, "DecisionLogged")
      .withArgs(0, account.address, target.address, 2, 95, policyCode);

    const d = await registry.getDecision(0);
    expect(d.account).to.equal(account.address);
    expect(d.verdict).to.equal(2); // DENY
    expect(d.riskScore).to.equal(95);
    expect(ethers.decodeBytes32String(d.policyCode)).to.equal("ERC20_UNLIMITED_APPROVAL");
    expect(await registry.totalDecisions()).to.equal(1);
  });

  it("rejects an out-of-range risk score", async () => {
    const [, account, target] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("GuardianRegistry");
    const registry = await Registry.deploy();
    await expect(
      registry.logDecision(account.address, target.address, 0, 0, 101, ethers.ZeroHash, ethers.ZeroHash)
    ).to.be.revertedWith("RISK_OUT_OF_RANGE");
  });
});
