import "./instrument";

import {
  API_VERSIONS,
  API_VERSIONS_ENUM,
  CAL_API_VERSION_HEADER,
  VERSION_2024_04_15,
  X_CAL_CLIENT_ID,
  X_CAL_PLATFORM_EMBED,
  X_CAL_SECRET_KEY,
} from "@calcom/platform-constants";
import type { ValidationError } from "@nestjs/common";
import { BadRequestException, Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { timingSafeEqual } from "node:crypto";
import cookieParser from "cookie-parser";
import { Request, Response as ExpressResponse } from "express";
import helmet from "helmet";
import { CalendarServiceExceptionFilter } from "./filters/calendar-service-exception.filter";
import { TRPCExceptionFilter } from "./filters/trpc-exception.filter";
import { HttpExceptionFilter } from "@/filters/http-exception.filter";
import { PrismaExceptionFilter } from "@/filters/prisma-exception.filter";
import { ZodExceptionFilter } from "@/filters/zod-exception.filter";

const logger: Logger = new Logger("Bootstrap");

export const bootstrap = (app: NestExpressApplication): NestExpressApplication => {
  try {
    if (!process.env.VERCEL) {
      app.enableShutdownHooks();
    }
    app.enableVersioning({
      type: VersioningType.CUSTOM,
      extractor: (request: unknown) => {
        const headerVersion = (request as Request)?.headers[CAL_API_VERSION_HEADER] as string | undefined;
        if (headerVersion && API_VERSIONS.includes(headerVersion as API_VERSIONS_ENUM)) {
          return headerVersion;
        }
        return VERSION_2024_04_15;
      },
      defaultVersion: VERSION_2024_04_15,
    });
    app.use(helmet());

    // COSMABL fork: booking mutations (create/cancel/reschedule) come only from
    // COSMABL's Edge Functions, which authenticate with a shared secret. This
    // closes the license-free v2 API's public POST /v2/bookings surface. GETs
    // stay open (a booking uid is a capability token). Registered before Nest's
    // RewriterMiddleware, so both /api/v2/* and /v2/* spellings are matched.
    // Fails closed (503) when CALDIY_API_GATE_SECRET is unset.
    const cosmablGateSecret = process.env.CALDIY_API_GATE_SECRET;
    app.use((req: Request, res: ExpressResponse, next: () => void) => {
      // req.path (parsed pathname, handles absolute-form targets), lowercased —
      // Express routes case-insensitively, so the gate must too.
      const pathname = (req.path || "").toLowerCase();
      const path = pathname.startsWith("/api/v2") ? pathname.slice(4) : pathname;
      const isBookingMutation =
        path.startsWith("/v2/bookings") && !["GET", "OPTIONS", "HEAD"].includes(req.method);
      if (!isBookingMutation) return next();
      const key = req.headers["x-cosmabl-key"];
      const ok =
        !!cosmablGateSecret &&
        typeof key === "string" &&
        key.length === cosmablGateSecret.length &&
        timingSafeEqual(Buffer.from(key), Buffer.from(cosmablGateSecret));
      if (!ok) {
        return res.status(cosmablGateSecret ? 401 : 503).json({
          status: "error",
          error: {
            code: "COSMABL_BOOKING_GATE",
            message: cosmablGateSecret
              ? "Bookings are managed by COSMABL"
              : "CALDIY_API_GATE_SECRET is not configured",
          },
        });
      }
      return next();
    });

    app.enableCors({
      origin: "*",
      methods: ["GET", "PATCH", "DELETE", "HEAD", "POST", "PUT", "OPTIONS"],
      allowedHeaders: [
        X_CAL_CLIENT_ID,
        X_CAL_SECRET_KEY,
        X_CAL_PLATFORM_EMBED,
        CAL_API_VERSION_HEADER,
        "Accept",
        "Authorization",
        "Content-Type",
        "Origin",
      ],
      maxAge: 86_400,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        validationError: {
          target: true,
          value: true,
        },
        exceptionFactory(errors: ValidationError[]): BadRequestException {
          return new BadRequestException({ errors });
        },
      })
    );
    // Exception filters, new filters go at the bottom, keep the order
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalFilters(new ZodExceptionFilter());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalFilters(new TRPCExceptionFilter());
    app.useGlobalFilters(new CalendarServiceExceptionFilter());
    app.use(cookieParser());

    if (process?.env?.API_GLOBAL_PREFIX) {
      app.setGlobalPrefix(process?.env?.API_GLOBAL_PREFIX);
    }

    return app;
  } catch (error) {
    logger.error("Error starting NestJS app:", error);
    throw error;
  }
};
