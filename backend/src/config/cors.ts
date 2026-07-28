import { env } from "./env.js";

const developmentOrigin =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (origin === env.FRONTEND_URL) return true;
  return process.env.NODE_ENV !== "production" && developmentOrigin.test(origin);
}
