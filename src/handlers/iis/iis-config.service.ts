import fs from 'fs';
import path from 'path';
import { IisConfigFile } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';

/**
 * Deep merges two objects, with source values overriding target values
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Checks if a value is a plain object (not array, null, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges two JSON strings
 */
function mergeJson(existing: string, incoming: string): string {
  const existingObj = existing ? JSON.parse(existing) : {};
  const incomingObj = JSON.parse(incoming);
  const merged = deepMerge(existingObj, incomingObj);
  return JSON.stringify(merged, null, 2);
}

/**
 * Parses a dotenv/key-value string into an object
 */
function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex > 0) {
      const key = trimmed.substring(0, equalIndex).trim();
      let value = trimmed.substring(equalIndex + 1).trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * Merges two dotenv/key-value strings
 */
function mergeDotenv(existing: string, incoming: string): string {
  const existingVars = parseDotenv(existing || '');
  const incomingVars = parseDotenv(incoming);
  const merged = { ...existingVars, ...incomingVars };
  return Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

/**
 * Simple XML merge that updates/adds elements at the first level
 * For more complex XML merging, consider using a proper XML library
 */
function mergeXml(existing: string, incoming: string): string {
  // For XML, we'll do a simple strategy:
  // - Parse both as strings and do element-level merging
  // This is a simplified implementation - for production, consider using xml2js or fast-xml-parser

  if (!existing || existing.trim() === '') {
    return incoming;
  }

  // Simple regex-based XML merge for configuration files
  // Extract root element from incoming
  const incomingMatch = incoming.match(/<(\w+)[^>]*>([\s\S]*)<\/\1>/);
  if (!incomingMatch) {
    return incoming;
  }

  const rootTag = incomingMatch[1];
  const incomingContent = incomingMatch[2];

  // Extract root element from existing
  const existingMatch = existing.match(/<(\w+)[^>]*>([\s\S]*)<\/\1>/);
  if (!existingMatch || existingMatch[1] !== rootTag) {
    return incoming;
  }

  // For each element in incoming, update or add to existing
  // This is a simplified approach - finds top-level elements and merges them
  const elementPattern = /<(\w+)(?:\s[^>]*)?>[\s\S]*?<\/\1>|<(\w+)(?:\s[^>]*)?\/>/g;
  const incomingElements = new Map<string, string>();

  let match;
  while ((match = elementPattern.exec(incomingContent)) !== null) {
    const tagName = match[1] || match[2];
    incomingElements.set(tagName, match[0]);
  }

  let result = existing;
  for (const [tagName, element] of incomingElements) {
    const existingElementPattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>|<${tagName}(?:\\s[^>]*)?\\/>`, 'g');
    if (existingElementPattern.test(result)) {
      // Replace existing element
      result = result.replace(existingElementPattern, element);
    } else {
      // Add before closing root tag
      result = result.replace(new RegExp(`<\\/${rootTag}>`), `  ${element}\n</${rootTag}>`);
    }
  }

  return result;
}

/**
 * Merges config file content based on file type
 */
function mergeConfigContent(existing: string, incoming: string, type: string): string {
  switch (type.toLowerCase()) {
    case 'json':
      return mergeJson(existing, incoming);
    case 'dotenv':
    case 'env':
    case 'properties':
      return mergeDotenv(existing, incoming);
    case 'xml':
      return mergeXml(existing, incoming);
    default:
      // For unknown types, just override
      return incoming;
  }
}

/**
 * Deploys a single config file with the specified strategy
 */
export async function deployConfigFile(
  config: IisConfigFile,
  deployFolder: string,
  logger: LoggerFunc,
): Promise<void> {
  // Build the full file path
  const relativePath = config.path || '';
  const fullPath = path.join(deployFolder, relativePath, config.name);
  const dirPath = path.dirname(fullPath);

  logger(deployFolder, 'info', `Processing config file: ${config.name} (strategy: ${config.deployStrategy})`);

  // Handle skip strategy
  if (config.deployStrategy === 'skip') {
    logger(deployFolder, 'info', `Skipping config file: ${config.name}`);
    return;
  }

  // Ensure directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  try {
    if (config.deployStrategy === 'override') {
      // Override: write file directly
      fs.writeFileSync(fullPath, config.data, 'utf8');
      logger(deployFolder, 'info', `Config file overwritten: ${config.name}`);
    } else if (config.deployStrategy === 'merge') {
      // Merge: read existing file and merge
      let existing = '';
      if (fs.existsSync(fullPath)) {
        existing = fs.readFileSync(fullPath, 'utf8');
      }

      const merged = mergeConfigContent(existing, config.data, config.type);
      fs.writeFileSync(fullPath, merged, 'utf8');
      logger(deployFolder, 'info', `Config file merged: ${config.name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new DeploymentError(
      `Failed to deploy config file '${config.name}': ${errorMessage}`,
      DeploymentErrorCodes.CONFIG_MERGE_FAILED,
      { fileName: config.name, strategy: config.deployStrategy },
    );
  }
}

/**
 * Deploys all config files
 */
export async function deployConfigFiles(
  configs: IisConfigFile[],
  deployFolder: string,
  logger: LoggerFunc,
): Promise<void> {
  if (configs.length === 0) {
    logger(deployFolder, 'info', 'No config files to deploy');
    return;
  }

  logger(deployFolder, 'info', `Deploying ${configs.length} config file(s)`);

  for (const config of configs) {
    await deployConfigFile(config, deployFolder, logger);
  }

  logger(deployFolder, 'info', 'All config files deployed successfully');
}
