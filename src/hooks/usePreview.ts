import { createSignal, createMemo, createEffect } from 'solid-js';
import { readDir } from '@tauri-apps/plugin-fs'; // <-- REMOVED 'stat'
import type { FileInfo, SortOption, SortDirection } from '@/types/preview';
import { generateThumbnail } from '@/utils/image_caption_utils';
import { renameFile } from '@/utils/image_caption_utils';
import { useNavigate } from '@solidjs/router';
import { useLocation } from '@solidjs/router';

export function usePreview(itemsPerPage = 10) {
	// States ----------------------------------------------------------

	const [loading, setLoading] = createSignal(true);
	const [files, setFiles] = createSignal<FileInfo[]>([]);
	const [folderPath, setFolderPath] = createSignal('');
	const [searchTerm, setSearchTerm] = createSignal('');
	const [sortBy, setSortBy] = createSignal<SortOption>('name');
	const [sortDirection, setSortDirection] = createSignal<SortDirection>('asc');
	const [typeFilter, setTypeFilter] = createSignal('');
	const [currentPage, setCurrentPage] = createSignal(1);
	const [stopRequested, setStopRequested] = createSignal(false);
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

	const navigate = useNavigate();
	const location = useLocation();

	// Update Effects ------------------------------------------------

	createEffect(() => {
		searchTerm();
		typeFilter();
		setCurrentPage(1);
	});

	createEffect(() => {
		const search = location.query.folder;
		if (!search) return;

		console.log(`PREVIEW URL : ${location.pathname + location.search}`);
		console.log(`PREVIEW FOLDER: ${search}`);

		if (!search) return;

		setFolderPath(typeof search === 'string' ? search : search[0]);
		setLoading(true);
		refreshFiles().finally(() => setLoading(false));
	});

	// Memoization ------------------------------------------------

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
			if (sortBy() == 'type') {
				aVal = a.type.toLowerCase();
				bVal = b.type.toLowerCase();
				if (aVal < bVal) return sortDirection() === 'asc' ? -1 : 1;
				if (aVal > bVal) return sortDirection() === 'asc' ? 1 : -1;
			}
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

	// Helper Functions ------------------------------------------------

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
				})
				.sort((a, b) => a.name.localeCompare(b.name));

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

	async function refreshFiles() {
		const folder = folderPath();
		if (!folder) return;
		setLoading(true);
		const fetched = await fetchFiles(folder);
		console.log(`Fetched ${fetched.length} files from ${folder}`);
		console.log(
			`First 10 files: ${fetched
				.slice(0, 10)
				.map((f) => f.name)
				.join(', ')}`
		);
		setFiles(fetched);
		setLoading(false);
	}

	async function handleApplyRenames() {
		setStopRequested(false); // reset stop flag
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
			while (files().some((f) => f.name === candidate)) {
				candidate = `${baseName}_${counter}${ext}`;
				counter++;
			}
			return candidate;
		}

		for (const fileName of selected) {
			if (stopRequested()) break; // stop if refresh/stop requested
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

	async function handleApply() {
		const filesToApply = Array.from(selectedFiles()).filter((fileName) => {
			const idx = files().findIndex((f) => f.name === fileName);
			return captionResults().has(idx);
		});
		if (filesToApply.length === 0) {
			setToast({
				message: 'No selected files have generated captions to apply.',
				variant: 'warning',
				duration: 3000,
			});
			return;
		}
		setSelectedFiles(new Set(filesToApply));
		await handleApplyRenames();
		setSelectedFiles(new Set<string>());
		setCaptionResults(new Map());
		setCaptionProgress(null);
		refreshFiles && refreshFiles();
	}

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

	async function handleBack() {
		// also apply stop
		setStopRequested(true);
		setCaptionProgress(null);
		await fetch('http://localhost:5000/stop', { method: 'POST' });
		setToast({
			message: 'Caption generation stopd. You can now apply changes to processed files.',
			variant: 'info',
			duration: 3000,
		});

		navigate('/', { replace: true });
		window.location.hash = '';
	}

	function handleSortChange(sort: SortOption, direction: SortDirection) {
		setSortBy(sort);
		setSortDirection(direction);
	}

	return {
		loading,
		files,
		folderPath,
		searchTerm,
		sortBy,
		sortDirection,
		typeFilter,
		currentPage,
		availableTypes,
		filteredFiles,
		paginatedFiles,
		totalPages,
		handleApply,
		handleBack,
		handleSortChange,
		itemsPerPage,
		refreshFiles,
		captionProgress,
		captionResults,
		selectedFiles,
		toast,
		stopRequested,

		setSearchTerm,
		setSortDirection,
		setTypeFilter,
		setCurrentPage,
		setCaptionProgress,
		setCaptionResults,
		setSelectedFiles,
		setToast,
		setStopRequested,
	};
}
