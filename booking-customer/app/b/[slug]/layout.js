// Every customer screen for one canteen sits inside the same frame: the
// canteen's name at the top, four tabs at the bottom, and one fetch of the
// canteen shared between all of them.
import BookingShell from "@/components/BookingShell";

export default function BusinessLayout({ children }) {
    return <BookingShell>{children}</BookingShell>;
}
