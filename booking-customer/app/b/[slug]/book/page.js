"use client";
// /book was the booking form's own page before the form became a bottom sheet.
// Printed links, browser histories and anything a customer bookmarked still
// point here, so it stays — and opens the sheet over Home instead.
import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useBooking } from "@/components/BookingShell";

export default function BookRedirect() {
    return (
        <Suspense fallback={<div className="sk" style={{ height: 220 }} />}>
            <Redirect />
        </Suspense>
    );
}

function Redirect() {
    const { slug } = useParams();
    const router = useRouter();
    const params = useSearchParams();
    const { openBooking } = useBooking();

    useEffect(() => {
        openBooking({ date: params.get("date") || "", meal: params.get("meal") || "" });
        router.replace(`/b/${slug}`);
    }, [slug, params, router, openBooking]);

    return <div className="sk" style={{ height: 220 }} />;
}
