import { configMerger } from './configMerger';

// ─── JSON ─────────────────────────────────────────────────────────────────────

const jsonBase = JSON.stringify({
  database: { host: 'localhost', port: 5432, name: 'mydb' },
  logging: { level: 'info', format: 'json' },
  features: { darkMode: false },
}, null, 2);

const jsonOverrides = JSON.stringify({
  database: { host: 'prod.db.internal', name: 'mydb_prod' },
  features: { darkMode: true, betaUi: true },
}, null, 2);

console.log('=== JSON ===');
console.log(configMerger(jsonBase, jsonOverrides, 'json'));

// ─── Dotenv ───────────────────────────────────────────────────────────────────

const dotenvBase = `
DB_HOST=localhost
DB_PORT=5432
APP_ENV=development
LOG_LEVEL=info
`.trim();

const dotenvOverrides = `
DB_HOST=prod.db.internal
APP_ENV=production
NEW_KEY=hello
`.trim();

console.log('\n=== Dotenv ===');
console.log(configMerger(dotenvBase, dotenvOverrides, 'dotenv'));

// ─── XML ──────────────────────────────────────────────────────────────────────

const xmlBase = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <add key="ApiUrl" value="http://localhost:5000"/>
    <add key="Timeout" value="30"/>
    <add key="Debug" value="true"/>
    <koen key="name">super not cool</koen>
  </appSettings>
  <connectionStrings>
    <add name="Default" connectionString="Server=localhost;Database=mydb;"/>
  </connectionStrings>
</configuration>`;

const xmlOverrides = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <koen name="cool">super cool</koen>
  </appSettings>
  <connectionStrings>
    <add name="Default" connectionString="Server=prod.db;Database=mydb_prod;"/>
  </connectionStrings>
</configuration>`;

console.log('\n=== XML ===');
console.log(configMerger(xmlBase, xmlOverrides, 'xml'));

    // <add key="ApiUrl" value="https://api.prod.example.com"/>
    // <add key="NewSetting" value="added"/>

