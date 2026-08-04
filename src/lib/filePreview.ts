type OpenFetchedFileOptions = {
  authenticated?: boolean;
  preferDirect?: boolean;
};

export async function openFetchedFile(
  url: string,
  fileName: string,
  options: OpenFetchedFileOptions = {},
) {
  const shouldTryDirect = options.preferDirect ?? !options.authenticated;
  if (shouldTryDirect) {
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (popup) {
      return;
    }
  }

  const headers = new Headers();

  void options.authenticated;

  const response = await fetch(url, {
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "Impossible d'ouvrir ce fichier.");
  }

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const popup = window.open(blobUrl, "_blank", "noopener,noreferrer");

  if (!popup) {
    const anchor = window.document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = fileName;
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }

  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
}
