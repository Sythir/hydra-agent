"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unzipPackage = exports.downloadNugetPackage = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const downloadNugetPackage = async (url, destination) => {
    if (!url) {
        console.error("Error: URL cannot be empty.");
        return;
    }
    console.log(`🚀 Starting download from: ${url}`);
    try {
        // 1. Fetch the package from the provided URL.
        const response = await fetch(url);
        // Check if the request was successful.
        if (!response.ok) {
            throw new Error(`Download failed with status: ${response.status} ${response.statusText}`);
        }
        const filename = path_1.default.basename(new URL(url).pathname);
        // 3. Define the destination path in the current working directory.
        const destinationPath = path_1.default.join(destination, 'app.nupkg');
        // 4. Get the response body as an ArrayBuffer and convert it to a Node.js Buffer.
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // 5. Write the buffer to the file system.
        await promises_1.default.writeFile(destinationPath, buffer);
        console.log(`✅ Successfully downloaded ${filename} to ${destinationPath}`);
    }
    catch (error) {
        console.error(`❌ An error occurred during download:`, error);
        // Re-throwing allows the calling function to handle the error if it needs to.
        throw error;
    }
};
exports.downloadNugetPackage = downloadNugetPackage;
const unzipPackage = (pathToZip) => {
    const zip = new adm_zip_1.default();
    zip.extractAllTo(outputDir, true);
};
exports.unzipPackage = unzipPackage;
