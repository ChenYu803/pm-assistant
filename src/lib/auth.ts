import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { findMysqlUserByEmail, normalizeEmail } from "@/lib/mysql-account-workspace";
import { authClientAddress, limitAuthRequest } from "@/lib/auth-rate-limit";
import { safeCallbackUrl } from "@/lib/safe-callback";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        if (typeof credentials.email !== "string" || typeof credentials.password !== "string" || credentials.email.length > 320) return null;
        // 旧版允许超过 bcrypt 72 字节的新密码；登录保持兼容，新注册/重置单独限制。
        const email = normalizeEmail(credentials.email as string);
        const password = credentials.password as string;
        try {
          await limitAuthRequest("login-ip:" + authClientAddress(request), 60, 900);
        } catch { return null; }
        const user = await findMysqlUserByEmail(email);
        try {
          // 历史邮箱排序规则可匹配重音变体，账号额度统一绑定稳定 ID。
          await limitAuthRequest(user ? "login-user:" + user.id : "login-email:" + email, 20, 900);
        } catch { return null; }
        if (!user || user.account_status !== "active") {
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
    // 固定登录期限；只读请求不续期，避免迟到响应恢复退出后的会话。
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;
      if (pathname === "/api/health") return true;

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

      // 一次性首屏原型（本地演示），生产环境不暴露。
      if (
        process.env.NODE_ENV !== "production" &&
        pathname.startsWith("/prototype")
      ) {
        return true;
      }

      // Allow login/register pages
      if (pathname === "/login" || pathname === "/register" || pathname === "/forgot-password") {
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
      return { ...session, ...(typeof token.exp === "number" ? { expires: new Date(token.exp * 1000).toISOString() } : {}) };
    },
  },
});
