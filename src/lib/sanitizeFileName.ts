export function sanitizeFileName(fileName: string): string {
  // 1. Extract extension
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.slice(lastDot) : '';
  
  // 2. Normalize Polish characters to ASCII
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();
  
  // 3. Replace invalid characters with hyphens
  const sanitized = normalized
    .replace(/[^a-z0-9]/g, '-')  // Everything non-alphanumeric -> hyphen
    .replace(/-+/g, '-')          // Multiple hyphens -> one
    .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
  
  // 4. Add random suffix for uniqueness
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  
  return `${sanitized}-${randomSuffix}${ext}`;
}
