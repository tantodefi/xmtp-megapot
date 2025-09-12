#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@xmtp/node-sdk";
import { fromString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env file
function readEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env file not found");
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  const envVars = {};

  envContent.split("\n").forEach((line) => {
    const [key, value] = line.split("=");
    if (key && value && !key.startsWith("#")) {
      envVars[key.trim()] = value.trim();
    }
  });

  return envVars;
}

// Create signer function
function createSigner(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(),
  });

  return {
    type: "EOA",
    getIdentifier: () => ({
      identifierKind: 0, // IdentifierKind.Ethereum
      identifier: account.address.toLowerCase(),
    }),
    signMessage: async (message) => {
      const signature = await wallet.signMessage({
        message,
        account,
      });
      return toBytes(signature);
    },
  };
}

// Get inbox ID from command line
const inboxId = process.argv[2];
if (!inboxId) {
  console.error("❌ Usage: node revoke-installations.js <inbox-id>");
  console.error(
    "Example: node revoke-installations.js c1b50c2cec9af9803af756e95346d2fde3b23d2ae06db0585dcecc283a81867f",
  );
  process.exit(1);
}

console.log("🔍 Reading environment variables...");
const envVars = readEnvFile();

const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV } = envVars;

if (!WALLET_KEY || !ENCRYPTION_KEY) {
  console.error("❌ WALLET_KEY and ENCRYPTION_KEY are required in .env file");
  process.exit(1);
}

console.log(`📝 Inbox ID: ${inboxId}`);
console.log(`🌍 Environment: ${XMTP_ENV || "dev"}`);
console.log(`🔑 Wallet: ${WALLET_KEY.substring(0, 10)}...`);

async function revokeInstallations() {
  try {
    console.log("🔄 Creating XMTP signer...");

    // Create signer
    const signer = createSigner(WALLET_KEY);

    console.log("📊 Fetching inbox state from XMTP network...");

    // Try to get inbox state using static method first
    let inboxState;
    try {
      // Check if static method exists
      if (typeof Client.inboxStateFromInboxIds === "function") {
        inboxState = await Client.inboxStateFromInboxIds(
          [inboxId],
          XMTP_ENV || "dev",
        );
      }
    } catch (staticError) {
      console.log("⚠️  Static method not available, trying instance method...");
    }

    // If static method didn't work, try creating a minimal client
    if (!inboxState) {
      try {
        // Create a temporary client with minimal setup
        const tempClient = await Client.create(signer, {
          dbEncryptionKey: new Uint8Array(32), // Dummy key
          env: XMTP_ENV || "dev",
          dbPath: null, // No database
        });

        // Get inbox state using client instance method
        inboxState = await tempClient.preferences.inboxStateFromInboxIds(
          [inboxId],
          true, // Force refresh from network
        );
      } catch (clientError) {
        console.log(
          "⚠️  Client creation failed, trying alternative approach...",
        );
        throw clientError; // Re-throw to trigger fallback
      }
    }

    if (!inboxState || inboxState.length === 0) {
      console.error("❌ Could not find inbox state");
      console.log(
        "💡 This might mean the inbox doesn't exist or there are network issues",
      );
      console.log("🔄 Falling back to database deletion approach...");

      // Fallback to database deletion
      const xmtpDbPath = path.join(__dirname, ".xmtp-db");
      if (fs.existsSync(xmtpDbPath)) {
        console.log("📁 Found .xmtp-db directory");
        console.log("🗑️  Deleting corrupted database...");
        fs.rmSync(xmtpDbPath, { recursive: true, force: true });
        console.log("✅ Successfully deleted XMTP database");
      }

      console.log("🎉 Ready for fresh installation!");
      console.log("📋 Next steps:");
      console.log("1. Redeploy your Render service");
      console.log("2. The agent will create a new installation automatically");
      return;
    }

    const currentInstallations = inboxState[0].installations;
    console.log(`✅ Found ${currentInstallations.length} installations`);

    if (currentInstallations.length <= 1) {
      console.log("✅ Only 1 installation found - no need to revoke");
      console.log("🎉 Your agent should deploy successfully!");

      // Clean up any corrupted local database
      const xmtpDbPath = path.join(__dirname, ".xmtp-db");
      if (fs.existsSync(xmtpDbPath)) {
        console.log("🧹 Cleaning up local database...");
        fs.rmSync(xmtpDbPath, { recursive: true, force: true });
      }

      return;
    }

    console.log("📋 Current installations:");
    currentInstallations.forEach((inst, index) => {
      console.log(`  ${index + 1}. ${inst.id}`);
    });

    // Ask for confirmation
    console.log("");
    console.log(
      `⚠️  This will revoke ${currentInstallations.length - 1} installations, keeping only 1.`,
    );
    console.log(
      "The kept installation will be the first one in the list above.",
    );
    console.log("");
    console.log("Do you want to proceed? (y/N): ");

    process.stdout.write("Your choice: ");

    const answer = await new Promise((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim().toLowerCase());
      });
    });

    if (answer !== "y" && answer !== "yes") {
      console.log("❌ Operation cancelled");

      // Still offer database cleanup
      const xmtpDbPath = path.join(__dirname, ".xmtp-db");
      if (fs.existsSync(xmtpDbPath)) {
        console.log("");
        console.log("💡 Alternative: Clean up local database:");
        console.log(`   rm -rf ${xmtpDbPath}`);
      }

      process.exit(0);
    }

    // Keep the first installation, revoke the rest
    const installationsToKeep = [currentInstallations[0]];
    const installationsToRevoke = currentInstallations.slice(1);

    console.log(`✅ Keeping installation: ${installationsToKeep[0].id}`);
    console.log(
      `🗑️  Revoking ${installationsToRevoke.length} installations...`,
    );

    // Convert installation objects to bytes for the revoke function
    const installationsToRevokeBytes = installationsToRevoke.map(
      (installation) => installation.bytes,
    );

    console.log("🔄 Sending revoke request to XMTP...");

    // Revoke the installations using client instance method
    await tempClient.revokeInstallations(installationsToRevokeBytes);

    console.log("✅ Successfully revoked installations!");

    // Verify the revocation
    console.log("🔍 Verifying revocation...");
    let finalInboxState;

    // Use the same method as for getting initial inbox state
    if (typeof Client.inboxStateFromInboxIds === "function") {
      finalInboxState = await Client.inboxStateFromInboxIds(
        [inboxId],
        XMTP_ENV || "dev",
      );
    } else {
      finalInboxState = await tempClient.preferences.inboxStateFromInboxIds(
        [inboxId],
        true, // Force refresh from network
      );
    }

    console.log(
      `📊 Final installations: ${finalInboxState[0].installations.length}`,
    );

    // Clean up any local database since we now have a fresh state
    const xmtpDbPath = path.join(__dirname, ".xmtp-db");
    if (fs.existsSync(xmtpDbPath)) {
      console.log("🧹 Cleaning up local database...");
      fs.rmSync(xmtpDbPath, { recursive: true, force: true });
    }

    console.log("");
    console.log("🎉 Installation limit issue resolved!");
    console.log("Your agent should now deploy successfully.");
    console.log("");
    console.log("📋 Next steps:");
    console.log("1. Redeploy your Render service");
    console.log("2. The agent will create a new installation automatically");
  } catch (error) {
    console.error("❌ Error revoking installations:", error.message);

    // Provide fallback options
    console.log("");
    console.log("💡 Falling back to database cleanup approach...");

    const xmtpDbPath = path.join(__dirname, ".xmtp-db");

    if (fs.existsSync(xmtpDbPath)) {
      console.log("📁 Found .xmtp-db directory");

      // Ask for confirmation to delete database
      console.log("");
      console.log("⚠️  This will delete your local XMTP database.");
      console.log("   You will lose all message history for this project.");
      console.log("");
      console.log("Do you want to proceed? (y/N): ");

      process.stdout.write("Your choice: ");

      const answer = await new Promise((resolve) => {
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim().toLowerCase());
        });
      });

      if (answer === "y" || answer === "yes") {
        console.log("🗑️  Deleting .xmtp-db directory...");
        fs.rmSync(xmtpDbPath, { recursive: true, force: true });
        console.log("✅ Successfully deleted XMTP database");
        console.log("");
        console.log("🎉 Ready for fresh installation!");
        console.log("📋 Next steps:");
        console.log("1. Redeploy your Render service");
        console.log(
          "2. The agent will create a new installation automatically",
        );
      } else {
        console.log("❌ Operation cancelled");
        console.log(
          "💡 Alternative: You can manually delete the database with:",
        );
        console.log(`   rm -rf ${xmtpDbPath}`);
      }
    } else {
      console.log("✅ No .xmtp-db directory found - you can deploy now!");
      console.log(
        "🎉 Your agent will create a fresh installation automatically.",
      );
    }

    console.log("");
    console.log("🔗 Useful links:");
    console.log("- XMTP Dev Tools: https://xmtp.chat/dev");
    console.log("- XMTP Documentation: https://docs.xmtp.org");
    console.log("- XMTP Discord: https://xmtp.org/discord");

    process.exit(1);
  }
}

revokeInstallations();
