import info from '@build-info';

export interface BuildInfo {
  version: string;
  commitHash: string;
  commitDate: string;
}

export const BUILD_INFO: BuildInfo = info;
