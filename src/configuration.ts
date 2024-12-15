import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join, resolve } from 'path';

const YAML_CONFIG_FILENAME = 'config.yaml';

export interface ExpectedConfig {
  postgres: {
    host: string;
    username: string;
    password: string;
  };
  ym: {
    token: string;
    counter: number;
  };
}

export default (): ExpectedConfig => {
  console.log(
    'Reading config from ',
    resolve(join('./', YAML_CONFIG_FILENAME)),
  );
  return yaml.load(
    readFileSync(join('./', YAML_CONFIG_FILENAME), 'utf8'),
  ) as ExpectedConfig;
};
