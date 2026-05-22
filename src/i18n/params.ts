/** Replace `{{name}}` placeholders in catalog templates. */
export function formatMessage(template: string, params?: Record<string, string>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name] ?? `{{${name}}}`);
}
