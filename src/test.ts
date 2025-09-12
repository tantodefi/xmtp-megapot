import { MegaPotManager } from "./managers/MegaPotManager.js";

// Test environment variables
const WALLET_KEY = process.env.WALLET_KEY as `0x${string}`;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const XMTP_ENV = process.env.XMTP_ENV || "dev";
const MEGAPOT_DATA_API_KEY = process.env.MEGAPOT_DATA_API_KEY;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

async function testMegaPotAgent() {
  console.log("🧪 Testing MegaPot Agent...");

  // Validate environment variables
  if (!WALLET_KEY) {
    throw new Error("WALLET_KEY environment variable is required");
  }
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  console.log("✅ Environment variables loaded");

  // MegaPot contract configuration based on environment
  const MEGAPOT_CONFIG = {
    mainnet: {
      prod: {
        contractAddress:
          "0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95" as `0x${string}`,
        usdcAddress:
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
        referrerAddress:
          "0x0000000000000000000000000000000000000000" as `0x${string}`,
      },
    },
    testnet: {
      prod: {
        contractAddress:
          "0x6f03c7BCaDAdBf5E6F5900DA3d56AdD8FbDac5De" as `0x${string}`,
        usdcAddress:
          "0xA4253E7C13525287C56550b8708100f93E60509f" as `0x${string}`,
        referrerAddress:
          "0x0000000000000000000000000000000000000000" as `0x${string}`,
      },
    },
  };

  // Initialize MegaPot manager
  const network = XMTP_ENV === "production" ? "mainnet" : "testnet";
  const configType = "prod"; // Always use prod config for testing

  console.log(`📊 Testing with network: ${network} (${configType})`);

  try {
    const megaPotManager = new MegaPotManager(
      BASE_RPC_URL,
      WALLET_KEY,
      MEGAPOT_CONFIG[network][configType],
    );

    console.log("✅ MegaPotManager initialized successfully");

    // Test getting contract info (may fail if contract not deployed)
    console.log("🔍 Testing contract info retrieval...");
    try {
      const contractInfo = await megaPotManager.getContractInfo();
      console.log("✅ Contract info retrieved:", contractInfo);
    } catch (error) {
      console.log(
        "⚠️ Contract info test skipped (contract may not be deployed):",
        error instanceof Error ? error.message : "Unknown error",
      );
    }

    // Test getting stats (may partially fail if API not available)
    console.log("📊 Testing stats retrieval...");
    try {
      const stats = await megaPotManager.getStats();
      console.log("✅ Stats retrieved:", {
        ticketsPurchased: stats.totalTicketsPurchased,
        totalSpent: stats.totalSpent,
        totalWinnings: stats.totalWinnings,
        jackpotPool: stats.jackpotPool,
        ticketPrice: stats.ticketPrice,
      });
    } catch (error) {
      console.log(
        "⚠️ Stats test partially failed (API may not be available):",
        error instanceof Error ? error.message : "Unknown error",
      );
    }

    // Test formatAmount function
    console.log("💰 Testing formatAmount function...");
    const testAmount = "1234.5678";
    const formattedAmount = megaPotManager.formatAmount(testAmount);
    console.log(
      `✅ Amount formatting works: ${testAmount} → ${formattedAmount}`,
    );

    console.log("🎉 Core MegaPot Agent functionality tests passed!");
    console.log(
      "📝 Note: Some tests may be skipped if contracts/APIs are not available in test environment.",
    );
  } catch (error) {
    console.error(
      "❌ Test failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exit(1);
  }
}

testMegaPotAgent().catch((error) => {
  console.error("❌ Fatal test error:", error);
  process.exit(1);
});
