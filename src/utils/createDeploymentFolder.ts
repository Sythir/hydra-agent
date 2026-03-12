import path from "path";
import { createDirectoryIfNotExists } from "./createDirectoryIfNotExists";
import { createDeployHash } from "./createDeployHash";
import { DEPLOYMENT_FOLDER_NAME } from "../config/constants";
import { Message } from "../types/DeploymentMessage";

export const createDeploymentFolder = (logger: any, message: Message): string | null => {

  const folderLocation = path.join(process.env.DEPLOYMENT_DIRECTORY || DEPLOYMENT_FOLDER_NAME);
  if (!createDirectoryIfNotExists(folderLocation, logger))
    return null;

  const uniqueHash = createDeployHash();
  const deployFolderName = path.join(
    folderLocation,
    message.project.code,
    message.application.code,
    message.environment.name,
    `${message.version.version}-${uniqueHash}`,
  );


  return deployFolderName;
}
