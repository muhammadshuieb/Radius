import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export const WHATSAPP_QUEUE = "whatsapp";

export const whatsappQueue = new Queue(WHATSAPP_QUEUE, { connection: redisConnection });
