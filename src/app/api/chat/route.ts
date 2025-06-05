// app/api/chat/route.ts

import { openai as vercelOpenAI } from "@ai-sdk/openai"; // Vercel AI SDK's OpenAI provider
import { streamText, CoreMessage, ToolInvocation } from "ai"; // Added TextPart
import OpenAI from "openai"; // Standard OpenAI SDK for embeddings
import { Pinecone } from "@pinecone-database/pinecone";

import {
  getAlumnosFromFirebase,
  saveTrialToFirebase,
  TrialSessionData,
} from "@/lib/firebaseAdmin";
import { z } from "zod";

interface IMessage {
  role: "user" | "assistant";
  content: string;
  toolInvocations?: ToolInvocation[];
}

export const maxDuration = 60;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY for embeddings client");
}
const openaiEmbeddingsClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
  throw new Error(
    "Missing Pinecone configuration for API route (API Key or Index Name)"
  );
}
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
const PINECONE_NAMESPACE = "americano-fc-kb";
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
        .map((match) => match.metadata?.text as string)
        .filter((text) => text)
        .join("\n---\n");
    }
    return "No se encontró contexto relevante en la base de conocimiento.";
  } catch (error) {
    console.error("Error fetching context from Pinecone:", error);
    return "Error al obtener contexto de la base de conocimiento.";
  }
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: IMessage[] } = await req.json();

    const lastUserMessage = messages.findLast((msg) => msg.role === "user");
    let pineconeRagContext = ""; // For data from Pinecone

    const assistantContentIncludes = (
      content: CoreMessage["content"],
      keywords: string[]
    ): boolean => {
      if (typeof content === "string") {
        const lowerContent = content.toLowerCase();
        return keywords.some((keyword) => lowerContent.includes(keyword));
      } else if (Array.isArray(content)) {
        return content.some((part) => {
          if (part.type === "text") {
            const lowerContent = part.text.toLowerCase();
            return keywords.some((keyword) => lowerContent.includes(keyword));
          }
          return false;
        });
      }
      return false;
    };

    console.log("Checking if booking flow is active based on messages...");
    console.log("Messages:", messages);
    const isBookingFlowActive = messages.some(
      (msg) =>
        (msg.role === "assistant" &&
          assistantContentIncludes(msg.content, [
            "categoría",
            "día de la prueba",
            "horario",
            "nombre del niño",
            "edad del niño",
            "nombre del padre",
            "celular",
            "correo electrónico",
            "para la clase de prueba gratuita",
          ])) ||
        (msg.toolInvocations &&
          msg.toolInvocations.some(
            (tc) => tc.toolName === "book_trial_session"
          ))
    );
    console.log("Is booking flow active:", isBookingFlowActive);

    // Attempt to get context if there's a user message
    if (lastUserMessage && typeof lastUserMessage.content === "string") {
      pineconeRagContext = await getContextFromPinecone(
        lastUserMessage.content
      );
    }

    // Default/Fallback for pineconeRagContext if RAG failed or wasn't applicable
    const noContextFoundMessages = [
      "No se encontró contexto relevante en la base de conocimiento.",
      "Error al obtener contexto de la base de conocimiento.",
    ];
    const hasMeaningfulContext =
      pineconeRagContext &&
      !noContextFoundMessages.some((msg) => pineconeRagContext.includes(msg));

    if (!hasMeaningfulContext) {
      if (isBookingFlowActive) {
        pineconeRagContext =
          "Advertencia: No se pudo cargar la información detallada de la academia (horarios, categorías disponibles, etc.). Procede con la reserva solicitando los datos al usuario, pero infórmale que no puedes validar la disponibilidad de opciones específicas en este momento y que la academia confirmará los detalles posteriormente. Pregunta por sus preferencias igualmente.";
      } else if (lastUserMessage) {
        pineconeRagContext =
          "No encontré información específica sobre tu última pregunta. Puedo ayudarte con información general de Americano FC Academy Perú o a registrar una clase de prueba. ¿Cómo deseas proceder?";
      } else {
        pineconeRagContext =
          "Bienvenido a Americano FC Academy Perú. Puedo ofrecerte información sobre nuestros programas y ayudarte a registrar una clase de prueba gratuita. ¿En qué estás interesado?";
      }
    }

    let additionalBookingInstructions = "";
    if (isBookingFlowActive) {
      additionalBookingInstructions = `
Instrucciones Adicionales para Reserva de Clase de Prueba Activa:
El usuario está en proceso de reservar una clase de prueba. Tu tarea es guiarlo para completar los datos faltantes, uno por uno, siguiendo el "Proceso ESTRICTO de Reserva".
CRUCIAL: Valida las respuestas del usuario (como día, horario, categoría) contra el "Contexto de la Academia" (la información de Pinecone provista abajo).
- Si el "Contexto de la Academia" contiene "Advertencia: No se pudo cargar la información detallada...", entonces NO PUEDES validar opciones específicas. Informa al usuario que recogerás sus preferencias y la academia confirmará la disponibilidad.
- Si el contexto SÍ tiene detalles:
    - Si el usuario pregunta por horarios y ya proporcionó la sede (o si la sede es única según el contexto), consulta el "Contexto de la Academia" y responde con los horarios disponibles para esa sede/categoría/día. Luego pregunta: "¿Qué horario te vendría bien?".
    - Si el usuario proporciona un dato (ej. categoría "Avanzados") y no existe o no es compatible según el "Contexto de la Academia", informa amablemente y guía hacia opciones válidas. Ej: "Para la edad de [edad], las categorías disponibles son [X, Y]. ¿Cuál prefieres?".
- Asegúrate de que el usuario confirme todos los datos antes de invocar 'book_trial_session'.
Sé eficiente y claro. Los datos siempre deben estar acorde al "Contexto de la Academia" disponible.`;
    }

    const systemPrompt = `Eres un asistente virtual MUY METÓDICO, amigable y eficiente de Americano FC Academy Perú.
Tu principal responsabilidad es ayudar a los usuarios con información de la academia y, CRUCIALMENTE, guiarlos paso a paso para registrarse en una clase de prueba gratuita.

Instrucciones Generales:
1.  Siempre sé cortés, profesional y paciente.
2.  Para preguntas generales sobre la academia (horarios, sedes, precios, método), usa el "Contexto de la Academia" provisto más abajo. Si la información no está ahí o si el contexto indica que no se pudo cargar la información detallada, indica amablemente que no tienes los detalles específicos pero que puedes tomar nota de sus preferencias para que la academia las confirme. NO INVENTES.
3.  Sé eficiente y directo. Evita preguntas confusas o engañosas.

${additionalBookingInstructions}

Proceso ESTRICTO de Reserva de Clase de Prueba Gratuita:
(Estas instrucciones son prioritarias si el usuario desea registrarse o está en proceso de ello)
1.  **Intención Clara:** Si un usuario expresa interés en una "clase de prueba gratuita" o similar, confirma su intención: "¡Genial! ¿Te gustaría que te ayude a registrarte para una clase de prueba gratuita?". Inmediatamente después, inicia la recopilación de datos.
2.  **Informar y Solicitar Paso a Paso:** Una vez confirmada la intención, informa al usuario: "Perfecto. Para el registro, necesitaré los siguientes datos. Te los iré pidiendo uno por uno para que sea más fácil."
3.  **Recopilación SECUENCIAL de Datos:** DEBES PREGUNTAR POR CADA DATO INDIVIDUALMENTE, esperando la respuesta del usuario antes de pedir el siguiente. NO pidas múltiples datos en una sola pregunta a menos que el usuario los provea espontáneamente.
    Los datos requeridos y el orden sugerido para pedirlos son:
    a.  "Primero, ¿cuál es el **nombre completo del niño o niña** que asistirá a la clase de prueba?" (Espera respuesta)
    b.  "Entendido. ¿Qué **edad tiene [nombre del niño/a]**?" (Espera respuesta)
    c.  "Gracias. ¿En qué **categoría** te gustaría inscribirlo/a? (Si el 'Contexto de la Academia' tiene una lista de categorías, puedes mencionarlas. Si no, o si el usuario no está seguro, puedes decir: 'Si no estás seguro, con la edad te puedo ayudar a identificarla o puedes indicarme tu preferencia y la academia lo confirmará.')" (Espera respuesta)
    d.  "Perfecto. ¿Qué **día de la semana** prefieres para la clase de prueba? (Si el 'Contexto de la Academia' tiene días específicos, menciónalos. Si no, toma la preferencia del usuario)." (Espera respuesta)
    e.  "Anotado. ¿Y en qué **horario** te vendría bien ese día? (Si el 'Contexto de la Academia' tiene horarios específicos para el día/categoría/sede, menciónalos. Si no, toma la preferencia)." (Espera respuesta)
    f.  "Ahora, necesitaré el **nombre completo del padre, madre o apoderado**." (Espera respuesta)
    g.  "Casi terminamos. ¿Cuál es tu **número de celular** de contacto?" (Espera respuesta)
    h.  "Y por último, tu **correo electrónico**, por favor." (Espera respuesta)
    **Validación durante la recopilación (SIEMPRE QUE EL CONTEXTO LO PERMITA)**: Si el usuario proporciona un dato como categoría, día u horario, y el "Contexto de la Academia" es detallado y NO contiene la advertencia de fallo de carga:
        - Verifica si la respuesta del usuario es compatible. Si no lo es, informa amablemente y guía al usuario hacia opciones válidas según el contexto. Ejemplo: "Para la categoría de [edad del niño/a], tenemos disponibles [X, Y] según nuestros registros. ¿Cuál de esas prefieres?" o "Lo siento, no ofrecemos clases los [día no disponible]. Nuestros días son [días disponibles]. ¿Cuál te funciona?".
        - Si el "Contexto de la Academia" indica que no se pudo cargar la información detallada, simplemente anota la preferencia del usuario e infórmale que la academia confirmará la disponibilidad. Ejemplo: "Entendido, tomaré nota de tu preferencia por [categoría/día/horario]. La academia confirmará la disponibilidad."
4.  **Confirmación ANTES de llamar a la herramienta:** Una vez que hayas recopilado TODOS los 8 datos, ANTES de hacer cualquier otra cosa, resume la información al usuario: "Muy bien, he registrado lo siguiente: [listar todos los datos recopilados de forma clara]. ¿Es toda la información correcta?".
5.  **Llamada a la Herramienta SÓLO TRAS CONFIRMACIÓN:** ÚNICAMENTE si el usuario confirma que TODOS los datos son correctos, entonces y SOLO entonces, debes llamar a la herramienta 'book_trial_session' con TODOS los datos recopilados. NO llames a la herramienta si falta algún dato o si el usuario no ha confirmado. Si algo es incorrecto, pregunta qué dato hay que corregir y actualízalo.
6.  **Resultado de la Herramienta:** Después de que la herramienta 'book_trial_session' se ejecute, informa al usuario del resultado (éxito o error) basándote en el mensaje que la herramienta te devuelva.

Recuerda: La paciencia y la recolección COMPLETA y CONFIRMADA de datos son CLAVE antes de usar 'book_trial_session'. La validación de datos contra el 'Contexto de la Academia' durante la recolección es importante, siempre y cuando el contexto esté disponible y detallado.

Contexto de la Academia (Información de nuestra base de datos para responder preguntas y validar datos):
---
${pineconeRagContext}
---
`;

    console.log("System prompt prepared for AI model:", systemPrompt);
    const result = await streamText({
      model: vercelOpenAI("gpt-4o"),
      system: systemPrompt,
      messages,
      tools: {
        book_trial_session: {
          description:
            "Registra una sesión de prueba gratuita para un niño/a en Americano FC Academy Perú. ESTA HERRAMIENTA SÓLO DEBE LLAMARSE DESPUÉS DE HABER RECOPILADO Y CONFIRMADO TODOS LOS DATOS REQUERIDOS DEL USUARIO.",
          parameters: z.object({
            category: z
              .string()
              .min(1, "La categoría es requerida.")
              .describe("Categoría para la clase de prueba."),
            testDay: z
              .string()
              .min(1, "El día de la prueba es requerido.")
              .describe("Día preferido para la prueba."),
            testTimes: z
              .string()
              .min(1, "El horario es requerido.")
              .describe(
                "Horario preferido para la prueba, como '6:00pm', '7:00 am'."
              ),
            childrenFullName: z
              .string()
              .min(1, "El nombre completo del niño/a es requerido.")
              .describe("Nombre completo del niño o niña."),
            childrenAge: z
              .number()
              .int()
              .positive("La edad debe ser un número positivo.")
              .describe("Edad del niño o niña (debe ser un número)."),
            parentFullName: z
              .string()
              .min(1, "El nombre completo del padre/madre es requerido.")
              .describe("Nombre completo del padre, madre o apoderado."),
            phone: z
              .string()
              .min(7, "El número de celular debe tener al menos 7 dígitos.")
              .describe("Número de celular del padre/madre."),
            email: z
              .string()
              .email("Por favor, introduce un correo electrónico válido.")
              .describe("Correo electrónico del padre/madre."),
          }),
          execute: async (args: TrialSessionData) => {
            console.log(
              "Tool 'book_trial_session' called by LLM with args:",
              args
            );
            // Zod handles type validation; this manual check might be redundant if childrenAge is correctly typed from Zod
            if (typeof args.childrenAge !== "number") {
              console.warn(
                "Tool 'book_trial_session' called with non-numeric childrenAge. Zod should prevent this."
              );
            }
            const saveResult = await saveTrialToFirebase(args);
            console.log("Result from saveTrialToFirebase:", saveResult);
            if (saveResult.success) {
              return {
                status: "success",
                message: `¡Clase de prueba registrada exitosamente! ID de registro: ${saveResult.trialId}. Nos pondremos en contacto pronto para confirmar los detalles.`,
                details: args,
              };
            } else {
              return {
                status: "error",
                message: `Hubo un problema al registrar la clase de prueba: ${saveResult.error}. Por favor, intenta más tarde o contacta a soporte.`,
                details: args,
              };
            }
          },
        },
        get_alumnos_list: {
          description:
            "Obtiene un listado o un recuento de los alumnos registrados en la academia. Útil si el usuario pregunta 'cuántos alumnos hay' o 'lista de alumnos'.",
          parameters: z.object({}),
          execute: async () => {
            console.log("Tool 'get_alumnos_list' called by LLM.");
            const result = await getAlumnosFromFirebase();
            if (result.success) {
              const count = result.count ?? 0;
              if (count > 0 && result.alumnos) {
                const alumnosSummary = result.alumnos.slice(0, 3).map((a) => ({
                  nombre: a.childrenFullName,
                }));
                return {
                  status: "success",
                  message: `Se encontraron ${count} alumnos.`,
                  count: count,
                  alumnosPreview: alumnosSummary,
                };
              } else {
                return {
                  status: "success",
                  message: "No hay alumnos registrados actualmente.",
                  count: 0,
                };
              }
            } else {
              return {
                status: "error",
                message: `Error al obtener la lista de alumnos: ${
                  result.error ||
                  "Error desconocido durante la obtención de alumnos"
                }.`,
              };
            }
          },
        },
      },
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Error in POST /api/chat:", error);
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
