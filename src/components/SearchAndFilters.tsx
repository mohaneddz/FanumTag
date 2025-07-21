import { For } from "solid-js";
import type { SortOption, SortDirection } from "@/types/preview";
import { ArrowUp, ArrowDown } from "lucide-solid";

interface SearchAndFiltersProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    sortBy: SortOption;
    sortDirection: SortDirection;
    onSortChange: (sort: SortOption, direction: SortDirection) => void;
    typeFilter: string;
    onTypeFilterChange: (type: string) => void;
    availableTypes: string[];
}

export default function SearchAndFilters(props: SearchAndFiltersProps) {
    return (
        <div class="flex flex-col md:flex-row md:items-center gap-4 w-full">
            {/* Search */}
            <input
                type="text"
                class="h-10 px-4 py-2 rounded-md border border-background-light-2/30 bg-background-light-1/60 text-text-dark-1 focus:outline-none focus:border-primary w-full flex-grow md:w-64 hover:cursor-pointer hover:brightness-105"
                placeholder="Search files..."
                value={props.searchTerm}
                onInput={e => props.onSearchChange((e.target as HTMLInputElement).value)}
            />

            {/* Type Filter with custom arrow */}
            <div class="relative w-full md:w-auto">
                <select
                    class="h-10 px-4 py-2 pr-8 rounded-xl border border-background-light-2/30 bg-background-light-1/60 text-text-dark-1 focus:outline-none focus:border-primary hover:cursor-pointer hover:brightness-105 w-full"
                    value={props.typeFilter}
                    onChange={e => props.onTypeFilterChange((e.target as HTMLSelectElement).value)}
                >
                    <option value="" class="bg-background-light-1 text-text-dark-1">All Types</option>
                    <For each={props.availableTypes}>
                        {type => <option value={type} class="bg-background-light-1 text-text-dark-1">{type.charAt(0).toUpperCase() + type.slice(1)}</option>}
                    </For>
                </select>
                <span class="pointer-events-none absolute right-3 top-1/2 transform -translate-y-1/2 text-text-dark-2">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                        <path d="M6 8L10 12L14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </div>

            {/* Sort with custom arrow */}
            <div class="flex items-center gap-2 h-10">
                <label class="text-xs text-text-dark-2">Sort by:</label>
                <div class="relative">
                    <select
                        class="h-10 px-2 py-1 pr-8 rounded border border-background-light-2/30 bg-background-light-1/60 text-text-dark-1 focus:outline-none focus:border-primary"
                        value={props.sortBy}
                        onChange={e => {props.onSortChange(e.target.value as SortOption, props.sortDirection);
                            console.log(`Sort changed to ${e.target.value} ${props.sortDirection}`);
                            console.log(`Total available types: ${props.availableTypes.length}`);
                        }}
                    >
                        <option value="name" class="bg-background-light-1 text-text-dark-1">Name</option>
                        <option value="type" class="bg-background-light-1 text-text-dark-1">Type</option>
                    </select>
                    <span class="pointer-events-none absolute right-2 top-1/2 transform -translate-y-1/2 text-text-dark-2">
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                            <path d="M6 8L10 12L14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                </div>
                <button
                    class="h-10 aspect-square border border-background-light-2/30 bg-background-light-3/60 text-text-dark-1 flex items-center justify-center hover:cursor-pointer hover:brightness-105 rounded-full hover:scale-110 transition duration-100"
                    onClick={() => props.onSortChange(props.sortBy, props.sortDirection === "asc" ? "desc" : "asc")}
                    title="Toggle sort direction"
                >
                   {props.sortDirection === "asc" ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
                </button>
            </div>
        </div>
    );
}