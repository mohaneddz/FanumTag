import { createSignal, createMemo, createEffect, onMount } from 'solid-js';
import { readDir } from '@tauri-apps/plugin-fs'; // <-- REMOVED 'stat'
import type { FileInfo, SortOption, SortDirection } from '@/types/preview';
import { generateThumbnail } from '@/utils/image_caption_utils';
import { renameFile } from '@/utils/image_caption_utils';
import { useNavigate } from '@solidjs/router';

// Helper for file icons (move to UI if needed)
import { FileImage, Video, Volume2, Code, Archive, FileSpreadsheet, FileText, File } from 'lucide-solid';

function getFileIcon(type: string) {
	switch (type) {
		case 'image':
			return FileImage;
		case 'video':
			return Video;
		case 'audio':
			return Volume2;
		case 'code':
			return Code;
		case 'archive':
			return Archive;
		case 'spreadsheet':
			return FileSpreadsheet;
		case 'document':
			return FileText;
		default:
			return File;
	}
}

export function usePreview(itemsPerPage = 10) {
	// State
	const [loading, setLoading] = createSignal(true);
	const [files, setFiles] = createSignal<FileInfo[]>([]);
	const [previewing, setPreviewing] = createSignal(false);
	const [comparisons, setComparisons] = createSignal<{ before: string; after: string }[]>([]);
	const [folderPath, setFolderPath] = createSignal('');
	const [searchTerm, setSearchTerm] = createSignal('');
	const [sortBy, setSortBy] = createSignal<SortOption>('name');
	const [sortDirection, setSortDirection] = createSignal<SortDirection>('asc');
	const [typeFilter, setTypeFilter] = createSignal('');
	const [currentPage, setCurrentPage] = createSignal(1);

	const navigate = useNavigate();

	const [captionProgress, setCaptionProgress] = createSignal<{
		processed: number;
		total: number;
		currentFile?: string;
	} | null>(null);
	const [captionResults, setCaptionResults] = createSignal<Map<number, string>>(new Map());
	const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set());
	const [toast, setToast] = createSignal<{
		message: string;
		variant: 'success' | 'error' | 'warning' | 'info';
		duration?: number;
	} | null>(null);
	const [cancelRequested, setCancelRequested] = createSignal(false);

	// Helpers
	function getFileType(extension: string): FileInfo['type'] {
		const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
		const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
		const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma'];
		const documentExts = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt'];
		const codeExts = ['.js', '.ts', '.html', '.css', '.py', '.java', '.cpp', '.c', '.rs', '.go'];
		const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz'];
		const ext = extension.toLowerCase();
		if (imageExts.includes(ext)) return 'image';
		if (videoExts.includes(ext)) return 'video';
		if (audioExts.includes(ext)) return 'audio';
		if (documentExts.includes(ext)) return 'document';
		if (codeExts.includes(ext)) return 'code';
		if (archiveExts.includes(ext)) return 'archive';
		return 'other';
	}

	function getFolderFromSearch() {
		const params = new URLSearchParams(window.location.search);
		const folder = params.get('folder');
		return folder ? decodeURIComponent(folder) : '';
	}

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	// Fetch files from folder
	// --- MODIFIED SECTION ---
	// Fetch files with name, size, type, and thumbnail (async thumbnail loading)
	async function fetchFiles(folder: string): Promise<FileInfo[]> {
		try {
			const entries = await readDir(folder);
			const fileInfos: FileInfo[] = entries
				.filter((entry) => entry.name && !entry.isDirectory)
				.map((entry) => {
					const extension = entry.name.includes('.')
						? '.' + entry.name.split('.').pop()
						: '';
					const type = getFileType(extension);
					return {
						name: entry.name!,
						size: 0,
						modified: new Date(),
						extension,
						type,
						thumbnail: undefined,
					};
				});

			// Async thumbnail loading
			await Promise.all(
				fileInfos.map(async (file, idx) => {
					if (file.type === 'image') {
						try {
							const thumb = await generateThumbnail(folder + '/' + file.name);
							fileInfos[idx].thumbnail = thumb;
						} catch (e) {
							console.warn('Thumbnail generation failed for', file.name, e);
						}
					}
				})
			);

			return fileInfos;
		} catch (error) {
			console.error('Error reading directory:', error);
			return [];
		}
	}

	// --- END MODIFIED SECTION ---

	// Add refreshFiles function (async)
	async function refreshFiles() {
		const folder = folderPath();
		if (!folder) return;
		setLoading(true);
		const fetched = await fetchFiles(folder);
		setFiles(fetched);
		setLoading(false);
	}

	// Dummy compareFiles
	async function compareFiles(files: FileInfo[]): Promise<{ before: string; after: string }[]> {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		function truncate(name: string, max = 32) {
			return name.length > max ? name.slice(0, max - 3) + '...' : name;
		}
		return files.map((f) => ({
			before: `${truncate(f.name)}`,
			after: `${truncate(f.name)}`,
		}));
	}

	// Computed
	const availableTypes = createMemo(() => {
		const types = [...new Set(files().map((f) => f.type))];
		return types.sort();
	});

	const filteredFiles = createMemo(() => {
		let filtered = files();
		if (searchTerm()) {
			const term = searchTerm().toLowerCase();
			filtered = filtered.filter(
				(f) =>
					f.name.toLowerCase().includes(term) ||
					f.type.toLowerCase().includes(term) ||
					f.extension.toLowerCase().includes(term)
			);
		}
		if (typeFilter()) {
			filtered = filtered.filter((f) => f.type === typeFilter());
		}
		filtered = [...filtered].sort((a, b) => {
			let aVal: any, bVal: any;
			switch (sortBy()) {
				case 'name':
					aVal = a.name.toLowerCase();
					bVal = b.name.toLowerCase();
					break;
				case 'size':
					aVal = a.size;
					bVal = b.size;
					break;
				case 'modified':
					aVal = a.modified.getTime();
					bVal = b.modified.getTime();
					break;
				case 'type':
					aVal = a.type.toLowerCase();
					bVal = b.type.toLowerCase();
					break;
				default:
					aVal = a.name.toLowerCase();
					bVal = b.name.toLowerCase();
			}
			if (aVal < bVal) return sortDirection() === 'asc' ? -1 : 1;
			if (aVal > bVal) return sortDirection() === 'asc' ? 1 : -1;
			return 0;
		});
		return filtered;
	});

	const paginatedFiles = createMemo(() => {
		const start = (currentPage() - 1) * itemsPerPage;
		const end = start + itemsPerPage;
		return filteredFiles().slice(start, end);
	});

	const totalPages = createMemo(() => {
		return Math.ceil(filteredFiles().length / itemsPerPage);
	});

	createEffect(() => {
		searchTerm();
		typeFilter();
		setCurrentPage(1);
	});

	onMount(() => {
		const folder = getFolderFromSearch();
		setFolderPath(folder);
		setLoading(true);
		// print url
		console.log(`PREVIEW URL : ${window.location.href}`);
		// Async fetch on mount
		refreshFiles().finally(() => setLoading(false));
	});

	const handlePreview = async () => {
		setPreviewing(true);
		setComparisons([]);
		await new Promise((resolve) => setTimeout(resolve, 500));
		const result = await compareFiles(filteredFiles());
		setComparisons(result);
		setPreviewing(false);
	};

	// Helper: check if file exists in current folder
	function fileExists(name: string): boolean {
		return files().some((f) => f.name === name);
	}

	// Modified handleApply for batch renaming
	async function handleApplyRenames() {
		setCancelRequested(false); // reset cancel flag
		const selected = Array.from(selectedFiles());
		if (selected.length === 0) {
			setToast({ message: 'Please select files to apply changes to.', variant: 'warning' });
			return;
		}
		let renamedCount = 0;
		let errorCount = 0;
		let longOpTimeout: any;
		let finished = false;

		// Show warning if operation takes longer than 5s
		longOpTimeout = setTimeout(() => {
			if (!finished)
				setToast({
					message: 'Renaming is taking longer than expected...',
					variant: 'info',
					duration: 4000,
				});
		}, 5000);

		// Helper to get "after" name for a file (from captionResult)
		function getAfterName(fileName: string): string | undefined {
			const fileIndex = files().findIndex((f) => f.name === fileName);
			const caption = captionResults().get(fileIndex);
			if (!caption) return undefined;
			// If caption is a filename, use it; otherwise, fallback to fileName
			return caption !== fileName ? caption : undefined;
		}

		// Helper: get extension from filename
		function getExtension(fileName: string): string {
			const idx = fileName.lastIndexOf('.');
			return idx !== -1 ? fileName.slice(idx) : '';
		}

		// Helper: generate a unique filename if target exists
		function getUniqueName(baseName: string, ext: string): string {
			let candidate = baseName + ext;
			let counter = 1;
			while (fileExists(candidate)) {
				candidate = `${baseName}_${counter}${ext}`;
				counter++;
			}
			return candidate;
		}

		for (const fileName of selected) {
			if (cancelRequested()) break; // stop if refresh/cancel requested
			const afterNameRaw = getAfterName(fileName);
			if (!afterNameRaw) continue; // Only rename if "after" name is available and different
			const fileObj = files().find((f) => f.name === fileName);
			if (!fileObj) continue;
			const ext = getExtension(fileName);
			// Remove extension from afterNameRaw if present
			const afterBase = afterNameRaw.endsWith(ext)
				? afterNameRaw.slice(0, -ext.length)
				: afterNameRaw;
			let targetName = getUniqueName(afterBase, ext);
			const oldPath = folderPath() + '/' + fileName;
			const newPath = folderPath() + '/' + targetName;
			if (oldPath === newPath) continue;
			try {
				await renameFile(oldPath, newPath);
				renamedCount++;
			} catch (err) {
				errorCount++;
				setToast({
					message: `Failed to rename ${fileName}: ${err}`,
					variant: 'error',
					duration: 5000,
				});
			}
		}
		finished = true;
		clearTimeout(longOpTimeout);
		refreshFiles && refreshFiles();
		if (renamedCount > 0) {
			setToast({
				message: `Renamed ${renamedCount} file${renamedCount !== 1 ? 's' : ''}.`,
				variant: 'success',
				duration: 3500,
			});
		}
		if (renamedCount === 0 && errorCount === 0) {
			setToast({ message: 'No files were renamed.', variant: 'info', duration: 3000 });
		}
	}

	const handleBack = () => {
		navigate('/', { replace: true });
		window.location.hash = '';
	};

	const handleSortChange = (sort: SortOption, direction: SortDirection) => {
		setSortBy(sort);
		setSortDirection(direction);
	};

	return {
		loading,
		files,
		previewing,
		comparisons,
		folderPath,
		searchTerm,
		sortBy,
		sortDirection,
		typeFilter,
		currentPage,
		setSearchTerm,
		setSortBy,
		setSortDirection,
		setTypeFilter,
		setCurrentPage,
		availableTypes,
		filteredFiles,
		paginatedFiles,
		totalPages,
		handlePreview,
		handleApplyRenames,
		handleBack,
		handleSortChange,
		itemsPerPage,
		getFileType,
		formatFileSize,
		fetchFiles,
		compareFiles,
		getFileIcon,
		refreshFiles,
		captionProgress,
		setCaptionProgress,
		captionResults,
		setCaptionResults,
		selectedFiles,
		setSelectedFiles,
		toast,
		setToast,
		cancelRequested,
		setCancelRequested,
		fileExists,
	};
}
