import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/mongodb";
import User from "@/models/User";

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

        // Mongoose schema handles lowercase + trim via schema options
        const email = credentials.email as string;
        const password = credentials.password as string;

        await dbConnect();

        const user = await User.findOne({ email });
        if (!user) {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          return null;
        }

        return {
          id: user._id.toString(),
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

      // Allow login/register pages
      if (pathname === "/login" || pathname === "/register") {
        if (isLoggedIn) {
          return Response.redirect(new URL("/projects", nextUrl));
        }
        return true;
      }

      // Allow root (redirect to /projects)
      if (pathname === "/") {
        return true;
      }

      // All other paths require authentication
      if (isLoggedIn) return true;

      // Return 401 for API routes, redirect for pages
      if (pathname.startsWith("/api")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Explicit redirect (more reliable than `return false` across NextAuth v5 beta builds)
      return Response.redirect(new URL("/login", nextUrl));
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
