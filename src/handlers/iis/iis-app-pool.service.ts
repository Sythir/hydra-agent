import { IisAppPoolConfig } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

export async function appPoolExists(
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<boolean> {
  const result = await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    if (Test-Path "IIS:\\AppPools\\${escapePowerShellString(appPoolName)}") {
      Write-Output "EXISTS"
    } else {
      Write-Output "NOT_EXISTS"
    }
    `,
    logger,
    deployFolder,
  );
  return result.includes('EXISTS') && !result.includes('NOT_EXISTS');
}

export async function createAppPool(
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Creating application pool: ${appPoolName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    New-WebAppPool -Name '${escapePowerShellString(appPoolName)}'
    Write-Output "App pool created successfully"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_APP_POOL_CREATION_FAILED,
  );
}

export async function configureAppPool(
  config: IisAppPoolConfig,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const appPoolPath = `IIS:\\AppPools\\${escapePowerShellString(config.name)}`;
  logger(deployFolder, 'info', `Configuring application pool: ${config.name}`);

  const commands: string[] = [
    `Import-Module WebAdministration`,
    `$appPoolPath = '${appPoolPath}'`,
  ];

  commands.push(
    `Set-ItemProperty $appPoolPath -Name "managedRuntimeVersion" -Value '${escapePowerShellString(config.managedRuntimeVersion)}'`,
  );

  const pipelineMode = config.managedPipelineMode === 'Integrated' ? 0 : 1;
  commands.push(`Set-ItemProperty $appPoolPath -Name "managedPipelineMode" -Value ${pipelineMode}`);

  commands.push(
    `Set-ItemProperty $appPoolPath -Name "processModel.idleTimeout" -Value ([TimeSpan]::FromMinutes(${config.idleTimeout}))`,
  );

  const startMode = config.startMode === 'AlwaysRunning' ? 1 : 0;
  commands.push(`Set-ItemProperty $appPoolPath -Name "startMode" -Value ${startMode}`);

  await configureAppPoolIdentity(config, commands, logger, deployFolder);

  const script = commands.join('\n') + '\nWrite-Output "App pool configured successfully"';
  await executePowerShellOrThrow(script, logger, deployFolder, DeploymentErrorCodes.IIS_APP_POOL_CONFIG_FAILED);
}

async function configureAppPoolIdentity(
  config: IisAppPoolConfig,
  commands: string[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const appPoolPath = `IIS:\\AppPools\\${escapePowerShellString(config.name)}`;

  const identityTypeMap: Record<string, number> = {
    LocalSystem: 0,
    LocalService: 1,
    NetworkService: 2,
    SpecificUser: 3,
    ApplicationPoolIdentity: 4,
  };

  const identityType = identityTypeMap[config.identity] ?? 4;
  commands.push(`Set-ItemProperty '${appPoolPath}' -Name "processModel.identityType" -Value ${identityType}`);

  if (config.identity === 'SpecificUser') {
    commands.push(`Set-ItemProperty '${appPoolPath}' -Name "processModel.userName" -Value '${escapePowerShellString(config.username ?? '')}'`);
    commands.push(`Set-ItemProperty '${appPoolPath}' -Name "processModel.password" -Value '${escapePowerShellString(config.password ?? '')}'`);
  }

  logger(deployFolder, 'info', `Setting app pool identity to: ${config.identity}`);
}

export async function stopAppPool(
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Stopping application pool: ${appPoolName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $appPool = Get-Item "IIS:\\AppPools\\${escapePowerShellString(appPoolName)}" -ErrorAction SilentlyContinue
    if ($appPool -and $appPool.State -eq 'Started') {
      Stop-WebAppPool -Name '${escapePowerShellString(appPoolName)}'
      Write-Output "App pool stopped"
    } else {
      Write-Output "App pool already stopped or does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_STOP_FAILED,
  );
}

export async function startAppPool(
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Starting application pool: ${appPoolName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $appPool = Get-Item "IIS:\\AppPools\\${escapePowerShellString(appPoolName)}" -ErrorAction SilentlyContinue
    if ($appPool -and $appPool.State -ne 'Started') {
      Start-WebAppPool -Name '${escapePowerShellString(appPoolName)}'
      Write-Output "App pool started"
    } else {
      Write-Output "App pool already started or does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_START_FAILED,
  );
}

export async function deleteAppPool(
  appPoolName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Deleting application pool: ${appPoolName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $appPool = Get-Item "IIS:\\AppPools\\${escapePowerShellString(appPoolName)}" -ErrorAction SilentlyContinue
    if ($appPool) {
      Remove-WebAppPool -Name '${escapePowerShellString(appPoolName)}'
      Write-Output "App pool deleted"
    } else {
      Write-Output "App pool does not exist"
    }
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_APP_POOL_CONFIG_FAILED,
  );
}

export async function ensureAppPool(
  config: IisAppPoolConfig,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const exists = await appPoolExists(config.name, logger, deployFolder);

  if (!exists) {
    if (config.createIfNotExists) {
      await createAppPool(config.name, logger, deployFolder);
    } else {
      throw new Error(`Application pool '${config.name}' does not exist and createIfNotExists is false`);
    }
  }

  await configureAppPool(config, logger, deployFolder);
  logger(deployFolder, 'info', `Application pool '${config.name}' configured successfully`);
}
