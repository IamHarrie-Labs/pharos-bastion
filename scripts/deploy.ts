import hardhat from "hardhat";
import { writeFileSync } from "fs";
const { ethers, network } = hardhat;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying Pharos Bastion contracts to "${network.name}" with ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} PHRS`);

  const Policy = await ethers.getContractFactory("GuardianPolicy");
  const policy = await Policy.deploy();
  await policy.waitForDeployment();
  const policyAddr = await policy.getAddress();
  console.log(`GuardianPolicy   -> ${policyAddr}`);

  const Registry = await ethers.getContractFactory("GuardianRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`GuardianRegistry -> ${registryAddr}`);

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    policyAddress: policyAddr,
    registryAddress: registryAddr,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync("deployments.json", JSON.stringify(out, null, 2));
  console.log("\nSaved deployments.json. Add these to your .env:");
  console.log(`BASTION_POLICY_ADDRESS=${policyAddr}`);
  console.log(`BASTION_REGISTRY_ADDRESS=${registryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
