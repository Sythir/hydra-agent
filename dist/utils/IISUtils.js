"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unzipPackage = exports.downloadNugetPackage = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = __importDefault(require("fs"));
const unzipper_1 = __importDefault(require("unzipper"));
const downloadNugetPackage = async (url, destination) => {
    if (!url) {
        console.error("Error: URL cannot be empty.");
        return;
    }
    console.log(`Starting download from: ${url}`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Download failed with status: ${response.status} ${response.statusText}`);
        }
        const filename = path_1.default.basename(new URL(url).pathname);
        const destinationPath = path_1.default.join(destination, 'app.zip');
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await promises_1.default.writeFile(destinationPath, buffer);
        console.log(`Successfully downloaded ${filename} to ${destinationPath}`);
    }
    catch (error) {
        console.error(`An error occurred during download:`, error);
        throw error;
    }
};
exports.downloadNugetPackage = downloadNugetPackage;
const unzipPackage = async (pathToZip, outputDir) => {
    return new Promise((resolve, reject) => fs_1.default.createReadStream(pathToZip)
        .pipe(unzipper_1.default.Extract({ path: outputDir }))
        .on('close', () => {
        console.log(`Successfully unzipped "${pathToZip}" to "${outputDir}"`);
        resolve();
    })
        .on('error', (err) => {
        console.error("An error occurred during unzipping:", err);
        reject(err);
    }));
};
exports.unzipPackage = unzipPackage;
