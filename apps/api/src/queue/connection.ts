import { Redis } from "ioredis";
import { config } from "../config.js";

export const redisConnection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
