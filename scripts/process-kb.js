// scripts/process-kb.js
const fs = require("fs/promises");
const path = require("path");
const pdf = require("pdf-parse");
const OpenAI = require("openai"); // Using the standard OpenAI SDK for embeddings
const { Pinecone } = require("@pinecone-database/pinecone");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

// --- Configuration ---
const PDF_FILE_PATH = path.resolve(
  __dirname,
  "./Base de conocimiento Americano Academy Peru.pdf"
); // Adjust if your PDF is elsewhere or named differently
const EMBEDDING_MODEL = "text-embedding-3-small"; // Recommended for balance of cost/performance
const PINECONE_NAMESPACE = "americano-fc-kb"; // Optional: Pinecone namespace within your index

// Initialize OpenAI
if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in .env.local");
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone
if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
  // Environment is not needed for constructor
  throw new Error(
    "Missing Pinecone configuration (API Key or Index Name) in .env.local. PINECONE_ENVIRONMENT is used by Pinecone internally or for specific index hosts if needed, but not in the main client constructor."
  );
}
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  // The 'environment' property is NOT passed here for recent client versions
});
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// --- Helper Functions ---
function getTextChunks(text, chunkSize = 1500, chunkOverlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    chunks.push(text.substring(i, end));
    i += chunkSize - chunkOverlap;
    if (end === text.length) break;
  }
  return chunks.filter((chunk) => chunk.trim().length > 20);
}

async function getEmbeddingForChunk(chunk) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error(
      `Error embedding chunk: "${chunk.substring(0, 50)}..."`,
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

async function batchUpsertToPinecone(
  index,
  vectors,
  batchSize = 100,
  namespace = ""
) {
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    try {
      if (namespace) {
        await index.namespace(namespace).upsert(batch);
        console.log(
          `Upserted batch of ${batch.length} vectors to namespace "${namespace}".`
        );
      } else {
        await index.upsert(batch);
        console.log(`Upserted batch of ${batch.length} vectors.`);
      }
    } catch (error) {
      console.error("Error upserting batch to Pinecone:", error);
    }
    // Optional delay between batch uploads
    if (i + batchSize < vectors.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// --- Main Processing Function ---
async function main() {
  console.log(`Starting knowledge base processing for: ${PDF_FILE_PATH}`);
  console.log(`Using Pinecone Index: ${process.env.PINECONE_INDEX_NAME}`);
  if (PINECONE_NAMESPACE) {
    console.log(`Using Pinecone Namespace: ${PINECONE_NAMESPACE}`);
  }

  try {
    // 1. Check Pinecone Index readiness (optional but good practice)
    try {
      console.log(
        `Attempting to describe Pinecone index: ${process.env.PINECONE_INDEX_NAME}...`
      );
      const description = await pineconeIndex.describeIndexStats();
      console.log("Pinecone index stats:", description);
      // Ensure your PINECONE_ENVIRONMENT variable in .env.local matches the environment of your index if issues persist.
      // The client should resolve this, but it's good to double-check in your Pinecone console.
      const expectedDimension =
        EMBEDDING_MODEL === "text-embedding-3-small" ||
        EMBEDDING_MODEL === "text-embedding-ada-002"
          ? 1536
          : 3072; // Example for other models
      if (description.dimension !== expectedDimension) {
        console.warn(
          `Warning: Pinecone index dimension (${description.dimension}) might not match embedding model dimension (${expectedDimension} for ${EMBEDDING_MODEL}).`
        );
      }
    } catch (e) {
      console.error(
        "Failed to connect to or describe Pinecone index. Please ensure it exists, is ready, and your API key has permissions. The PINECONE_ENVIRONMENT variable in your .env.local should match your index's environment in the Pinecone console.",
        e
      );
      return;
    }

    // 2. Read and Parse PDF
    console.log("Reading PDF file...");
    const dataBuffer = await fs.readFile(PDF_FILE_PATH);
    const data = await pdf(dataBuffer);
    const rawText = data.text;
    console.log(`PDF Parsed. Extracted ${rawText.length} characters.`);

    // 3. Clean and Chunk Text
    const cleanedText = rawText
      .replace(/(\r\n|\n|\r){2,}/gm, "\n")
      .replace(/\s{2,}/g, " ");
    const chunks = getTextChunks(cleanedText);
    console.log(`Text chunked into ${chunks.length} pieces.`);
    if (chunks.length === 0) {
      console.log("No text chunks generated. Exiting.");
      return;
    }

    // 4. Generate Embeddings and Prepare for Pinecone
    const pineconeVectors = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      process.stdout.write(`Embedding chunk ${i + 1}/${chunks.length}...\r`);
      const embedding = await getEmbeddingForChunk(chunk);
      if (embedding) {
        pineconeVectors.push({
          id: `doc_chunk_${path.basename(PDF_FILE_PATH)}_${Date.now()}_${i}`, // More robust unique ID
          values: embedding,
          metadata: {
            text: chunk, // Storing the original text chunk in metadata
            source: path.basename(PDF_FILE_PATH),
          },
        });
      }
    }
    process.stdout.write("\n"); // Clear the processing line

    // 5. Batch Upsert to Pinecone
    if (pineconeVectors.length > 0) {
      console.log(
        `\nUpserting ${pineconeVectors.length} vectors to Pinecone...`
      );
      await batchUpsertToPinecone(
        pineconeIndex,
        pineconeVectors,
        100,
        PINECONE_NAMESPACE
      );
      console.log(
        "Knowledge base processed and embeddings uploaded to Pinecone successfully."
      );
    } else {
      console.log(
        "No embeddings were generated. Nothing to upload to Pinecone."
      );
    }
  } catch (error) {
    console.error("Error during knowledge base processing:", error);
  }
}

main();
