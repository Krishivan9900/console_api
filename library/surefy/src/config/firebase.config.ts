import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import * as fs from 'fs';

// Firebase App Initialization
export const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
  }),
  storageBucket: process.env.FIREBASE_BUCKET,
});

// Firebase Storage Bucket
export const bucket = getStorage(app).bucket();

/**
 * Upload image to Firebase Storage
 */
export const uploadImage = async (
  file: Express.Multer.File
): Promise<string> => {
  try {
    const fileName = `products/${Date.now()}-${file.originalname}`;

    const firebaseFile = bucket.file(fileName);

    const fileBuffer = await fs.promises.readFile(file.path);

    await firebaseFile.save(fileBuffer, {
      metadata: {
        contentType: file.mimetype,
      },
    });

    await firebaseFile.makePublic();

    const mediaUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    console.log('✅ Image uploaded:', mediaUrl);

    return mediaUrl;
  } catch (error) {
    console.error('❌ Firebase upload error:', error);
    throw error;
  }
};