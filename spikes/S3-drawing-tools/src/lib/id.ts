let counter = 0;
export function generateId(prefix: string): string {
  counter++;
  return `${prefix}-${Date.now()}-${counter}`;
}
