// app/api/chat/route.ts

import { openai as vercelOpenAI } from "@ai-sdk/openai";
import { streamText, CoreMessage, ToolInvocation } from "ai";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

import {
  getAlumnosFromFirebase, // Asegúrate que esta función siempre busque en Firebase sin caché interno
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

// ... (inicializaciones de OpenAI y Pinecone sin cambios) ...
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
    let pineconeRagContext = "";

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

    if (lastUserMessage && typeof lastUserMessage.content === "string") {
      pineconeRagContext = await getContextFromPinecone(
        lastUserMessage.content
      );
    }

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
Tu principal responsabilidad es ayudar a los usuarios con información de la academia, CRUCIALMENTE, guiarlos paso a paso para registrarse en una clase de prueba gratuita, y opcionalmente proveer información sobre los alumnos registrados si se te solicita explícitamente.

Instrucciones Generales:
1.  Siempre sé cortés, profesional y paciente.
2.  Para preguntas generales sobre la academia (horarios, sedes, precios, método), usa el "Contexto de la Academia" provisto más abajo. Si la información no está ahí o si el contexto indica que no se pudo cargar la información detallada, indica amablemente que no tienes los detalles específicos pero que puedes tomar nota de sus preferencias para que la academia las confirme. NO INVENTES.
3.  Sé eficiente y directo. Evita preguntas confusas o engañosas.
4.  **IMPORTANTE para Alumnos:** Si el usuario pregunta por la cantidad de alumnos o una lista de alumnos, utiliza la herramienta 'get_alumnos_list' para obtener la información MÁS RECIENTE directamente de la base de datos. No asumas que la información de alumnos de un turno anterior sigue vigente si el usuario vuelve a preguntar; la lista de alumnos puede cambiar.

${additionalBookingInstructions}

Proceso ESTRICTO de Reserva de Clase de Prueba Gratuita:
(Estas instrucciones son prioritarias si el usuario desea registrarse o está en proceso de ello)
1.  **Intención Clara:** (igual que antes)
2.  **Informar y Solicitar Paso a Paso:** (igual que antes)
3.  **Recopilación SECUENCIAL de Datos:** (igual que antes)
    a.  ...
    h.  ...
    **Validación durante la recopilación (SIEMPRE QUE EL CONTEXTO LO PERMITA)**: (igual que antes)
4.  **Confirmación ANTES de llamar a la herramienta:** (igual que antes)
5.  **Llamada a la Herramienta SÓLO TRAS CONFIRMACIÓN:** (igual que antes para 'book_trial_session')
6.  **Resultado de la Herramienta 'book_trial_session':** Después de que la herramienta 'book_trial_session' se ejecute, informa al usuario del resultado (éxito o error) basándote en el mensaje que la herramienta te devuelva.
7.  **Resultado de la Herramienta 'get_alumnos_list':** Después de que la herramienta 'get_alumnos_list' se ejecute, informa al usuario sobre el resultado. Por ejemplo, si la herramienta devuelve un conteo de alumnos, podrías decir "Actualmente tenemos [conteo] alumnos registrados." Si devuelve una vista previa de nombres, puedes mencionarla si el usuario parece interesado en ejemplos, pero prioriza el conteo para brevedad. Recuerda que esta es la información más actualizada en este momento.

Recuerda: La paciencia y la recolección COMPLETA y CONFIRMADA de datos son CLAVE antes de usar 'book_trial_session'. La validación de datos contra el 'Contexto de la Academia' durante la recolección es importante. Para listar alumnos, usa 'get_alumnos_list' CADA VEZ que se solicite para asegurar frescura de datos.

Contexto de la Academia (Información de nuestra base de datos para responder preguntas y validar datos):
---
${pineconeRagContext}
---
`;

    const result = await streamText({
      model: vercelOpenAI("gpt-4o"),
      system: systemPrompt,
      messages,
      tools: {
        book_trial_session: {
          // ... (definición sin cambios) ...
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
          // <--- Descripción mejorada
          description:
            "Obtiene el listado o recuento ACTUALIZADO y EN TIEMPO REAL de los alumnos registrados en la academia. Usar SIEMPRE que el usuario pregunte explícitamente por información de alumnos (ej. 'cuántos alumnos hay', 'ver lista de alumnos') para asegurar datos recientes.",
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
                  alumnosPreview: alumnosSummary, // El LLM puede usar esto para dar más contexto si es necesario
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
