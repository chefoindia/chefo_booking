"use client";
// /login moved to /auth (sign in, create account and password reset live on one
// screen, as on the Chefo owner portal). Kept so old links and bookmarks work.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import BootSplash from "@/components/BootSplash";

export default function LoginRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/auth"); }, [router]);
    return <BootSplash label="Opening the partner portal" />;
}
