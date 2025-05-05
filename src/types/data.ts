interface Project {
  id: string;
  name: string;
  code: string;
}

interface App {
  id: string;
  name: string;
  code: string;
  appId: string;
}

interface Environment {
  id: string;
  name: string;
}

interface Version {
  id: string;
  version: string;
}

interface Config {
  type: string;
  data: string;
  name: string;
}

export interface Data {
  script: string;
  application: App;
  project: Project;
  version: Version;
  environment: Environment;
  config: Config[];
}
