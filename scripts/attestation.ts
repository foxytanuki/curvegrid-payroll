import axios from "axios";

const ETHEREUM_SEPOLIA_DOMAIN = 0; // source doman

async function retrieveAttestation(transactionHash: string) {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${ETHEREUM_SEPOLIA_DOMAIN}?transactionHash=${transactionHash}`;
  while (true) {
    try {
      const response = await axios.get(url);
      if (response.status === 404) {
        console.log("Waiting for attestation...");
      }
      if (response.data?.messages?.[0]?.status === "complete") {
        console.log("Attestation retrieved successfully!\n");
        return response.data.messages[0];
      }
      console.log("Waiting for attestation...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Error fetching attestation:", error.message);
      } else {
        console.error("Error fetching attestation:", String(error));
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function main() {
  // Get transaction hash from command line arguments
  const transactionHash = process.argv[2];

  if (!transactionHash) {
    console.error(
      "Please provide the transaction hash as a command line argument."
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

  console.log(`Retrieving attestation for transaction: ${transactionHash}`);
  const attestation = await retrieveAttestation(transactionHash);
  console.log(attestation);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
