export function isModel(fileType: string, name: string): boolean {
  return (
    fileType === 'model/gltf-binary' ||
    fileType === 'model/gltf+json' ||
    /\.(glb|gltf)$/i.test(name)
  );
}

export function withInlineDisposition(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}disposition=inline`;
}
