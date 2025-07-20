export interface FileInfo {
    name: string;
    size: number;
    modified: Date;
    extension: string;
    type: 'image' | 'video' | 'audio' | 'document' | 'code' | 'archive' | 'other';
    thumbnail?: string;
}

export type SortOption = 'name' | 'size' | 'modified' | 'type';
export type SortDirection = 'asc' | 'desc';