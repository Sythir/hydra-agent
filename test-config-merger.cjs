const { configMerger: configMergerFn } = require('@sythir/config-merger');

function configMerger(config, overrides) {
  return configMergerFn(config, overrides, 'xml');
}

// ─── Test data ──────────────────────────────────────────────────────

const base = `<?xml version="1.0" encoding="utf-8"?>
<!--
  For more information on how to configure your ASP.NET application, please visit
  https://go.microsoft.com/fwlink/?LinkId=169433
  -->
<configuration>
  <configSections>
    <section name="log4net" type="log4net.Config.Log4NetConfigurationSectionHandler, log4net"/>
  </configSections>
  <log4net>
    <appender name="RollingLogFileAppender" type="log4net.Appender.RollingFileAppender">
      <lockingModel type="log4net.Appender.FileAppender"/>
      <encoding value="utf-8"/>
      <file value="App_Data\\logs\\"/>
      <datePattern value="'HotelPaal8-'yyyy-MM-dd'.log'"/>
      <staticLogFileName value="false"/>
      <appendToFile value="true"/>
      <rollingStyle value="Composite"/>
      <maxSizeRollBackups value="10"/>
      <maximumFileSize value="5MB"/>
      <layout type="log4net.Layout.PatternLayout">
        <conversionPattern value="%date [%thread] %-5level %logger [%property{NDC}] - %message%newline"/>
      </layout>
    </appender>
    <root>
      <level value="INFO"/>
      <appender-ref ref="RollingLogFileAppender"/>
    </root>
  </log4net>
  <system.web>
    <compilation targetFramework="4.6.1"/>
    <httpRuntime targetFramework="4.6.1" maxRequestLength="30000000" fcnMode="Single"/>
  </system.web>
  <system.webServer>
    <handlers>
      <remove name="WebDAV"/>
      <add name="ExtensionlessUrlHandler-Integrated-4.0" path="*." verb="*" type="System.Web.Handlers.TransferRequestHandler" preCondition="integratedMode,runtimeVersionv4.0"/>
      <add name="StaticFiles_JS" path="*.js" verb="*" modules="StaticFileModule" resourceType="File" requireAccess="Read"/>
    </handlers>
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="30000000"/>
      </requestFiltering>
    </security>
  </system.webServer>
  <runtime>
    <assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1">
      <dependentAssembly>
        <assemblyIdentity name="Newtonsoft.Json" publicKeyToken="30ad4fe6b2a6aeed" culture="neutral"/>
        <bindingRedirect oldVersion="0.0.0.0-12.0.0.0" newVersion="12.0.0.0"/>
      </dependentAssembly>
    </assemblyBinding>
  </runtime>
  <appSettings>
    <add key="MongoDBName" value="HotelPaal8_BETA"/>
    <add key="Stackify.ApiKey" value=""/>
    <add key="Stackify.AppName" value="HotelPaal8"/>
    <add key="Stackify.Environment" value="Develop"/>
    <add key="UserTrackingEnabled" value="true"/>
    <add key="UserTrackingLogCartCookie" value="true"/>
    <add key="keepCartLocalized" value="true"/>
  </appSettings>
  <connectionStrings configSource="configuration\\ConnectionString.config"/>
</configuration>`;

const overrides = `<configuration>
  <appSettings>
    <add key="UserTrackingLogCartCookie" value="false"/>
    <add key="keepCartLocalized" value="false"/>
  </appSettings>
</configuration>`;

// ─── Run ─────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║                  Config Merger Test                     ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');
console.log('Override:');
console.log(overrides);
console.log('');
console.log('────────────────── Merged Result ──────────────────────────');
console.log('');

const result = configMerger(base, overrides);
console.log(result);

console.log('');
console.log('────────────────── Verification ───────────────────────────');
console.log('');

const checks = [
  { label: 'UserTrackingLogCartCookie = "false"', pass: result.includes('key="UserTrackingLogCartCookie" value="false"') },
  { label: 'keepCartLocalized = "false"',         pass: result.includes('key="keepCartLocalized" value="false"') },
  { label: 'MongoDBName preserved',               pass: result.includes('key="MongoDBName" value="HotelPaal8_BETA"') },
  { label: 'Stackify.AppName preserved',          pass: result.includes('key="Stackify.AppName" value="HotelPaal8"') },
  { label: 'XML declaration preserved',           pass: result.includes('<?xml version="1.0" encoding="utf-8"?>') },
  { label: 'system.web section preserved',        pass: result.includes('compilation targetFramework="4.6.1"') },
  { label: 'handlers name attrs preserved',       pass: result.includes('name="ExtensionlessUrlHandler-Integrated-4.0"') },
  { label: 'assemblyBinding preserved',           pass: result.includes('name="Newtonsoft.Json"') },
];

for (const check of checks) {
  console.log(`  ${check.pass ? '✓' : '✗'} ${check.label}`);
}

const allPass = checks.every(c => c.pass);
console.log('');
console.log(allPass ? '  All checks passed!' : '  Some checks FAILED');
