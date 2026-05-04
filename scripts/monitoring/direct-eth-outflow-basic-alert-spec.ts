import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type HoodiStageDeployment = {
  environment: "stage";
  network: "hoodi";
  ssvNetworkProxy: string;
  ssvNetworkViews: string;
  ssvToken: string;
  cssvToken: string;
};

type BasicAlertEventSpec = {
  alertName: string;
  triggerType: "Event Emitted";
  eventName: string;
  coveredFunctions: string[];
  contractAddress: string;
  network: "hoodi";
  rationale: string;
  recommendedSeverity: "high" | "critical";
  recommendedDestinations: string[];
};

type DirectEthOutflowBasicAlertSpec = {
  packName: string;
  contractName: string;
  network: "hoodi";
  deployment: HoodiStageDeployment;
  intent: string;
  assumptions: string[];
  alerts: BasicAlertEventSpec[];
};

function loadHoodiStageDeployment(): HoodiStageDeployment {
  const filePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deployments/hoodi-stage/config.json",
  );
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<HoodiStageDeployment>;

  if (!parsed.ssvNetworkProxy || !parsed.ssvNetworkViews || !parsed.ssvToken || !parsed.cssvToken) {
    throw new Error("Incomplete hoodi-stage deployment config");
  }

  return {
    environment: "stage",
    network: "hoodi",
    ssvNetworkProxy: parsed.ssvNetworkProxy,
    ssvNetworkViews: parsed.ssvNetworkViews,
    ssvToken: parsed.ssvToken,
    cssvToken: parsed.cssvToken,
  };
}

export function buildDirectEthOutflowBasicAlertSpec(): DirectEthOutflowBasicAlertSpec {
  const deployment = loadHoodiStageDeployment();

  return {
    packName: "SSV Hoodi Stage - Direct ETH Outflow Basic Alert Pack",
    contractName: "SSVNetwork proxy",
    network: deployment.network,
    deployment,
    intent: "Start with simple event alerts for withdrawal and reward-claim ETH outflows from the Hoodi stage SSVNetwork proxy.",
    assumptions: [
      "This starter pack is limited to withdrawal and reward-claim ETH-outflow functions only.",
      "Each event should be created as a separate Tenderly Event Emitted alert.",
      "Stage rollout should route to Slack or email first, not PagerDuty.",
      "Liquidation ETH outflows via liquidate() and updateClusterBalance() are intentionally excluded and need a separate monitor.",
      "Event-only alerts can still fire on zero-value emissions such as RewardsClaimed(user, 0).",
      "A later Web3 Action can add thresholds, recipient rules, and burst detection.",
    ],
    alerts: [
      {
        alertName: "SSV Hoodi Stage - Cluster ETH Withdrawn",
        triggerType: "Event Emitted",
        eventName: "ClusterWithdrawn",
        coveredFunctions: ["withdraw"],
        contractAddress: deployment.ssvNetworkProxy,
        network: deployment.network,
        rationale: "Cluster ETH withdrawal is a direct ETH-outflow path from the protocol.",
        recommendedSeverity: "critical",
        recommendedDestinations: ["Slack"],
      },
      {
        alertName: "SSV Hoodi Stage - Operator ETH Withdrawn",
        triggerType: "Event Emitted",
        eventName: "OperatorWithdrawn",
        coveredFunctions: [
          "withdrawOperatorEarnings",
          "withdrawAllOperatorEarnings",
          "withdrawAllVersionOperatorEarnings",
        ],
        contractAddress: deployment.ssvNetworkProxy,
        network: deployment.network,
        rationale: "Operator ETH earnings withdrawal is a direct ETH-outflow path from the protocol.",
        recommendedSeverity: "high",
        recommendedDestinations: ["Slack"],
      },
      {
        alertName: "SSV Hoodi Stage - Staker ETH Rewards Claimed",
        triggerType: "Event Emitted",
        eventName: "RewardsClaimed",
        coveredFunctions: ["claimEthRewards"],
        contractAddress: deployment.ssvNetworkProxy,
        network: deployment.network,
        rationale: "ETH reward claims move ETH out of the protocol to stakers.",
        recommendedSeverity: "high",
        recommendedDestinations: ["Slack"],
      },
    ],
  };
}

async function main() {
  console.log(JSON.stringify(buildDirectEthOutflowBasicAlertSpec(), null, 2));
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
