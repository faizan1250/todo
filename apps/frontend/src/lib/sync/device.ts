import { v7 as uuidv7 } from "uuid";
import { db } from "./db";

const DEVICE_ID_KEY = "deviceId";

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await db.meta.get(DEVICE_ID_KEY);
  if (existing && typeof existing.value === "string" && existing.value.length > 0) {
    return existing.value;
  }
  const id = uuidv7();
  await db.meta.put({ key: DEVICE_ID_KEY, value: id });
  return id;
}