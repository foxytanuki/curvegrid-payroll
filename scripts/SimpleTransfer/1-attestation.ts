import axios from "axios";
import * as fs from "node:fs"; // Import fs for file writing
import * as path from "node:path"; // Import path for joining paths

const SOURCE_DOMAIN = 0; // Ethereum Sepolia
const OUTPUT_FILE = path.join(__dirname, "..", "attestation_data.json"); // Output file path

async function retrieveAttestation(transactionHash: string) {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${SOURCE_DOMAIN}?transactionHash=${transactionHash}`;
  console.log(`Polling URL: ${url}`); // Log the URL being polled
  let attempts = 0;
  const maxAttempts = 24; // Poll for approx 2 minutes (24 * 5 seconds)

  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`Attempt ${attempts}: Fetching attestation...`);
      const response = await axios.get(url, { timeout: 10000 }); // Add timeout

      // Check if response contains the expected data structure
      if (response.data?.messages?.length > 0) {
        const messageData = response.data.messages[0];
        if (
          messageData.status === "complete" &&
          messageData.message &&
          messageData.attestation
        ) {
          console.log("Attestation retrieved successfully!\n");
          return {
            message: messageData.message, // The CCTP message bytes
            attestation: messageData.attestation, // The attestation signature
          };
        }
        console.log(`Attestation status: ${messageData.status}. Waiting...`);
      } else {
        // Handle cases where the API returns 200 but no messages yet, or unexpected format
        console.log(
          "Attestation not yet available or unexpected API response format. Waiting..."
        );
      }
    } catch (error: unknown) {
      let handled = false;
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.log("Attestation not found yet (404). Waiting...");
        handled = true;
      }
      if (axios.isAxiosError(error) && !handled) {
        // Handle other Axios errors (network issues, timeouts, etc.)
        console.error(
          `Attempt ${attempts}: Error fetching attestation: ${error.message}. Retrying...`
        );
        handled = true;
      }
      if (error instanceof Error && !handled) {
        console.error(
          `Attempt ${attempts}: Error fetching attestation: ${error.message}. Retrying...`
        );
        handled = true;
      }
      if (!handled) {
        // Catch any other unexpected errors
        console.error(
          `Attempt ${attempts}: An unexpected error occurred: ${String(
            error
          )}. Retrying...`
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  // If loop finishes without returning, throw an error
  throw new Error(
    `Failed to retrieve complete attestation for ${transactionHash} after ${maxAttempts} attempts.`
  );
}

async function main() {
  // Get transaction hash from command line arguments
  const transactionHash = process.argv[2];

  if (!transactionHash) {
    console.error(
      "Please provide the source transaction hash as a command line argument."
    );
    console.error(
      "Usage: pnpm tsx scripts/1-attestation.ts <transaction_hash>"
    );
    process.exit(1);
  }

  // Validate the transaction hash format (basic check)
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
    console.error(
      "Invalid transaction hash format. It should be a 64-character hex string starting with 0x."
    );
    process.exit(1);
  }

  try {
    console.log(`Retrieving attestation for transaction: ${transactionHash}`);
    const attestationData = await retrieveAttestation(transactionHash);

    // Prepare data to write to JSON
    const outputData = {
      sourceTransactionHash: transactionHash,
      message: attestationData.message,
      attestation: attestationData.attestation,
    };

    // Write data to JSON file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2)); // Pretty print JSON
    console.log(`Attestation data successfully written to: ${OUTPUT_FILE}`);
    console.log("Data written:", JSON.stringify(outputData, null, 2));
  } catch (error) {
    console.error("\nScript failed:");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  }
}

main(); // Removed catch here, handled in main
