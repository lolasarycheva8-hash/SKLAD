import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger, serializeHttpRequestForLog } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

// Behind Replit's reverse proxy: trust X-Forwarded-For so req.ip is the real
// client IP. Without this, every request looks like it comes from the proxy IP
// and a single IP-based rate limiter would throttle all users together.
app.set("trust proxy", 1);

// Allowlist of origins for browser requests. In prod, restrict to the app's
// own domains (comma-separated in REPLIT_DOMAINS); in dev, allow any origin so
// the workspace preview works.
const allowedOrigins = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => `https://${d}`);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return serializeHttpRequestForLog(req);
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Security headers. Keep CSP disabled here — the SPA is served by a separate
// service, this is a JSON API, and an over-eager CSP would risk breaking it.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const isProd = process.env.NODE_ENV === "production";
if (isProd && allowedOrigins.length === 0) {
  // Fail closed: never fall back to open CORS in production.
  throw new Error(
    "REPLIT_DOMAINS must be set in production to configure the CORS allowlist",
  );
}
app.use(
  cors({
    credentials: true,
    // In prod only allow our own domains; in dev allow any origin (workspace preview).
    origin: isProd ? allowedOrigins : true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Abuse protection on the API. Keyed by authenticated user id when available so
// many users behind one NAT/proxy IP aren't throttled as a group; falls back to
// client IP for unauthenticated traffic. Limits are generous — this stops bursts
// and scraping, not normal heavy use. Health checks are exempt.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = getAuth(req)?.userId;
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  skip: (req) => req.path === "/healthz",
  message: { error: "Слишком много запросов. Попробуйте через минуту." },
});
app.use("/api", apiLimiter);

app.use("/api", router);

export default app;
