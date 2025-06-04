// app/api/chat/route.ts (or your chosen path)

import { openai as vercelOpenAI } from "@ai-sdk/openai"; // Vercel AI SDK's OpenAI provider
import { streamText, CoreMessage } from "ai";
import OpenAI from "openai"; // Standard OpenAI SDK for embeddings
import { Pinecone, PineconeConfiguration } from "@pinecone-database/pinecone";

export const maxDuration = 30; // Vercel specific configuration

// Initialize Standard OpenAI Client for embeddings
if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY for embeddings client");
}
const openaiEmbeddingsClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone Client
if (
  !process.env.PINECONE_API_KEY ||
  !process.env.PINECONE_ENVIRONMENT ||
  !process.env.PINECONE_INDEX_NAME
) {
  throw new Error("Missing Pinecone configuration for API route");
}
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
} as PineconeConfiguration);
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
const PINECONE_NAMESPACE = "americano-fc-kb"; // Must match the namespace used in process-kb.js (if any)
const EMBEDDING_MODEL = "text-embedding-3-small";

async function getContextFromPinecone(
  query: string,
  topK: number = 3
): Promise<string> {
  try {
    const queryEmbedding = await openaiEmbeddingsClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });

    const pineconeResult = await pineconeIndex
      .namespace(PINECONE_NAMESPACE)
      .query({
        vector: queryEmbedding.data[0].embedding,
        topK: topK,
        includeMetadata: true,
      });

    if (pineconeResult.matches && pineconeResult.matches.length > 0) {
      return pineconeResult.matches
        .map((match) => match.metadata?.text as string) // Assuming 'text' is in metadata
        .filter((text) => text)
        .join("\n---\n"); // Join relevant chunks with a separator
    }
    return "No se encontró contexto relevante en la base de conocimiento.";
  } catch (error) {
    console.error("Error fetching context from Pinecone:", error);
    return "Error al obtener contexto de la base de conocimiento.";
  }
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: CoreMessage[] } = await req.json();

    const lastUserMessage = messages.findLast((msg) => msg.role === "user");

    let context = "";
    if (lastUserMessage && typeof lastUserMessage.content === "string") {
      context = await getContextFromPinecone(lastUserMessage.content);
    } else {
      // Handle cases where there's no user message or content is not a string
      // Potentially skip RAG or return a default message
      console.warn(
        "No valid last user message found for RAG context retrieval."
      );
    }

    const systemPrompt = `Eres un asistente virtual de Americano FC Academy Perú.
Tu objetivo es responder preguntas sobre la academia.
Utiliza ÚNICAMENTE el siguiente contexto para responder la pregunta del usuario.
Si la información no se encuentra en el contexto proporcionado o el contexto indica que no hay información relevante,
indica amablemente que no tienes esa información específica en tu base de conocimiento actual.
No inventes información ni respondas basándote en conocimiento general fuera de este contexto.

Contexto de la Academia:
---
${context}
---
`;

    // Prepend the dynamic system prompt (with context) to the messages array
    const messagesForLLM: CoreMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages, // Include the original conversation history
    ];

    const result = await streamText({
      model: vercelOpenAI("gpt-4o"), // Or your preferred model
      messages: messagesForLLM,
      // You can add temperature, max_tokens, etc. here if needed
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Error in POST /api/chat:", error);
    // Consider returning a more structured error response
    const readableError =
      error instanceof Error ? error.message : "An unknown error occurred";
    return new Response(
      JSON.stringify({
        error: "Failed to process chat request",
        details: readableError,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
