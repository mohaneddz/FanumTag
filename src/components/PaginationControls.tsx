import type { JSX } from "solid-js";
import { createSignal } from "solid-js";

interface PaginationControlsProps {
    currentPage: () => number;
    totalPages: () => number;
    onPageChange: (page: number) => void;
    totalItems: number;
    itemsPerPage: number;
}

export default function PaginationControls(props: PaginationControlsProps): JSX.Element {

    const [page, setPage] = createSignal(props.currentPage());
    const [canNext, setCanNext] = createSignal(page() < props.totalPages());
    const [canPrev, setCanPrev] = createSignal(props.currentPage() > 1);
    const total = props.totalPages();

    function prevPage() {
        if (canPrev()) {
            props.onPageChange(page() - 1);
            setPage(page() - 1);
            setCanNext(page() < total);
            setCanPrev(page() > 1);
        }
    }

    function nextPage() {
        if (canNext()) {
            props.onPageChange(page() + 1);
            setPage(page() + 1);
            setCanNext(page() < total);
            setCanPrev(page() > 1);
        }
    }

    return (
        <div class="flex items-center justify-center gap-4 w-full py-4">
            <button
                class="px-3 py-2 rounded-xl border border-background-light-2/30 bg-background-light-1/60 text-text-dark-1 font-semibold disabled:opacity-50"
                disabled={!canPrev}
                onClick={prevPage}
            >
                Prev
            </button>
            <span class="text-sm text-text-dark-2 font-semibold px-2">
                Page {page()} / {total} &mdash; {props.totalItems} files
            </span>
            <button
                class="px-3 py-2 rounded-xl border border-background-light-2/30 bg-background-light-1/60 text-text-dark-1 font-semibold disabled:opacity-50"
                disabled={!canNext}
                onClick={nextPage}
            >
                Next
            </button>
        </div>
    );
}