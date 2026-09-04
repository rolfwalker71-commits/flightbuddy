import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const publicPaths = [
  "/login",
  "/register",
  "/api/auth",
  "/api/health",
  "/s",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (
    publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/mockups")
  ) {
    return NextResponse.next();
  }
  // Empty id = stale JWT after DB wipe; treat as logged out (avoids login↔/ redirect loop).
  if (!req.auth?.user?.id) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
