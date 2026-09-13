"use client";
// /status was "My bookings" before the app had tabs. Links to it are printed on
// posters, sat in browser histories and pasted into chats, so it stays — as a
// redirect to the Bookings tab, which is the same thing in its new place.
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function StatusRedirect() {
    const { slug } = useParams();
    const router = useRouter();

    useEffect(() => { router.replace(`/b/${slug}/bookings`); }, [slug, router]);

    return <div className="sk" style={{ height: 200 }} />;
}
