// @/lib/firebaseAdmin.ts
import * as admin from "firebase-admin"; // Importante: SDK de Admin

// Define la interfaz para los datos de la sesión de prueba (puede ser la misma)
export interface TrialSessionData {
  category: string;
  testDay: string;
  testTimes: string;
  childrenFullName: string;
  childrenAge: number;
  parentFullName: string;
  phone: string;
  email: string;
}

// --- Configuración del SDK de Admin de Firebase ---
// Asegúrate de tener configuradas estas variables de entorno en Vercel:
// FIREBASE_PROJECT_ID
// FIREBASE_CLIENT_EMAIL
// FIREBASE_PRIVATE_KEY (esta es la llave privada de tu cuenta de servicio)

try {
  console.log("Firebase Admin Module Type:", typeof admin);
  if (admin) {
    console.log("Admin Keys:", Object.keys(admin)); // Muestra las propiedades de 'admin'
    console.log("Admin Credential Type:", typeof admin.credential);
    if (admin.credential) {
      console.log("Admin Credential Cert Type:", typeof admin.credential.cert);
    }
  }
  if (!admin.apps.length) {
    console.log("Initializing Firebase Admin SDK...");
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"); // Maneja saltos de línea escapados

    if (
      !process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !privateKey
    ) {
      throw new Error(
        "Firebase Admin SDK environment variables are missing (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)."
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      // Opcional: si usas Realtime Database, también puedes añadir databaseURL aquí
      // databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
    });
    console.log("Firebase Admin SDK initialized successfully. ✅");
  }
} catch (error) {
  console.error(
    "!!! Critical error initializing Firebase Admin SDK !!!:",
    error
  );
  // Este error es crítico y evitará que Firestore funcione desde el admin.
  throw new Error(
    `Firebase Admin SDK could not be initialized. Original error: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

const db = admin.firestore(); // Obtiene la instancia de Firestore del SDK de Admin
const USUARIOS_COLLECTION = "usuarios"; // O el nombre correcto de tu colección, ej: "trialSessions"

export async function saveTrialToFirebase(
  data: TrialSessionData
): Promise<{ success: boolean; trialId?: string; error?: string }> {
  try {
    const docData = {
      ...data,
      childrenAge: Number(data.childrenAge), // Asegurarse que la edad sea un número
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // IMPORTANTE: Usa el serverTimestamp del SDK de Admin
    };

    const docRef = await db.collection(USUARIOS_COLLECTION).add(docData);
    console.log(
      "Trial session saved to Firebase (Admin SDK) with ID:",
      docRef.id
    ); // Log actualizado
    return { success: true, trialId: docRef.id };
  } catch (error) {
    console.error("Error saving trial session to Firebase (Admin SDK):", error); // Log actualizado
    const errorMessage =
      error instanceof Error ? error.message : "Unknown Firebase error";
    return { success: false, error: errorMessage };
  }
}

export async function getAlumnosFromFirebase(): Promise<{
  success: boolean;
  alumnos?: TrialSessionData[];
  error?: string;
  count?: number;
}> {
  try {
    const snapshot = await db.collection(USUARIOS_COLLECTION).get();
    if (snapshot.empty) {
      console.log("No matching documents (alumnos) found.");
      return { success: true, alumnos: [], count: 0 };
    }

    const alumnosList: TrialSessionData[] = [];
    snapshot.forEach((doc) => {
      // Es buena práctica validar o castear la data si no estás seguro de su estructura exacta
      // Aquí asumimos que la estructura coincide con TrialSessionData
      alumnosList.push({ id: doc.id, ...doc.data() } as TrialSessionData & {
        id: string;
      });
    });

    console.log(
      `Retrieved ${alumnosList.length} alumnos from Firebase (Admin SDK).`
    );
    return { success: true, alumnos: alumnosList, count: alumnosList.length };
  } catch (error) {
    console.error("Error getting alumnos from Firebase (Admin SDK):", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown Firebase error retrieving alumnos";
    return { success: false, error: errorMessage };
  }
}
