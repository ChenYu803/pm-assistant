import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { findMysqlUserByEmail, normalizeEmail } from "@/lib/mysql-account-workspace";
import { safeCallbackUrl } from "@/lib/safe-callback";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = normalizeEmail(credentials.email as string);
        const password = credentials.password as string;
        const user = await findMysqlUserByEmail(email);
        if (!user) {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      // Allow public auth API routes (register, login, session)
      if (pathname.startsWith("/api/auth")) {
        return true;
      }

      // 综合回放在发起聊天前检查服务端模式；生产环境不暴露此验证状态。
      if (
        process.env.NODE_ENV !== "production" &&
        pathname === "/api/verify/replay-mode"
      ) {
        return true;
      }

      // Allow login/register pages
      if (pathname === "/login" || pathname === "/register") {
        if (isLoggedIn) {
          return Response.redirect(new URL(safeCallbackUrl(nextUrl.searchParams.get("callbackUrl"), "/projects"), nextUrl));
        }
        return true;
      }

      // Allow root (redirect to /projects)
      if (pathname === "/") {
        return true;
      }

      // 入职开场是游客可直接访问的预编排内容；后续受保护页面按票据单独放行。
      if (pathname === "/onboarding/brief" || pathname === "/onboarding/scenes" || pathname === "/onboarding/assessment") {
        return true;
      }

      // All other paths require authentication
      if (isLoggedIn) return true;

      // Return 401 for API routes, redirect for pages
      if (pathname.startsWith("/api")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Explicit redirect (more reliable than `return false` across NextAuth v5 beta builds)
      const loginUrl = new URL("/login", nextUrl);
      if (nextUrl.pathname !== "/login" && nextUrl.pathname !== "/register") {
        loginUrl.searchParams.set("callbackUrl", `${nextUrl.pathname}${nextUrl.search}`);
      }
      return Response.redirect(loginUrl);
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
});
