import { writeBatch, doc, getDocs, collection, query, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { LicenseRecord } from '../types';

// Pre-generated 200 distinct 8-character uppercase alphanumeric license keys
export const PREGENERATED_200_LICENSE_CODES: string[] = [
  'GL7X9K2M', 'K8M4N2P9', 'V3T9B6X1', 'Q2W8E4R7', 'Z5Y1U3I8',
  'P9O7L5K3', 'M1N3B5V7', 'C9X7Z5A3', 'S1D3F5G7', 'H9J7K5L3',
  'A2S4D6F8', 'G1H3J5K7', 'L9K8J7H6', 'Z1X2C3V4', 'B5N6M7K8',
  'P1O2I3U4', 'Y5T6R7E8', 'W9Q8Z7X6', 'C5V4B3N2', 'M9L8K7J6',
  'H5G4F3D2', 'S9A8Q7W6', 'E5R4T3Y2', 'U9I8O7P6', 'A3S5D7F9',
  'G2H4J6K8', 'L1K3J5H7', 'Z9X8C7V6', 'B4N5M6K7', 'P2O3I4U5',
  'Y6T7R8E9', 'W1Q2Z3X4', 'C6V5B4N3', 'M8L7K6J5', 'H6G5F4D3',
  'S1A2Q3W4', 'E6R5T4Y3', 'U8I7O6P5', 'A4S6D8F1', 'G3H5J7K9',
  'L2K4J6H8', 'Z8X7C6V5', 'B3N4M5K6', 'P3O4I5U6', 'Y7T8R9E1',
  'W2Q3Z4X5', 'C7V6B5N4', 'M7L6K5J4', 'H7G6F5D4', 'S2A3Q4W5',
  'E7R6T5Y4', 'U7I6O5P4', 'A5S7D9F2', 'G4H6J8K1', 'L3K5J7H9',
  'Z7X6C5V4', 'B2N3M4K5', 'P4O5I6U7', 'Y8T9R1E2', 'W3Q4Z5X6',
  'C8V7B6N5', 'M6L5K4J3', 'H8G7F6D5', 'S3A4Q5W6', 'E8R7T6Y5',
  'U6I5O4P3', 'A6S8D1F3', 'G5H7J9K2', 'L4K6J8H1', 'Z6X5C4V3',
  'B1N2M3K4', 'P5O6I7U8', 'Y9T1R2E3', 'W4Q5Z6X7', 'C9V8B7N6',
  'M5L4K3J2', 'H9G8F7D6', 'S4A5Q6W7', 'E9R8T7Y6', 'U5I4O3P2',
  'A7S9D2F4', 'G6H8J1K3', 'L5K7J9H2', 'Z5X4C3V2', 'B9N8M7K6',
  'P6O7I8U9', 'Y1T2R3E4', 'W5Q6Z7X8', 'C1V2B3N4', 'M4L3K2J1',
  'H1G2F3D4', 'S5A6Q7W8', 'E1R2T3Y4', 'U4I3O2P1', 'A8S1D3F5',
  'G7H9J2K4', 'L6K8J1H3', 'Z4X3C2V1', 'B8N7M6K5', 'P7O8I9U1',
  'Y2T3R4E5', 'W6Q7Z8X9', 'C2V3B4N5', 'M3L2K1J9', 'H2G3F4D5',
  'S6A7Q8W9', 'E2R3T4Y5', 'U3I2O1P9', 'A9S2D4F6', 'G8H1J3K5',
  'L7K9J2H4', 'Z3X2C1V9', 'B7N6M5K4', 'P8O9I1U2', 'Y3T4R5E6',
  'W7Q8Z9X1', 'C3V4B5N6', 'M2L1K9J8', 'H3G4F5D6', 'S7A8Q9W1',
  'E3R4T5Y6', 'U2I1O9P8', 'A1S3D5F7', 'G9H2J4K6', 'L8K1J3H5',
  'Z2X1C9V8', 'B6N5M4K3', 'P9O1I2U3', 'Y4T5R6E7', 'W8Q9Z1X2',
  'C4V5B6N7', 'M1L9K8J7', 'H4G5F6D7', 'S8A9Q1W2', 'E4R5T6Y7',
  'U1I9O8P7', 'K1X9M3P7', 'T8V2B4N6', 'D5F7G9H1', 'J3K5L7Q9',
  'W2E4R6T8', 'Y1U3I5O7', 'Z9X7C5V3', 'B1N3M5L7', 'P9O7I5U3',
  'R2T4Y6U8', 'I1O3P5A7', 'S9D7F5G3', 'H1J3K5L7', 'Z2C4V6B8',
  'N1M3K5J7', 'Q9W7E5R3', 'T1Y3U5I7', 'O9P7A5S3', 'D1F3G5H7',
  'J9K7L5Z3', 'X1C3V5B7', 'N9M7L5K3', 'P1Q3W5E7', 'R9T7Y5U3',
  'I2O4P6A8', 'S1D2F3G4', 'H5J6K7L8', 'Z9Y8X7W6', 'V5U4T3S2',
  'R1Q2P3O4', 'N5M6L7K8', 'J1H2G3F4', 'E5D6C7B8', 'A9Z8Y7X6',
  'W5V4U3T2', 'S1R2Q3P4', 'O5N6M7L8', 'K1J2H3G4', 'F5E6D7C8',
  'B9A8Z7Y6', 'X5W4V3U2', 'T1S2R3Q4', 'P5O6N7M8', 'L1K2J3H4',
  'G5F6E7D8', 'C9B8A7Z6', 'Y5X4W3V2', 'U1T2S3R4', 'Q5P6O7N8',
  'M1L2K3J4', 'H5G6F7E8', 'D9C8B7A6', 'Z5Y4X3W2', 'V1U2T3S4',
  'R5Q6P7O8', 'N1M2L3K4', 'J5I6H7G8', 'F1E2D3C4', 'B5A6Z7Y8',
  'X1W2V3U4', 'T5S6R7Q8', 'P1O2N3M4', 'L5K6J7H8', 'G1F2E3D4'
];

/**
 * Checks whether the `licenses` collection is already seeded.
 */
export async function isLicensesSeeded(): Promise<boolean> {
  try {
    const snap = await getDocs(query(collection(db, 'licenses'), limit(5)));
    return !snap.empty;
  } catch (error) {
    console.error('Error checking licenses:', error);
    return false;
  }
}

/**
 * Seeds all 200 pre-generated unique 8-character license codes into Firestore in a batch.
 */
export async function seed200Licenses(force = false): Promise<{ seeded: number; total: number }> {
  try {
    const alreadySeeded = await isLicensesSeeded();
    if (alreadySeeded && !force) {
      return { seeded: 0, total: 200 };
    }

    const batch = writeBatch(db);
    const now = new Date().toISOString();

    for (const code of PREGENERATED_200_LICENSE_CODES) {
      const docRef = doc(db, 'licenses', code);
      const licenseData: LicenseRecord = {
        code,
        isUsed: false,
        status: 'available',
        maxDevices: 4,
        maxPcDevices: 1,
        maxMobileDevices: 3,
        connectedDevices: [],
        createdAt: now,
      };
      batch.set(docRef, licenseData);
    }

    await batch.commit();
    return { seeded: PREGENERATED_200_LICENSE_CODES.length, total: 200 };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'licenses');
  }
}
