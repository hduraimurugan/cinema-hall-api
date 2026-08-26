import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

// FIREBASE_PRIVATE_KEY is stored in .env with literal \n sequences (copied
// straight out of the service-account JSON's private_key field) since env
// files can't hold real newlines — un-escape them back to real newlines here.
const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });

export const messaging = getMessaging(app);
