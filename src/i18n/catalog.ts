import { commandCatalog } from './catalog-command';
import { modelCatalog } from './catalog-model';
import { uiCatalog } from './catalog-ui';
import { uiRemainingCatalog } from './catalog-ui-remaining';
import { uiSummaryCatalog } from './catalog-ui-summary';

export const catalog = {
  ...commandCatalog,
  ...modelCatalog,
  ...uiCatalog,
  ...uiSummaryCatalog,
  ...uiRemainingCatalog,
} as const satisfies Record<string, import('./types').MessageEntry>;

export type MessageKey = keyof typeof catalog;
