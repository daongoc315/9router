import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

const LOGIN_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);
const LOGIN_BLOCK_MS = Number(process.env.LOGIN_RATE_LIMIT_BLOCK_MS || 15 * 60 * 1000);
const loginAttempts = new Map();

function getClientIdentifier(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim();
  if (firstForwardedIp) return firstForwardedIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const host = request.headers.get("host") || "unknown-host";
  return `host:${host}`;
}

function getRateLimitStatus(clientId) {
  const now = Date.now();
  const entry = loginAttempts.get(clientId);
  if (!entry) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  if (entry.blockedUntil && entry.blockedUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  if (entry.windowStart + LOGIN_WINDOW_MS <= now) {
    loginAttempts.delete(clientId);
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

function markLoginFailure(clientId) {
  const now = Date.now();
  const entry = loginAttempts.get(clientId);

  if (!entry || entry.windowStart + LOGIN_WINDOW_MS <= now) {
    loginAttempts.set(clientId, { attempts: 1, windowStart: now, blockedUntil: 0 });
    return;
  }

  const attempts = entry.attempts + 1;
  const blockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0;
  loginAttempts.set(clientId, {
    attempts,
    windowStart: entry.windowStart,
    blockedUntil,
  });
}

function clearLoginFailures(clientId) {
  loginAttempts.delete(clientId);
}

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const clientId = getClientIdentifier(request);
    const rateLimitStatus = getRateLimitStatus(clientId);
    if (rateLimitStatus.blocked) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitStatus.retryAfterSeconds),
          },
        }
      );
    }

    const { password } = await request.json();
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    // Default password is '123456' if not set
    const storedHash = settings.password;

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // Use env var or default
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      isValid = password === initialPassword;
    }

    if (isValid) {
      clearLoginFailures(clientId);

      const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
      const forwardedProto = request.headers.get("x-forwarded-proto");
      const isHttpsRequest = forwardedProto === "https";
      const useSecureCookie = forceSecureCookie || isHttpsRequest;

      const token = await new SignJWT({ authenticated: true })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("24h")
        .sign(SECRET);

      const cookieStore = await cookies();
      cookieStore.set("auth_token", token, {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: "lax",
        path: "/",
      });

      return NextResponse.json({ success: true });
    }

    markLoginFailure(clientId);

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
