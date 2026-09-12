"use client";
// components/Skeleton.js — content-shaped loading placeholders (Chefo's).
// A spinner says "something is happening"; a skeleton says "this is what's
// arriving and roughly how much", so the page doesn't lurch when real
// content lands. The sweep animates `transform`, staying on the compositor.

function Shimmer({ className = "", style }) {
    return <span className={`sk ${className}`} style={style} aria-hidden="true" />;
}

export function SkeletonLine({ w = "100%", h = 12, style }) {
    return <Shimmer style={{ width: w, height: h, borderRadius: 6, ...style }} />;
}

export function SkeletonCircle({ size = 36, style }) {
    return <Shimmer style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, ...style }} />;
}

export function SkeletonTiles({ count = 4 }) {
    return (
        <div className="sk-tiles">
            {Array.from({ length: count }).map((_, i) => (
                <div className="sk-tile" key={i}>
                    <SkeletonLine w="52%" h={22} />
                    <SkeletonLine w="74%" h={10} style={{ marginTop: 10 }} />
                </div>
            ))}
        </div>
    );
}

export function SkeletonCards({ count = 3, lines = 3 }) {
    return (
        <div className="sk-cards">
            {Array.from({ length: count }).map((_, i) => (
                <div className="sk-card" key={i}>
                    <div className="sk-row-between">
                        <SkeletonLine w={80} h={10} />
                        <SkeletonLine w={54} h={18} style={{ borderRadius: 999 }} />
                    </div>
                    <SkeletonLine w="45%" h={30} style={{ margin: "14px 0 6px" }} />
                    {Array.from({ length: lines }).map((_, j) => (
                        <div key={j} style={{ marginTop: 12 }}>
                            <SkeletonLine w={70} h={9} />
                            <SkeletonLine h={9} style={{ marginTop: 7, borderRadius: 999 }} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export function SkeletonTable({ rows = 6, cols = 5, head = true }) {
    return (
        <div className="sk-table" role="status" aria-label="Loading">
            {head && (
                <div className="sk-tr sk-thead">
                    {Array.from({ length: cols }).map((_, i) => (
                        <div className="sk-td" key={i} style={{ flex: i === 0 ? 2 : 1 }}>
                            <SkeletonLine w={i === 0 ? "40%" : "55%"} h={9} />
                        </div>
                    ))}
                </div>
            )}
            {Array.from({ length: rows }).map((_, r) => (
                <div className="sk-tr" key={r}>
                    {Array.from({ length: cols }).map((_, i) => (
                        <div className="sk-td" key={i} style={{ flex: i === 0 ? 2 : 1 }}>
                            {i === 0 ? (
                                <>
                                    <SkeletonLine w="62%" h={12} />
                                    <SkeletonLine w="38%" h={9} style={{ marginTop: 6 }} />
                                </>
                            ) : (
                                <SkeletonLine w={`${55 + ((r + i) % 3) * 12}%`} h={12} />
                            )}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export function SkeletonList({ rows = 4 }) {
    return (
        <div className="sk-list" role="status" aria-label="Loading">
            {Array.from({ length: rows }).map((_, i) => (
                <div className="sk-li" key={i}>
                    <SkeletonCircle size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <SkeletonLine w="46%" h={13} />
                        <SkeletonLine w="28%" h={10} style={{ marginTop: 7 }} />
                    </div>
                    <SkeletonLine w={64} h={22} style={{ borderRadius: 999 }} />
                </div>
            ))}
        </div>
    );
}

export default function SkeletonPage({ tiles = 4, cards = 3 }) {
    return (
        <div role="status" aria-label="Loading">
            <div className="sk-head">
                <SkeletonLine w={190} h={22} />
                <SkeletonLine w={130} h={11} style={{ marginTop: 9 }} />
            </div>
            <SkeletonTiles count={tiles} />
            <SkeletonCards count={cards} />
        </div>
    );
}
