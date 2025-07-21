// Only image and server communication utilities
import { invoke } from '@tauri-apps/api/core';

// Generate thumbnail for images
export async function generateThumbnail(filePath: string): Promise<string | undefined> {
	try {
		const { readFile } = await import('@tauri-apps/plugin-fs');
		const fileData = await readFile(filePath);
		const blob = new Blob([fileData]);
		const img = new Image();
		const url = URL.createObjectURL(blob);

		return await new Promise((resolve) => {
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = 32;
				canvas.height = 32;
				const ctx = canvas.getContext('2d');

				if (ctx) {
					ctx.drawImage(img, 0, 0, 32, 32);
					const quality = 0.3; // Reduce quality here (0.0 - 1.0)
					const base64 = canvas.toDataURL('image/jpeg', quality);
					resolve(base64);
				} else {
					resolve(undefined);
				}
				URL.revokeObjectURL(url);
			};

			img.onerror = () => {
				resolve(undefined);
				URL.revokeObjectURL(url);
			};

			img.src = url;
		});
	} catch (error) {
		console.error('Error generating thumbnail:', error);
		return undefined;
	}
}

export async function sendFilesToServer(files: string[], onProgress?: (data: any) => void): Promise<void> {
	
	const payload = files.map((path, ind) => ({ path, ind }));
	console.log(`Starting caption generation for ${files.length} files...`);

	try {
		const res = await fetch('http://localhost:5000/captions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			throw new Error(`Server responded with status: ${res.status}`);
		}

		// Stream NDJSON response
		const reader = res.body?.getReader();
		if (reader) {
			const decoder = new TextDecoder();
			let buffer = '';
			let processedCount = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				let lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.trim()) {
						try {
							const obj = JSON.parse(line);
							processedCount++;

							// Enhanced logging with progress
							if (obj.error) {
								// console.error(
								// 	`❌ Error processing file ${obj.ind + 1}/${
								// 		files.length
								// 	}:`,
								// 	obj.error
								// );
							} else {
								// console.log(
								// 	`✅ File ${processedCount}/${files.length} processed:`
								// );
								// console.log(`   📁 File: ${files[obj.ind]}`);
								// console.log(
								// 	`   📝 Caption: ${obj.name || 'No caption'}`
								// );
							}

							// Call progress callback if provided
							if (onProgress) {
								onProgress({
									...obj,
									processed: processedCount,
									total: files.length,
									fileName:
										files[obj.ind]?.split('/').pop() ||
										files[obj.ind],
								});
							}
						} catch (e) {
							console.error('❌ Failed to parse server response:', line);
						}
					}
				}
			}

			console.log(`🎉 Caption generation completed! Processed ${processedCount} files.`);
		}
	} catch (err) {
		console.error('❌ Failed to send files to server:', err);
		throw err;
	}
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
	try {
		await invoke('rename_file', { oldPath, newPath });
		// console.log(`File renamed from ${oldPath} to ${newPath}`);
	} catch (error) {
		console.error('Error renaming file:', error);
		throw error;
	}
}
